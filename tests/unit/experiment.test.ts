import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvalRun } from '../../src/domain/eval.js';
import { parseCriticVerdict } from '../../src/agent/driver.js';
import { summarizeArm } from '../../src/eval/scoring.js';

function run(overrides: Partial<EvalRun>): EvalRun {
  return {
    caseId: 'broken-test-discovery',
    mode: 'advanced',
    arm: 'control',
    repeat: 1,
    runId: null,
    status: 'repaired',
    verified: true,
    wallClockMs: 1000,
    cost: { kind: 'measured', usd: 0.01 },
    checks: [],
    error: null,
    ...overrides,
  };
}

test('an arm is summarized from its own runs only', () => {
  const runs: EvalRun[] = [
    run({ arm: 'control', verified: true, cost: { kind: 'measured', usd: 0.01 } }),
    run({ arm: 'control', verified: false, cost: { kind: 'measured', usd: 0.01 } }),
    run({ arm: 'treatment', verified: true, cost: { kind: 'measured', usd: 0.02 } }),
    run({ arm: 'treatment', verified: true, cost: { kind: 'measured', usd: 0.02 } }),
    run({ arm: null, mode: 'baseline', verified: true }),
  ];
  const control = summarizeArm('advanced', 'control', runs);
  const treatment = summarizeArm('advanced', 'treatment', runs);
  assert.equal(control.runs, 2);
  assert.equal(control.verifiedRepairRate, 0.5);
  assert.equal(control.medianCostUsd, 0.01);
  assert.equal(treatment.runs, 2);
  assert.equal(treatment.verifiedRepairRate, 1);
  assert.equal(treatment.medianCostUsd, 0.02);
});

test('a critic verdict is read from the JSON object it was asked for', () => {
  const approve = parseCriticVerdict('{"verdict":"approve","reason":"the patch matches the ledger"}');
  assert.equal(approve.parsed, true);
  if (!approve.parsed) return;
  assert.equal(approve.value.verdict, 'approve');

  const wrapped = parseCriticVerdict('Here you go:\n{"verdict":"revise","reason":"unrelated edit"}\nthanks');
  assert.equal(wrapped.parsed, true);
  if (!wrapped.parsed) return;
  assert.equal(wrapped.value.verdict, 'revise');
});

test('an unparseable critic reply is not treated as an approval', () => {
  for (const reply of ['looks good to me', '', '{"verdict":"maybe"}', '{ not json ']) {
    assert.equal(parseCriticVerdict(reply).parsed, false, `parsed: ${reply}`);
  }
});
