import type { EvalRun, ModeSummary } from '../domain/eval.js';
import type { ExperimentArm } from '../domain/execution.js';
import type { Mode } from '../domain/mode.js';

export function median(values: readonly number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) {
    return sorted[middle] ?? null;
  }
  const low = sorted[middle - 1];
  const high = sorted[middle];
  if (low === undefined || high === undefined) {
    return null;
  }
  return (low + high) / 2;
}

/**
 * Aggregates one mode's runs. Rates stay null when nothing ran, and the median
 * cost is null unless every counted run has a measured cost, so a partly priced
 * batch cannot look cheaper than it was.
 */
export function summarizeMode(mode: Mode, runs: readonly EvalRun[]): ModeSummary {
  return summarizeSubset(mode, runs.filter((run) => run.mode === mode));
}

/** Same aggregation for one arm of an experiment. */
export function summarizeArm(mode: Mode, arm: ExperimentArm, runs: readonly EvalRun[]): ModeSummary {
  return summarizeSubset(
    mode,
    runs.filter((run) => run.mode === mode && run.arm === arm),
  );
}

function summarizeSubset(mode: Mode, forMode: readonly EvalRun[]): ModeSummary {
  const verified = forMode.filter((run) => run.verified);
  const costs = forMode
    .map((run) => (run.cost.kind === 'measured' ? run.cost.usd : null))
    .filter((value): value is number => value !== null);
  const costUnknownRuns = forMode.length - costs.length;
  return {
    mode,
    runs: forMode.length,
    verifiedRepairs: verified.length,
    verifiedRepairRate: forMode.length === 0 ? null : verified.length / forMode.length,
    medianWallClockMs: median(forMode.map((run) => run.wallClockMs)),
    medianCostUsd: costUnknownRuns > 0 ? null : median(costs),
    costUnknownRuns,
    unsafeMutations: countFailed(forMode, 'source-immutability'),
    budgetViolations: countFailed(forMode, 'budget-compliance'),
    oracleAccessViolations: countFailed(forMode, 'oracle-access'),
  };
}

function countFailed(runs: readonly EvalRun[], name: string): number {
  return runs.filter((run) => run.checks.some((check) => check.name === name && !check.passed)).length;
}

export interface ExperimentDecision {
  readonly status: 'pending' | 'keep' | 'discard' | 'unresolved';
  readonly keep: boolean;
  /**
   * The difference the experiment's own rule is about, in percentage points.
   * For an A/B test that is treatment minus control. For an ablation it is
   * control minus treatment, which is what removing the ingredient costs.
   */
  readonly repairRateDeltaPoints: number | null;
  readonly costChangePercent: number | null;
  /** The 95 percent interval on `repairRateDeltaPoints`, in the same units. */
  readonly intervalLowPoints: number | null;
  readonly intervalHighPoints: number | null;
  readonly reason: string;
}

/** Percentage points, or null when the interval could not be computed. */
function intervalPoints(
  difference: ProportionDifference | null,
): { low: number | null; high: number | null } {
  return difference === null
    ? { low: null, high: null }
    : { low: difference.low * 100, high: difference.high * 100 };
}

export const MIN_REPAIR_RATE_GAIN_POINTS = 10;
export const MAX_COST_INCREASE_PERCENT = 25;

/**
 * The pre-registered rule for the critic-agent experiment: keep the variant only
 * if it gains at least 10 percentage points of verified repair rate for no more
 * than 25 percent extra cost. Written down before the experiment so the result
 * cannot be reinterpreted after the fact.
 */
export function decideExperiment(
  control: ModeSummary,
  treatment: ModeSummary,
): ExperimentDecision {
  if (control.verifiedRepairRate === null || treatment.verifiedRepairRate === null) {
    return {
      status: 'pending',
      keep: false,
      repairRateDeltaPoints: null,
      costChangePercent: null,
      intervalLowPoints: null,
      intervalHighPoints: null,
      reason: 'no measured repair rate on one side, so the rule cannot be applied',
    };
  }
  const deltaPoints = (treatment.verifiedRepairRate - control.verifiedRepairRate) * 100;
  // The rule below is about the point estimate, but a point estimate published
  // without its interval is a reporting error even when the rule does not use
  // it, so the interval is carried on the record either way.
  const spread = intervalPoints(
    proportionDifferenceInterval(
      treatment.verifiedRepairs,
      treatment.runs,
      control.verifiedRepairs,
      control.runs,
    ),
  );
  if (control.medianCostUsd === null || treatment.medianCostUsd === null) {
    return {
      status: 'pending',
      keep: false,
      repairRateDeltaPoints: deltaPoints,
      costChangePercent: null,
      intervalLowPoints: spread.low,
      intervalHighPoints: spread.high,
      reason: 'cost is unknown on at least one side, so the cost ceiling cannot be checked',
    };
  }
  const costChange =
    control.medianCostUsd === 0
      ? treatment.medianCostUsd === 0
        ? 0
        : Number.POSITIVE_INFINITY
      : ((treatment.medianCostUsd - control.medianCostUsd) / control.medianCostUsd) * 100;
  const gainEnough = deltaPoints >= MIN_REPAIR_RATE_GAIN_POINTS;
  const costOk = costChange <= MAX_COST_INCREASE_PERCENT;
  return {
    status: gainEnough && costOk ? 'keep' : 'discard',
    keep: gainEnough && costOk,
    repairRateDeltaPoints: deltaPoints,
    costChangePercent: costChange,
    intervalLowPoints: spread.low,
    intervalHighPoints: spread.high,
    reason: gainEnough
      ? costOk
        ? `+${deltaPoints.toFixed(1)} points for ${costChange.toFixed(1)}% cost change, both within the rule`
        : `repair rate gain is enough but cost rose ${costChange.toFixed(1)}%, over the ${MAX_COST_INCREASE_PERCENT}% ceiling`
      : `repair rate gain of ${deltaPoints.toFixed(1)} points is below the ${MIN_REPAIR_RATE_GAIN_POINTS} point threshold`,
  };
}

/** Standard normal quantile for a two-sided 95 percent interval. */
const Z_95 = 1.96;

export interface ProportionInterval {
  readonly low: number;
  readonly high: number;
}

/**
 * Wilson score interval for a proportion. Ten runs per mode cannot support a
 * point estimate on its own, and a rate printed without one invites a reader to
 * treat 70 percent as if it were measured to the percentage point. Wilson
 * rather than the normal approximation because it stays inside [0, 1] and still
 * says something useful at zero and at one, where this benchmark often lands.
 */
export function wilsonInterval(successes: number, total: number): ProportionInterval | null {
  if (total <= 0) {
    return null;
  }
  const p = successes / total;
  const zSquaredOverN = (Z_95 * Z_95) / total;
  const denominator = 1 + zSquaredOverN;
  const center = (p + zSquaredOverN / 2) / denominator;
  const spread =
    (Z_95 / denominator) * Math.sqrt((p * (1 - p)) / total + (Z_95 * Z_95) / (4 * total * total));
  return {
    low: Math.max(0, center - spread),
    high: Math.min(1, center + spread),
  };
}

export interface ProportionDifference {
  /** The observed difference, treatment minus control, as a proportion. */
  readonly point: number;
  readonly low: number;
  readonly high: number;
}

/**
 * Newcombe's interval for the difference between two proportions, built from
 * the two Wilson intervals. The headline of this project is a comparison, not a
 * pair of rates, and a comparison whose interval includes zero has not shown
 * what a reader will assume it showed. The normal approximation is avoided for
 * the same reason Wilson is used above: it misbehaves near zero and one.
 */
export function proportionDifferenceInterval(
  treatmentSuccesses: number,
  treatmentTotal: number,
  controlSuccesses: number,
  controlTotal: number,
): ProportionDifference | null {
  const treatment = wilsonInterval(treatmentSuccesses, treatmentTotal);
  const control = wilsonInterval(controlSuccesses, controlTotal);
  if (treatment === null || control === null) {
    return null;
  }
  const treatmentRate = treatmentSuccesses / treatmentTotal;
  const controlRate = controlSuccesses / controlTotal;
  const point = treatmentRate - controlRate;
  const belowTreatment = treatmentRate - treatment.low;
  const aboveTreatment = treatment.high - treatmentRate;
  const belowControl = controlRate - control.low;
  const aboveControl = control.high - controlRate;
  return {
    point,
    low: point - Math.hypot(belowTreatment, aboveControl),
    high: point + Math.hypot(aboveTreatment, belowControl),
  };
}

/** The difference in percentage points, signed, with its interval. */
export function formatDifferencePoints(difference: ProportionDifference | null): string {
  if (difference === null) {
    return 'pending';
  }
  const points = (value: number): string => `${value >= 0 ? '+' : '-'}${Math.abs(value * 100).toFixed(1)}`;
  return `${points(difference.point)} points (95% CI ${points(difference.low)} to ${points(difference.high)})`;
}

/** A rate with the uncertainty its sample size carries, or `pending` when unmeasured. */
export function formatRateWithInterval(
  rate: number | null,
  successes: number,
  total: number,
): string {
  const interval = wilsonInterval(successes, total);
  if (rate === null || interval === null) {
    return formatRate(rate);
  }
  const low = (interval.low * 100).toFixed(1);
  const high = (interval.high * 100).toFixed(1);
  return `${formatRate(rate)} (95% CI ${low}-${high}%)`;
}

export function formatRate(rate: number | null): string {
  return rate === null ? 'pending' : `${(rate * 100).toFixed(1)}%`;
}

export function formatMillis(value: number | null): string {
  return value === null ? 'pending' : `${(value / 1000).toFixed(1)}s`;
}

export function formatUsd(value: number | null): string {
  return value === null ? 'unknown' : `$${value.toFixed(4)}`;
}

/**
 * The pre-registered rule for an ablation: an ingredient is only called
 * load-bearing when the 95 percent interval on what removing it costs excludes
 * zero.
 *
 * Unlike the critic rule this one has three outcomes rather than two, because
 * "removing it did not measurably hurt" and "we could not tell" are different
 * answers and collapsing them into one verdict is the exact error this project
 * exists to argue against. An unresolved ablation leaves the ingredient in
 * place on the weaker ground that it was not shown to hurt, and says so.
 */
export function decideAblation(
  control: ModeSummary,
  treatment: ModeSummary,
): ExperimentDecision {
  if (control.verifiedRepairRate === null || treatment.verifiedRepairRate === null) {
    return {
      status: 'pending',
      keep: false,
      repairRateDeltaPoints: null,
      costChangePercent: null,
      intervalLowPoints: null,
      intervalHighPoints: null,
      reason: 'no measured repair rate on one side, so the rule cannot be applied',
    };
  }
  // Control minus treatment, so a positive number is what removing the
  // ingredient costs rather than what keeping it gains.
  const difference = proportionDifferenceInterval(
    control.verifiedRepairs,
    control.runs,
    treatment.verifiedRepairs,
    treatment.runs,
  );
  const spread = intervalPoints(difference);
  const deltaPoints = (control.verifiedRepairRate - treatment.verifiedRepairRate) * 100;
  const costChange =
    control.medianCostUsd === null || treatment.medianCostUsd === null || control.medianCostUsd === 0
      ? null
      : ((treatment.medianCostUsd - control.medianCostUsd) / control.medianCostUsd) * 100;
  const points = (value: number): string => `${value >= 0 ? '+' : '-'}${Math.abs(value).toFixed(1)}`;
  if (difference === null) {
    return {
      status: 'pending',
      keep: false,
      repairRateDeltaPoints: deltaPoints,
      costChangePercent: costChange,
      intervalLowPoints: null,
      intervalHighPoints: null,
      reason: 'the difference interval could not be computed, so the rule cannot be applied',
    };
  }
  const interval = `95% CI ${points(difference.low * 100)} to ${points(difference.high * 100)}`;
  if (difference.low > 0) {
    return {
      status: 'keep',
      keep: true,
      repairRateDeltaPoints: deltaPoints,
      costChangePercent: costChange,
      intervalLowPoints: spread.low,
      intervalHighPoints: spread.high,
      reason: `removing it cost ${points(deltaPoints)} points (${interval}), an interval that excludes zero, so it is load-bearing`,
    };
  }
  if (difference.high < 0) {
    return {
      status: 'discard',
      keep: false,
      repairRateDeltaPoints: deltaPoints,
      costChangePercent: costChange,
      intervalLowPoints: spread.low,
      intervalHighPoints: spread.high,
      reason: `removing it changed the rate by ${points(deltaPoints)} points (${interval}), an interval that excludes zero in the other direction, so it should go`,
    };
  }
  return {
    status: 'unresolved',
    keep: true,
    repairRateDeltaPoints: deltaPoints,
    costChangePercent: costChange,
    intervalLowPoints: spread.low,
    intervalHighPoints: spread.high,
    reason: `removing it changed the rate by ${points(deltaPoints)} points (${interval}), an interval that includes zero, so this batch does not establish that it is load-bearing; it stays because it was not shown to hurt, which is a weaker reason`,
  };
}
