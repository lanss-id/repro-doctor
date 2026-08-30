import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvalRun } from '../../src/domain/eval.js';
import { loadAllFixtures } from '../../src/fixtures/registry.js';
import {
  DIFFICULTY_STRATA,
  STRATUM_NAMES,
  stratumOf,
  summarizeStratum,
} from '../../src/eval/strata.js';

test('the strata partition the benchmark exactly, with no case in two and none left out', async () => {
  const fixtures = (await loadAllFixtures()).map((fixture) => fixture.meta.id);
  const assigned = STRATUM_NAMES.flatMap((name) => [...DIFFICULTY_STRATA[name]]);

  assert.equal(
    new Set(assigned).size,
    assigned.length,
    'a case in two strata would be counted twice',
  );
  assert.deepEqual(
    [...assigned].sort(),
    [...fixtures].sort(),
    'a fixture added or removed without updating the strata would silently fall out of the stratified result',
  );
});

test('a case outside the benchmark belongs to no stratum', () => {
  assert.equal(stratumOf('broken-test-discovery'), 'hard');
  assert.equal(stratumOf('env-contract'), 'saturated');
  assert.equal(stratumOf('some-users-own-repository'), null);
});

test('a stratum summary counts only its own cases', () => {
  const runs: EvalRun[] = [
    evalRun('broken-test-discovery', true),
    evalRun('chained-two-faults', false),
    evalRun('env-contract', true),
  ];

  const hard = summarizeStratum('hard', 'advanced', runs);
  assert.equal(hard.runs, 2);
  assert.equal(hard.verifiedRepairs, 1);

  const saturated = summarizeStratum('saturated', 'advanced', runs);
  assert.equal(saturated.runs, 1);
  assert.equal(saturated.verifiedRepairs, 1);
});

function evalRun(caseId: string, verified: boolean): EvalRun {
  return {
    caseId,
    mode: 'advanced',
    arm: null,
    repeat: 1,
    runId: null,
    status: verified ? 'repaired' : 'no-patch',
    verified,
    wallClockMs: 1000,
    cost: { kind: 'measured', usd: 0.01 },
    checks: [],
    error: null,
  };
}
