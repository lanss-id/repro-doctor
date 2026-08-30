import assert from 'node:assert/strict';
import { copyFile, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import { temporaryDirectory, useTemporaryArtifacts } from '../helpers/workspace.js';

const artifacts = await useTemporaryArtifacts('replay');

const { diagnose } = await import('../../src/agent/diagnose.js');
const { loadFixture } = await import('../../src/fixtures/registry.js');
const { scriptedDriver } = await import('../helpers/scripted-driver.js');
const { silentLogger } = await import('../../src/infra/log.js');
const { evaluateRun, allPassed } = await import('../../src/eval/checks.js');
const { replayBundle } = await import('../../src/eval/replay.js');
const { EVAL_SCHEMA_VERSION } = await import('../../src/domain/eval.js');
const { DEFAULT_BUDGET } = await import('../../src/domain/budget.js');
const { summarizeMode } = await import('../../src/eval/scoring.js');

const fixture = await loadFixture('entrypoint-mismatch');
const bundleDir = await temporaryDirectory('replay-bundle');

/**
 * A real run through the real sandbox, patcher and oracle, scored by the real
 * checks, then packaged the way an evidence bundle is packaged. Replaying a
 * hand-written fixture would only prove that the replay can read JSON.
 */
const result = await diagnose({
  repoPath: fixture.repoDir,
  mode: 'advanced',
  caseId: fixture.meta.id,
  oracle: {
    id: `${fixture.meta.id}/oracle`,
    directory: fixture.oracleDir,
    entry: fixture.meta.oracle.entry,
    timeoutSeconds: fixture.meta.oracle.timeoutSeconds,
  },
  executorKind: 'local-test-adapter',
  allowLocalAdapter: true,
  logger: silentLogger,
  env: {},
  modelOverride: 'scripted-test-driver',
  driverFactory: scriptedDriver(async (session) => {
    const manifest = await readFile(path.join(fixture.repoDir, 'package.json'), 'utf8');
    await session.proposePatch(
      [{ path: 'package.json', content: manifest.split('src/index.js').join('dist/index.js') }],
      'point the entry at the built file',
    );
    return { text: 'entry point corrected' };
  }),
});

const checks = await evaluateRun(result, fixture);
const run = {
  caseId: fixture.meta.id,
  mode: 'advanced' as const,
  arm: null,
  repeat: 1,
  runId: result.runId,
  status: result.outcome.status,
  verified: result.verification.kind === 'passed' && allPassed(checks),
  wallClockMs: result.usage.wallClockMs,
  cost: result.usage.cost,
  checks,
  error: null,
};

const report = {
  schemaVersion: EVAL_SCHEMA_VERSION,
  generatedAt: new Date().toISOString(),
  status: { kind: 'complete' as const },
  model: 'scripted-test-driver',
  executor: 'local-test-adapter' as const,
  repeats: 1,
  budget: DEFAULT_BUDGET,
  cases: [fixture.meta.id],
  runs: [run],
  summaries: [summarizeMode('advanced', [run])],
  experiment: null,
};

async function writeBundle(overrides: Partial<typeof report> = {}): Promise<void> {
  const runDir = path.join(bundleDir, 'runs', result.runId);
  await mkdir(runDir, { recursive: true });
  for (const name of ['result.json', 'trajectory.jsonl', 'repair.patch', 'verification.log']) {
    await copyFile(
      path.join(path.dirname(result.artifacts.trajectoryPath), name),
      path.join(runDir, name),
    );
  }
  await writeFile(
    path.join(bundleDir, 'eval.json'),
    `${JSON.stringify({ ...report, ...overrides }, null, 2)}\n`,
    'utf8',
  );
}

test('a committed bundle re-scores to exactly what was published', async () => {
  await writeBundle();
  const replay = await replayBundle(bundleDir);

  assert.deepEqual(replay.disagreements, []);
  assert.deepEqual(replay.missingArtifacts, []);
  assert.equal(replay.recomputed.length, 1);
  assert.equal(replay.recomputed[0]?.verified, run.verified);
  assert.equal(replay.recomputed[0]?.status, run.status);
  // The checks are recomputed here, not copied across from the report.
  assert.equal(replay.recomputed[0]?.checks.length, 7);
});

test('a report that disagrees with its own artifacts is caught, not trusted', async () => {
  await writeBundle({ runs: [{ ...run, verified: !run.verified }] });
  const replay = await replayBundle(bundleDir);

  assert.equal(replay.disagreements.length, 1);
  assert.equal(replay.disagreements[0]?.field, 'verified');
  assert.equal(replay.disagreements[0]?.published, String(!run.verified));
  assert.equal(replay.disagreements[0]?.recomputed, String(run.verified));
});

test('a run whose artifacts are missing is reported rather than counted', async () => {
  await writeBundle();
  await rm(path.join(bundleDir, 'runs', result.runId, 'result.json'));
  const replay = await replayBundle(bundleDir);

  assert.deepEqual(replay.missingArtifacts, [result.runId]);
  assert.deepEqual(replay.disagreements, []);
});

test('a directory with no report is refused with an explanation', async () => {
  const empty = await temporaryDirectory('replay-empty');
  await assert.rejects(replayBundle(empty), /no evaluation report/u);
  await rm(empty, { recursive: true, force: true });
});

after(async () => {
  await rm(bundleDir, { recursive: true, force: true });
  await artifacts.cleanup();
});
