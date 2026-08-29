import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import { useTemporaryArtifacts } from '../helpers/workspace.js';

const artifacts = await useTemporaryArtifacts('advanced-retry');

const { diagnose } = await import('../../src/agent/diagnose.js');
const { loadFixture } = await import('../../src/fixtures/registry.js');
const { parseTrajectory } = await import('../../src/domain/trajectory.js');
const { recordingDriver, scriptedCritic } = await import('../helpers/scripted-driver.js');
const { silentLogger } = await import('../../src/infra/log.js');
const { PriceTableSchema } = await import('../../src/agent/pricing.js');

// broken-test-discovery is the case where the repository's own check exits zero
// while running zero tests. The visible gate passes and the hidden oracle does
// not, which is exactly what the feedback retry has to be driven by.
const fixture = await loadFixture('broken-test-discovery');
const chainedFixture = await loadFixture('chained-two-faults');

const TEST_PRICES = PriceTableSchema.parse({
  note: 'test prices, not real',
  models: {
    'scripted-test-driver': {
      inputUsdPerMillionTokens: 0.4,
      outputUsdPerMillionTokens: 1.6,
      source: 'fixed values used by the test suite',
    },
  },
});

async function patchedManifest(): Promise<string> {
  const manifest = await readFile(path.join(fixture.repoDir, 'package.json'), 'utf8');
  return manifest.split('*.test.mjs').join('*.spec.mjs');
}

const baseOptions = {
  repoPath: fixture.repoDir,
  mode: 'advanced' as const,
  caseId: fixture.meta.id,
  oracle: {
    id: `${fixture.meta.id}/oracle`,
    directory: fixture.oracleDir,
    entry: fixture.meta.oracle.entry,
    timeoutSeconds: fixture.meta.oracle.timeoutSeconds,
  },
  executorKind: 'local-test-adapter' as const,
  allowLocalAdapter: true,
  logger: silentLogger,
  env: {} as NodeJS.ProcessEnv,
  modelOverride: 'scripted-test-driver',
};

test('the hidden oracle drives the single feedback retry even when the visible check passes', async () => {
  const feedback: string[] = [];
  const fixed = await patchedManifest();

  const result = await diagnose({
    ...baseOptions,
    priceTable: TEST_PRICES,
    driverFactory: recordingDriver(async (session, turn) => {
      if (turn === 1) {
        // Plausible but useless: the project check still exits zero afterwards.
        await session.proposePatch(
          [{ path: 'README.md', content: '# sum-kit\n\nTidied the readme.\n' }],
          'tidy the readme',
        );
        return {
          text: 'the check passes, so the project looks fine',
          structured: {
            hypotheses: [
              {
                id: 'h1',
                statement: 'nothing is wrong; npm run check exits zero',
                evidence: 'npm run check exited 0',
                status: 'supported',
              },
            ],
            patchSummary: 'no functional change',
          },
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, requests: 1 },
        };
      }
      await session.proposePatch(
        [{ path: 'package.json', content: fixed }],
        'the runner glob never matched the spec files, so zero tests ran',
      );
      return {
        text: 'pointed the test glob at the files that exist',
        structured: {
          hypotheses: [
            {
              id: 'h1',
              statement: 'the test glob matches no file, so the suite never runs',
              evidence: 'independent verification reported that zero tests ran',
              status: 'fixed',
            },
          ],
          patchSummary: 'match tests/**/*.spec.mjs',
        },
        usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60, requests: 1 },
      };
    }, feedback),
  });

  assert.equal(result.outcome.status, 'repaired');
  assert.equal(result.verification.kind, 'passed');
  assert.equal(result.usage.patchAttempts, 2, 'the retry must be the second and last attempt');

  // The retry happened because of the oracle, not the visible check.
  assert.equal(feedback.length, 1, 'exactly one feedback retry');
  const message = feedback[0] ?? '';
  assert.match(message, /Independent evidence gate: PASSED/u);
  assert.match(message, /Independent verification also ran outside your sandbox/u);
  assert.match(message, /FAIL npm test runs at least two tests/u);
  assert.match(message, /last attempt/u);

  // Feedback carries results, never the location or the source of the oracle.
  assert.equal(message.includes(fixture.oracleDir), false);
  assert.equal(message.includes('oracle.mjs'), false);
  assert.equal(message.includes(fixture.referenceDir), false);

  const events = parseTrajectory(await readFile(result.artifacts.trajectoryPath, 'utf8'));
  const stages = events
    .filter((event) => event.type === 'verification.completed')
    .map((event) => (event.type === 'verification.completed' ? event.stage : null));
  assert.deepEqual(stages, ['interim', 'final'], 'one interim run drives the retry, one final run decides');

  const gates = events.filter((event) => event.type === 'evidence.gate');
  assert.equal(gates.length, 2);
  for (const gate of gates) {
    if (gate.type !== 'evidence.gate') continue;
    assert.equal(typeof gate.exitCode, 'number', 'the gate records the real exit code');
  }

  const trajectory = await readFile(result.artifacts.trajectoryPath, 'utf8');
  assert.equal(trajectory.includes(fixture.oracleDir), false);
  assert.equal(trajectory.includes('oracle.mjs'), false);
});

test('token usage and cost accumulate across the first turn and the retry', async () => {
  const feedback: string[] = [];
  const fixed = await patchedManifest();

  const result = await diagnose({
    ...baseOptions,
    priceTable: TEST_PRICES,
    driverFactory: recordingDriver(async (session, turn) => {
      if (turn === 1) {
        await session.proposePatch(
          [{ path: 'README.md', content: '# sum-kit\n\nstill broken\n' }],
          'first attempt',
        );
        return {
          text: 'first attempt',
          usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, requests: 1 },
        };
      }
      await session.proposePatch([{ path: 'package.json', content: fixed }], 'second attempt');
      return {
        text: 'second attempt',
        usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60, requests: 1 },
      };
    }, feedback),
  });

  assert.equal(feedback.length, 1);
  assert.deepEqual(result.usage.tokens, {
    inputTokens: 150,
    outputTokens: 30,
    totalTokens: 180,
    requests: 2,
  });
  assert.equal(result.usage.cost.kind, 'measured');
  if (result.usage.cost.kind !== 'measured') return;
  // 150 input at $0.40/1M plus 30 output at $1.60/1M.
  assert.equal(result.usage.cost.usd, 0.000108);
});

test('the chained repair keeps its retry at the exact twelve-call ceiling', async () => {
  const feedback: string[] = [];
  const manifest = JSON.parse(
    await readFile(path.join(chainedFixture.repoDir, 'package.json'), 'utf8'),
  );
  manifest.main = 'dist/index.js';
  const fixedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  const configPath = path.join(chainedFixture.repoDir, 'src/config.ts');
  const fixedConfig = (await readFile(configPath, 'utf8')).replace('APP_GREETING', 'GREETING');

  const result = await diagnose({
    ...baseOptions,
    repoPath: chainedFixture.repoDir,
    caseId: chainedFixture.meta.id,
    oracle: {
      id: `${chainedFixture.meta.id}/oracle`,
      directory: chainedFixture.oracleDir,
      entry: chainedFixture.meta.oracle.entry,
      timeoutSeconds: chainedFixture.meta.oracle.timeoutSeconds,
    },
    priceTable: TEST_PRICES,
    driverFactory: recordingDriver(async (session, turn) => {
      assert.equal(session.agentToolsEnabled, true, 'each repair turn starts with tools enabled');
      if (turn === 1) {
        // Seven investigation calls after the three-call preflight reproduce
        // the live smoke run. The first patch is call eleven, leaving exactly
        // one agent call for the bounded retry.
        await session.readFile('README.md');
        await session.readFile('tsconfig.json');
        await session.listFiles('dist');
        await session.readFile('scripts/smoke.mjs');
        await session.readFile('src/index.ts');
        await session.readFile('src/config.ts');
        await session.readFile('.env.example');
        await session.proposePatch(
          [{ path: 'package.json', content: fixedManifest }],
          'point the package entry at the file emitted by the build',
        );
        assert.equal(
          session.agentToolsEnabled,
          false,
          'a successful patch checkpoints the turn before self-verification can spend the retry',
        );
        return {
          text: 'fixed the entry point and stopped for independent evidence',
          structured: {
            hypotheses: [
              {
                id: 'entrypoint',
                statement: 'the package entry names a file the build does not emit',
                evidence: 'dist contains index.js while package.json names app.js',
                status: 'fixed',
              },
            ],
            patchSummary: 'point main at dist/index.js',
          },
        };
      }
      await session.proposePatch(
        [{ path: 'src/config.ts', content: fixedConfig }],
        'honour the GREETING variable named by the repository contract',
      );
      assert.equal(session.agentToolsEnabled, false);
      return {
        text: 'fixed the environment contract from the independent evidence',
        structured: {
          hypotheses: [
            {
              id: 'environment-contract',
              statement: 'the source reads an undocumented environment variable',
              evidence: 'independent verification says GREETING is ignored and APP_GREETING is still honoured',
              status: 'fixed',
            },
          ],
          patchSummary: 'read GREETING instead of APP_GREETING',
        },
      };
    }, feedback),
  });

  assert.equal(result.outcome.status, 'repaired');
  assert.equal(result.verification.kind, 'passed');
  assert.equal(result.usage.toolCalls, 12);
  assert.equal(result.usage.patchAttempts, 2);
  assert.equal(feedback.length, 1);
  assert.match(feedback[0] ?? '', /GREETING is the variable that is read/u);

  const events = parseTrajectory(await readFile(result.artifacts.trajectoryPath, 'utf8'));
  assert.equal(events.filter((event) => event.type === 'evidence.gate').length, 2);
});

test('the critic treatment is charged to the same budget and can force the retry', async () => {
  const feedback: string[] = [];
  const fixed = await patchedManifest();

  const result = await diagnose({
    ...baseOptions,
    priceTable: TEST_PRICES,
    criticEnabled: true,
    criticFactory: scriptedCritic({
      approved: false,
      critique: 'the readme edit does not touch the fault named in the ledger',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15, requests: 1 },
    }),
    driverFactory: recordingDriver(async (session, turn) => {
      if (turn === 1) {
        await session.proposePatch(
          [{ path: 'README.md', content: '# sum-kit\n\nstill broken\n' }],
          'first attempt',
        );
        return { text: 'first attempt', usage: { inputTokens: 100, outputTokens: 20, totalTokens: 120, requests: 1 } };
      }
      await session.proposePatch([{ path: 'package.json', content: fixed }], 'second attempt');
      return { text: 'second attempt', usage: { inputTokens: 50, outputTokens: 10, totalTokens: 60, requests: 1 } };
    }, feedback),
  });

  assert.equal(result.outcome.status, 'repaired');
  assert.equal(feedback.length, 1);
  assert.match(feedback[0] ?? '', /A reviewer looked at your patch/u);
  assert.match(feedback[0] ?? '', /does not touch the fault named in the ledger/u);

  // Three preflight calls, two patch attempts and one critic call. Evidence
  // gates are scorer actions, like the hidden oracle, rather than agent tools.
  assert.equal(result.usage.toolCalls, 6, 'the critic call is charged like any other');
  assert.deepEqual(result.usage.tokens, {
    inputTokens: 160,
    outputTokens: 35,
    totalTokens: 195,
    requests: 3,
  });

  const events = parseTrajectory(await readFile(result.artifacts.trajectoryPath, 'utf8'));
  const reviews = events.filter((event) => event.type === 'critic.reviewed');
  assert.equal(reviews.length, 1);
});

after(async () => {
  await artifacts.cleanup();
});

test('an agent that spends every call it is offered still gets its retry', async () => {
  const feedback: string[] = [];
  const manifest = JSON.parse(
    await readFile(path.join(chainedFixture.repoDir, 'package.json'), 'utf8'),
  );
  manifest.main = 'dist/index.js';
  const fixedManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  const configPath = path.join(chainedFixture.repoDir, 'src/config.ts');
  const fixedConfig = (await readFile(configPath, 'utf8')).replace('APP_GREETING', 'GREETING');

  const offered = (session: { budgetFooter(): string }): number =>
    Number(/tool calls left: (\d+)/u.exec(session.budgetFooter())?.[1] ?? '0');

  const result = await diagnose({
    ...baseOptions,
    repoPath: chainedFixture.repoDir,
    caseId: chainedFixture.meta.id,
    oracle: {
      id: `${chainedFixture.meta.id}/oracle`,
      directory: chainedFixture.oracleDir,
      entry: chainedFixture.meta.oracle.entry,
      timeoutSeconds: chainedFixture.meta.oracle.timeoutSeconds,
    },
    priceTable: TEST_PRICES,
    driverFactory: recordingDriver(async (session, turn) => {
      if (turn === 1) {
        // Reads until the budget it is shown is down to its last call, which is
        // the worst case the reservation exists for: without it the first patch
        // lands on the run's final call and the promised retry never happens.
        while (offered(session) > 1) {
          await session.readFile('README.md');
        }
        await session.proposePatch(
          [{ path: 'package.json', content: fixedManifest }],
          'point the package entry at the file emitted by the build',
        );
        assert.equal(offered(session), 0, 'the turn ends with nothing left to offer');
        return { text: 'entry point fixed on the last call of this turn' };
      }
      await session.proposePatch(
        [{ path: 'src/config.ts', content: fixedConfig }],
        'honour the GREETING variable named by the repository contract',
      );
      return { text: 'environment contract fixed from the independent evidence' };
    }, feedback),
  });

  assert.equal(feedback.length, 1, 'the reserved call pays for exactly one retry');
  assert.equal(result.outcome.status, 'repaired');
  assert.equal(result.verification.kind, 'passed');
  assert.equal(result.usage.patchAttempts, 2);
  assert.equal(result.usage.toolCalls, 12, 'the reservation partitions the budget, it does not raise it');
});
