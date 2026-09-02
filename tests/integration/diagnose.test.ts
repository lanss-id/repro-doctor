import assert from 'node:assert/strict';
import { readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import { useTemporaryArtifacts, removeDirectory, temporaryDirectory } from '../helpers/workspace.js';

const artifacts = await useTemporaryArtifacts('diagnose');

const { diagnose } = await import('../../src/agent/diagnose.js');
const { loadFixture } = await import('../../src/fixtures/registry.js');
const { copyRepositoryToWorkspace } = await import('../../src/infra/fs/copy.js');
const { treeChecksum } = await import('../../src/infra/fs/checksum.js');
const { parseTrajectory } = await import('../../src/domain/trajectory.js');
const { RunResultSchema } = await import('../../src/domain/result.js');
const { ReproDoctorError } = await import('../../src/domain/failure.js');
const { scriptedDriver } = await import('../helpers/scripted-driver.js');
const { silentLogger } = await import('../../src/infra/log.js');

const fixture = await loadFixture('entrypoint-mismatch');
const env: NodeJS.ProcessEnv = { REPRO_DOCTOR_MODEL: 'scripted-test-driver' };

async function fixedManifest(): Promise<string> {
  const manifest = JSON.parse(await readFile(path.join(fixture.repoDir, 'package.json'), 'utf8'));
  manifest.main = 'dist/index.js';
  return `${JSON.stringify(manifest, null, 2)}\n`;
}

const oracle = {
  id: 'entrypoint-mismatch/oracle',
  directory: fixture.oracleDir,
  entry: fixture.meta.oracle.entry,
  timeoutSeconds: fixture.meta.oracle.timeoutSeconds,
};

const baseOptions = {
  repoPath: fixture.repoDir,
  caseId: fixture.meta.id,
  oracle,
  executorKind: 'local-test-adapter' as const,
  allowLocalAdapter: true,
  logger: silentLogger,
  env,
  modelOverride: 'scripted-test-driver',
};

test('a live run with an unpriced model fails before its first API call', async () => {
  await assert.rejects(
    () =>
      diagnose({
        repoPath: fixture.repoDir,
        caseId: fixture.meta.id,
        oracle,
        mode: 'advanced',
        executorKind: 'docker',
        logger: silentLogger,
        env: {
          OPENAI_API_KEY: 'sk-test-not-used-because-price-gate-runs-first',
          REPRO_DOCTOR_MODEL: 'model-nobody-priced',
        },
      }),
    (error: unknown) => {
      assert.ok(error instanceof ReproDoctorError);
      assert.equal(error.reason, 'no-price-configured');
      return true;
    },
  );
});

test('a correct scripted repair is recorded as a verified repair', async () => {
  const checksumBefore = await treeChecksum(fixture.repoDir);
  const content = await fixedManifest();

  const result = await diagnose({
    ...baseOptions,
    mode: 'advanced',
    driverFactory: scriptedDriver(async (session) => {
      await session.proposePatch(
        [{ path: 'package.json', content }],
        'point main at the file the build emits',
      );
      return {
        text: 'fixed the entry point',
        structured: {
          hypotheses: [
            {
              id: 'h1',
              statement: 'package.json main names a file the build never emits',
              evidence: 'npm run check failed at module resolution for dist/main.js',
              status: 'fixed',
            },
          ],
          patchSummary: 'point main at dist/index.js',
        },
      };
    }),
  });

  assert.equal(result.outcome.status, 'repaired');
  assert.equal(result.verification.kind, 'passed');
  assert.equal(result.patch.kind, 'present');
  if (result.patch.kind !== 'present') return;
  assert.deepEqual(result.patch.changedFiles, ['package.json']);
  assert.equal(result.repo.mutated, false);
  assert.equal(await treeChecksum(fixture.repoDir), checksumBefore, 'the input repository was modified');
  assert.equal(result.sandbox.productionSafe, false, 'the test adapter must never claim to be production safe');

  // The artifacts a submission is judged on all exist and parse.
  const parsed = RunResultSchema.parse(JSON.parse(await readFile(result.artifacts.resultPath, 'utf8')));
  assert.equal(parsed.runId, result.runId);
  const events = parseTrajectory(await readFile(result.artifacts.trajectoryPath, 'utf8'));
  assert.ok(events.some((event) => event.type === 'verification.completed'));
  assert.ok(events.some((event) => event.type === 'preflight.completed'), 'advanced mode runs a preflight');
  assert.ok(events.some((event) => event.type === 'evidence.gate'), 'advanced mode runs an evidence gate');
  assert.match(await readFile(result.artifacts.patchPath, 'utf8'), /\+\s*"main": "dist\/index\.js"/u);
  assert.match(await readFile(result.artifacts.verificationLogPath, 'utf8'), /RESULT PASS/u);
  assert.match(await readFile(result.artifacts.reportPath, 'utf8'), /<!doctype html>/u);
});

test('the trajectory never mentions the hidden oracle or the reference repair', async () => {
  const result = await diagnose({
    ...baseOptions,
    mode: 'baseline',
    driverFactory: scriptedDriver(async (session) => {
      await session.listFiles('.');
      await session.readFile('package.json');
      await session.runCommand('npm', ['run', 'check', '--silent']);
      return { text: 'looked around' };
    }),
  });
  const trajectory = await readFile(result.artifacts.trajectoryPath, 'utf8');
  assert.equal(trajectory.includes(fixture.oracleDir), false);
  assert.equal(trajectory.includes(fixture.referenceDir), false);
  assert.equal(trajectory.includes(fixture.metaPath), false);
  assert.equal(trajectory.includes('oracle.mjs'), false);

  // And the workspace the agent could read never held the oracle.
  await assert.rejects(() => stat(path.join(result.repo.workspacePath, 'oracle')));
  await assert.rejects(() => stat(path.join(result.repo.workspacePath, 'reference')));
  await assert.rejects(() => stat(path.join(result.repo.workspacePath, 'meta.json')));
});

test('an explicit repository task file is included in the initial agent message', async () => {
  const target = await temporaryDirectory('task-context');
  try {
    const repoPath = path.join(target, 'repo');
    await copyRepositoryToWorkspace(fixture.repoDir, repoPath);
    await writeFile(
      path.join(repoPath, 'REPAIR_TASK.md'),
      'The command must open the browser with the platform-specific launcher.\n',
      'utf8',
    );
    let receivedTask = '';
    const answer = async () => ({ text: 'looked around', structured: null, history: [], usage: null });

    await diagnose({
      ...baseOptions,
      repoPath,
      mode: 'baseline',
      taskFile: 'REPAIR_TASK.md',
      driverFactory: () => ({
        start: async (task) => {
          receivedTask = task;
          return await answer();
        },
        followUp: async () => await answer(),
      }),
    });

    assert.match(receivedTask, /problem statement from REPAIR_TASK\.md/u);
    assert.match(receivedTask, /platform-specific launcher/u);
    assert.match(receivedTask, /Do not edit it/u);
  } finally {
    await removeDirectory(target);
  }
});

test('a run that changes nothing is reported as no-patch with verification skipped', async () => {
  const result = await diagnose({
    ...baseOptions,
    mode: 'baseline',
    driverFactory: scriptedDriver(async () => ({ text: 'I looked and did nothing' })),
  });
  assert.equal(result.outcome.status, 'no-patch');
  assert.equal(result.patch.kind, 'empty');
  assert.deepEqual(result.verification, { kind: 'skipped', why: 'no-patch-produced' });
});

test('running out of tool calls stops the run and is recorded', async () => {
  const result = await diagnose({
    ...baseOptions,
    mode: 'baseline',
    budget: {
      maxToolCalls: 3,
      maxPatchAttempts: 2,
      maxWallClockSeconds: 120,
      maxCostUsd: 0.3,
      commandTimeoutSeconds: 30,
    },
    driverFactory: scriptedDriver(async (session) => {
      for (let index = 0; index < 10; index += 1) {
        await session.listFiles('.');
      }
      return { text: 'never reached' };
    }),
  });
  assert.equal(result.outcome.status, 'budget-exhausted');
  assert.equal(result.usage.limitHit, 'tool-calls');
  assert.equal(result.usage.toolCalls, 3);
  const events = parseTrajectory(await readFile(result.artifacts.trajectoryPath, 'utf8'));
  assert.ok(events.some((event) => event.type === 'error' && event.reason === 'budget-exhausted'));
});

test('a patch attempt that tries to escape the workspace is refused', async () => {
  const outside = await temporaryDirectory('escape-target');
  try {
    const result = await diagnose({
      ...baseOptions,
      mode: 'baseline',
      driverFactory: scriptedDriver(async (session) => {
        const traversal = await session.proposePatch(
          [{ path: '../../escaped.txt', content: 'owned' }],
          'attempt to write outside the workspace',
        );
        assert.equal(traversal.ok, false);
        assert.match(traversal.text, /error:/u);
        const absolute = await session.readFile('/etc/passwd');
        assert.equal(absolute.ok, false);
        return { text: 'tried to escape' };
      }),
    });
    assert.equal(result.patch.kind, 'empty');
    await assert.rejects(() => stat(path.join(path.dirname(result.repo.workspacePath), 'escaped.txt')));
    await assert.rejects(() => stat(path.join(outside, '..', 'escaped.txt')));
  } finally {
    await removeDirectory(outside);
  }
});

test('a patch the oracle rejects is reported as an unverified patch, not a repair', async () => {
  const result = await diagnose({
    ...baseOptions,
    mode: 'baseline',
    driverFactory: scriptedDriver(async (session) => {
      await session.proposePatch(
        [{ path: 'README.md', content: '# greeting-kit\n\nI changed the wrong file.\n' }],
        'a plausible looking but useless edit',
      );
      return { text: 'done' };
    }),
  });
  assert.equal(result.outcome.status, 'unverified-patch');
  assert.equal(result.verification.kind, 'failed');
  assert.match(await readFile(result.artifacts.verificationLogPath, 'utf8'), /RESULT FAIL/u);
});

test('diagnose refuses a repository path that does not exist', async () => {
  await assert.rejects(
    () =>
      diagnose({
        ...baseOptions,
        repoPath: path.join(fixture.repoDir, 'does-not-exist'),
        mode: 'baseline',
        driverFactory: scriptedDriver(async () => ({ text: 'never runs' })),
      }),
    /repository not found/u,
  );
});

test('diagnose without an API key fails with a clear reason and no fabricated result', async () => {
  const target = await temporaryDirectory('no-key');
  try {
    await copyRepositoryToWorkspace(fixture.repoDir, path.join(target, 'repo'));
    await assert.rejects(
      () =>
        diagnose({
          repoPath: path.join(target, 'repo'),
          mode: 'baseline',
          executorKind: 'local-test-adapter',
          allowLocalAdapter: true,
          logger: silentLogger,
          env: {},
        }),
      (error: unknown) => error instanceof Error && /OPENAI_API_KEY is not set/u.test(error.message),
    );
  } finally {
    await removeDirectory(target);
  }
});

after(async () => {
  await artifacts.cleanup();
});
