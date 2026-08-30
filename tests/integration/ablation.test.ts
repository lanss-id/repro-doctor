import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import { useTemporaryArtifacts } from '../helpers/workspace.js';

const artifacts = await useTemporaryArtifacts('ablation');

const { diagnose } = await import('../../src/agent/diagnose.js');
const { loadFixture } = await import('../../src/fixtures/registry.js');
const { recordingDriver } = await import('../helpers/scripted-driver.js');
const { silentLogger } = await import('../../src/infra/log.js');
const { PriceTableSchema } = await import('../../src/agent/pricing.js');
const { advancedInstructions, instructionsFor, baselineInstructions } = await import(
  '../../src/agent/instructions.js'
);
const { DEFAULT_BUDGET } = await import('../../src/domain/budget.js');

// The same case the retry test uses: the repository's own check exits zero
// while running zero tests, so the visible gate passes and the hidden oracle
// does not. It is the one case where the retry is the only thing that can save
// the run, which makes it the one case where removing the retry has to change
// the outcome.
const fixture = await loadFixture('broken-test-discovery');

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
  priceTable: TEST_PRICES,
};

/** A first turn that passes the visible check and fails the hidden oracle. */
const uselessPatch = async (
  session: Parameters<Parameters<typeof recordingDriver>[0]>[0],
): Promise<{ text: string }> => {
  await session.proposePatch(
    [{ path: 'README.md', content: '# sum-kit\n\nTidied the readme.\n' }],
    'tidy the readme',
  );
  return { text: 'the check passes, so the project looks fine' };
};

test('the ablation treatment takes no retry even when the oracle refuses the patch', async () => {
  const feedback: string[] = [];
  let turns = 0;

  const result = await diagnose({
    ...baseOptions,
    retryEnabled: false,
    driverFactory: recordingDriver(async (session, turn) => {
      turns = turn;
      return await uselessPatch(session);
    }, feedback),
  });

  assert.equal(turns, 1, 'the treatment arm gets exactly one turn');
  assert.equal(feedback.length, 0, 'no evidence feedback is sent when the retry is off');
  assert.equal(result.usage.patchAttempts, 1, 'the second patch attempt is never spent');
  assert.equal(result.outcome.status, 'unverified-patch');
  assert.notEqual(result.verification.kind, 'passed');
});

test('the same run with the retry on repairs the repository', async () => {
  const feedback: string[] = [];
  const manifest = await readFile(path.join(fixture.repoDir, 'package.json'), 'utf8');
  const fixed = manifest.split('*.test.mjs').join('*.spec.mjs');

  const result = await diagnose({
    ...baseOptions,
    driverFactory: recordingDriver(async (session, turn) => {
      if (turn === 1) {
        return await uselessPatch(session);
      }
      await session.proposePatch(
        [{ path: 'package.json', content: fixed }],
        'the runner glob never matched the spec files, so zero tests ran',
      );
      return { text: 'pointed the test glob at the files that exist' };
    }, feedback),
  });

  // The pair is the whole ablation: same case, same driver on turn one, same
  // oracle. Only the retry differs, and only the outcome differs with it.
  assert.equal(feedback.length, 1);
  assert.equal(result.usage.patchAttempts, 2);
  assert.equal(result.outcome.status, 'repaired');
  assert.equal(result.verification.kind, 'passed');
});

test('the treatment arm is told the truth about not getting a second turn', () => {
  const withRetry = advancedInstructions(DEFAULT_BUDGET, true);
  const without = advancedInstructions(DEFAULT_BUDGET, false);

  assert.match(withRetry, /exactly one more repair turn/u);
  assert.doesNotMatch(without, /one more repair turn/u);
  assert.match(without, /You do not get a second repair turn/u);

  // Everything else about the two must be identical, or the ablation would be
  // measuring more than one change.
  assert.equal(
    withRetry.split('\n').filter((line) => !line.startsWith('8. ')).join('\n'),
    without.split('\n').filter((line) => !line.startsWith('8. ')).join('\n'),
  );
});

test('the retry flag never reaches baseline mode', () => {
  assert.equal(
    instructionsFor('baseline', DEFAULT_BUDGET, false),
    baselineInstructions(DEFAULT_BUDGET),
  );
});

after(async () => {
  await artifacts.cleanup();
});
