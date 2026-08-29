import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { useTemporaryArtifacts } from '../helpers/workspace.js';

const artifacts = await useTemporaryArtifacts('deadline');

const { diagnose } = await import('../../src/agent/diagnose.js');
const { loadFixture } = await import('../../src/fixtures/registry.js');
const { parseTrajectory } = await import('../../src/domain/trajectory.js');
const { blockingDriver } = await import('../helpers/scripted-driver.js');
const { silentLogger } = await import('../../src/infra/log.js');

const fixture = await loadFixture('entrypoint-mismatch');

test('a model call that never returns is ended by the run deadline', async () => {
  const startedAt = Date.now();
  const result = await diagnose({
    repoPath: fixture.repoDir,
    mode: 'baseline',
    caseId: fixture.meta.id,
    oracle: {
      id: `${fixture.meta.id}/oracle`,
      directory: fixture.oracleDir,
      entry: fixture.meta.oracle.entry,
      timeoutSeconds: fixture.meta.oracle.timeoutSeconds,
    },
    budget: {
      maxToolCalls: 12,
      maxPatchAttempts: 2,
      maxWallClockSeconds: 1,
      maxCostUsd: 0.3,
      commandTimeoutSeconds: 60,
    },
    executorKind: 'local-test-adapter',
    allowLocalAdapter: true,
    logger: silentLogger,
    env: {},
    modelOverride: 'scripted-test-driver',
    driverFactory: (options) => blockingDriver(options),
  });
  const elapsed = Date.now() - startedAt;

  assert.equal(result.outcome.status, 'budget-exhausted');
  if (result.outcome.status !== 'budget-exhausted') return;
  assert.equal(result.outcome.limit, 'wall-clock');
  assert.equal(result.usage.limitHit, 'wall-clock');
  assert.ok(elapsed < 30_000, `the deadline did not stop the run: ${elapsed}ms`);

  // The run still produced its artifacts, and still checked the source tree.
  assert.equal(result.repo.mutated, false);
  const events = parseTrajectory(await readFile(result.artifacts.trajectoryPath, 'utf8'));
  assert.ok(
    events.some((event) => event.type === 'error' && event.reason === 'budget-exhausted'),
    'the deadline is recorded as a budget failure, not an internal error',
  );
  assert.ok(events.some((event) => event.type === 'run.finished'));
});

after(async () => {
  await artifacts.cleanup();
});
