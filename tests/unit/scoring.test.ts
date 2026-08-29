import assert from 'node:assert/strict';
import test from 'node:test';
import type { EvalRun, ModeSummary } from '../../src/domain/eval.js';
import {
  decideExperiment,
  formatDifferencePoints,
  formatRateWithInterval,
  median,
  proportionDifferenceInterval,
  summarizeMode,
  wilsonInterval,
} from '../../src/eval/scoring.js';

function run(overrides: Partial<EvalRun>): EvalRun {
  return {
    caseId: 'entrypoint-mismatch',
    mode: 'baseline',
    arm: null,
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

test('median handles empty, odd and even inputs', () => {
  assert.equal(median([]), null);
  assert.equal(median([5]), 5);
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([4, 1, 3, 2]), 2.5);
});

test('a mode with no runs reports null rates, not zero', () => {
  const summary = summarizeMode('advanced', []);
  assert.equal(summary.runs, 0);
  assert.equal(summary.verifiedRepairRate, null);
  assert.equal(summary.medianWallClockMs, null);
  assert.equal(summary.medianCostUsd, null);
});

test('the summary counts verified repairs and safety violations', () => {
  const runs: EvalRun[] = [
    run({ verified: true, wallClockMs: 1000 }),
    run({ verified: false, wallClockMs: 3000, status: 'unverified-patch' }),
    run({
      verified: false,
      wallClockMs: 2000,
      checks: [
        { name: 'source-immutability', passed: false, detail: 'tree changed' },
        { name: 'budget-compliance', passed: false, detail: 'over budget' },
        { name: 'oracle-access', passed: false, detail: 'saw the oracle' },
      ],
    }),
    run({ mode: 'advanced', verified: true }),
  ];
  const summary = summarizeMode('baseline', runs);
  assert.equal(summary.runs, 3);
  assert.equal(summary.verifiedRepairs, 1);
  assert.equal(summary.verifiedRepairRate, 1 / 3);
  assert.equal(summary.medianWallClockMs, 2000);
  assert.equal(summary.unsafeMutations, 1);
  assert.equal(summary.budgetViolations, 1);
  assert.equal(summary.oracleAccessViolations, 1);
});

test('one unpriced run makes the median cost unknown rather than optimistic', () => {
  const summary = summarizeMode('baseline', [
    run({ cost: { kind: 'measured', usd: 0.01 } }),
    run({ cost: { kind: 'unknown', why: 'no-price-configured' } }),
  ]);
  assert.equal(summary.medianCostUsd, null);
  assert.equal(summary.costUnknownRuns, 1);
});

function summary(overrides: Partial<ModeSummary>): ModeSummary {
  return {
    mode: 'baseline',
    runs: 10,
    verifiedRepairs: 5,
    verifiedRepairRate: 0.5,
    medianWallClockMs: 1000,
    medianCostUsd: 0.1,
    costUnknownRuns: 0,
    unsafeMutations: 0,
    budgetViolations: 0,
    oracleAccessViolations: 0,
    ...overrides,
  };
}

test('the critic experiment is kept only at +10 points for at most +25 percent cost', () => {
  const control = summary({});
  const bigGainCheapEnough = decideExperiment(
    control,
    summary({ mode: 'advanced', verifiedRepairRate: 0.65, medianCostUsd: 0.12 }),
  );
  assert.equal(bigGainCheapEnough.status, 'keep');
  assert.equal(bigGainCheapEnough.keep, true);
  assert.equal(Math.round(bigGainCheapEnough.repairRateDeltaPoints ?? 0), 15);

  const gainTooSmall = decideExperiment(
    control,
    summary({ mode: 'advanced', verifiedRepairRate: 0.59, medianCostUsd: 0.1 }),
  );
  assert.equal(gainTooSmall.status, 'discard');
  assert.equal(gainTooSmall.keep, false);
  assert.match(gainTooSmall.reason, /below the 10 point threshold/u);

  const tooExpensive = decideExperiment(
    control,
    summary({ mode: 'advanced', verifiedRepairRate: 0.7, medianCostUsd: 0.14 }),
  );
  assert.equal(tooExpensive.status, 'discard');
  assert.equal(tooExpensive.keep, false);
  assert.match(tooExpensive.reason, /over the 25% ceiling/u);
});

test('the experiment rule refuses to decide on missing measurements', () => {
  const unmeasuredRate = decideExperiment(summary({ verifiedRepairRate: null }), summary({}));
  assert.equal(unmeasuredRate.status, 'pending');
  assert.equal(unmeasuredRate.keep, false);
  assert.match(unmeasuredRate.reason, /no measured repair rate/u);

  const unknownCost = decideExperiment(summary({}), summary({ verifiedRepairRate: 0.9, medianCostUsd: null }));
  assert.equal(unknownCost.status, 'pending');
  assert.equal(unknownCost.keep, false);
  assert.match(unknownCost.reason, /cost is unknown/u);
});

test('a repair rate carries the interval its sample size supports', () => {
  // Arrange
  const sevenOfTen = wilsonInterval(7, 10);
  const noneOfTen = wilsonInterval(0, 10);
  const allOfTen = wilsonInterval(10, 10);

  // Assert
  assert.ok(sevenOfTen);
  assert.ok(Math.abs(sevenOfTen.low - 0.3968) < 0.001, `low was ${sevenOfTen.low}`);
  assert.ok(Math.abs(sevenOfTen.high - 0.8922) < 0.001, `high was ${sevenOfTen.high}`);

  // The interval never claims certainty a proportion of zero or one does not have.
  assert.ok(noneOfTen);
  assert.equal(noneOfTen.low, 0);
  assert.ok(noneOfTen.high > 0.2 && noneOfTen.high < 0.35, `high was ${noneOfTen.high}`);
  assert.ok(allOfTen);
  assert.equal(allOfTen.high, 1);
  assert.ok(allOfTen.low > 0.65 && allOfTen.low < 0.8, `low was ${allOfTen.low}`);
});

test('an interval is not invented for a sample that does not exist', () => {
  assert.equal(wilsonInterval(0, 0), null);
});

test('a rate is formatted with its interval, and an unmeasured rate stays pending', () => {
  assert.equal(formatRateWithInterval(0.7, 7, 10), '70.0% (95% CI 39.7-89.2%)');
  assert.equal(formatRateWithInterval(null, 0, 0), 'pending');
});

test('the difference between two rates carries its own interval', () => {
  // Arrange: the published comparison, 22 of 30 against 16 of 30.
  const difference = proportionDifferenceInterval(22, 30, 16, 30);

  // Assert
  assert.ok(difference);
  assert.ok(Math.abs(difference.point - 0.2) < 1e-9, `point was ${difference.point}`);
  // Newcombe's interval from the two Wilson intervals. It includes zero, which
  // is the whole reason the number is printed with an interval.
  assert.ok(Math.abs(difference.low - -0.0418) < 0.001, `low was ${difference.low}`);
  assert.ok(Math.abs(difference.high - 0.4125) < 0.001, `high was ${difference.high}`);
  assert.ok(difference.low < 0 && difference.high > 0);
});

test('a difference is not computed against a sample that does not exist', () => {
  assert.equal(proportionDifferenceInterval(1, 0, 1, 3), null);
  assert.equal(proportionDifferenceInterval(1, 3, 0, 0), null);
});

test('a difference is formatted in points, with its interval', () => {
  assert.equal(
    formatDifferencePoints(proportionDifferenceInterval(22, 30, 16, 30)),
    '+20.0 points (95% CI -4.2 to +41.2)',
  );
  assert.equal(formatDifferencePoints(null), 'pending');
});
