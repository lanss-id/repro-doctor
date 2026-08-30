import type { EvalRun, ModeSummary } from '../domain/eval.js';
import type { Mode } from '../domain/mode.js';
import { summarizeMode } from './scoring.js';

/**
 * Difficulty strata over the benchmark, frozen in docs/PREREGISTRATION.md
 * before the confirmatory batch ran.
 *
 * Membership was assigned by the exploratory batch's *baseline* result alone: a
 * case baseline never repaired in three attempts is hard, a case it repaired at
 * least twice is saturated. The advanced result played no part in the split,
 * and the split is not revised after a batch no matter what the batch shows.
 * Both of those are the only reason a stratified number means anything: a
 * subgroup chosen after seeing the answer is not evidence, it is decoration.
 *
 * The split exists because the aggregate hides a ceiling. Baseline scores 14/15
 * on the saturated stratum, so advanced has almost no room to differ there, and
 * averaging the two strata dilutes whatever difference the hard stratum holds.
 */
export const DIFFICULTY_STRATA = {
  saturated: [
    'case-sensitive-import',
    'entrypoint-mismatch',
    'env-contract',
    'esm-cjs-mismatch',
    'health-route-port',
  ],
  hard: [
    'broken-test-discovery',
    'chained-two-faults',
    'manifest-lockfile-mismatch',
    'monorepo-build-order',
    'tsconfig-include-scope',
  ],
} as const;

export type StratumName = keyof typeof DIFFICULTY_STRATA;

export const STRATUM_NAMES: readonly StratumName[] = Object.keys(
  DIFFICULTY_STRATA,
) as StratumName[];

/** Null for a case outside the benchmark, which is never scored by stratum. */
export function stratumOf(caseId: string): StratumName | null {
  for (const name of STRATUM_NAMES) {
    if ((DIFFICULTY_STRATA[name] as readonly string[]).includes(caseId)) {
      return name;
    }
  }
  return null;
}

export function summarizeStratum(
  stratum: StratumName,
  mode: Mode,
  runs: readonly EvalRun[],
): ModeSummary {
  return summarizeMode(
    mode,
    runs.filter((run) => stratumOf(run.caseId) === stratum),
  );
}
