import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { EvalReportSchema, type EvalReport, type EvalRun } from '../domain/eval.js';
import { ReproDoctorError } from '../domain/failure.js';
import type { FixtureLayout } from '../domain/fixture.js';
import { RunResultSchema, type RunResult } from '../domain/result.js';
import { loadAllFixtures } from '../fixtures/registry.js';
import { allPassed, evaluateRun } from './checks.js';

/**
 * Recomputes a published evaluation from the raw run artifacts committed beside
 * it, with no API key, no model, no Docker and no network.
 *
 * The point is not convenience. A reader who cannot afford to re-measure the
 * result can still re-derive it: the same scoring code runs again over the same
 * `result.json` and `trajectory.jsonl` files, and any verdict that comes out
 * differently is reported as a disagreement rather than quietly overwritten.
 * Re-running the model would produce different numbers by design, since the
 * provider is not deterministic; re-running the scorer must produce the same
 * ones, and this is what proves it does.
 */

export interface ReplayDisagreement {
  readonly runId: string;
  readonly field: string;
  readonly published: string;
  readonly recomputed: string;
}

export interface ReplayResult {
  readonly bundleDir: string;
  /** The report as it was published, parsed but not modified. */
  readonly published: EvalReport;
  /** The same runs, re-scored here. */
  readonly recomputed: readonly EvalRun[];
  readonly disagreements: readonly ReplayDisagreement[];
  /** Runs in the published report whose artifacts are not in the bundle. */
  readonly missingArtifacts: readonly string[];
  /**
   * True when the oracle-access check could only be re-run in its weaker form.
   * See `ORACLE_ACCESS_CAVEAT`.
   */
  readonly relocated: boolean;
}

/**
 * The oracle-access check looks for the absolute paths of the hidden fixture
 * directories inside the trajectory. Those paths belong to the machine that
 * produced the run, so on any other machine the check passes because it cannot
 * find strings that could never appear, not because it looked and found
 * nothing. The replay says so rather than counting it as a re-derivation.
 */
export const ORACLE_ACCESS_CAVEAT =
  'oracle-access was re-run against this machine\'s fixture paths. When the bundle was produced elsewhere, that check is weaker on replay than it was on the original run, and its agreement below is not independent evidence.';

export async function replayBundle(bundleDir: string): Promise<ReplayResult> {
  const reportPath = path.join(bundleDir, 'eval.json');
  const raw = await readFile(reportPath, 'utf8').catch(() => null);
  if (raw === null) {
    throw new ReproDoctorError(
      'internal-error',
      `no evaluation report at ${reportPath}`,
      'a replay bundle is a directory holding eval.json and a runs/ directory beside it',
    );
  }
  const published = EvalReportSchema.parse(JSON.parse(raw));
  const fixtures = new Map<string, FixtureLayout>(
    (await loadAllFixtures()).map((fixture) => [fixture.meta.id, fixture]),
  );

  const recomputed: EvalRun[] = [];
  const disagreements: ReplayDisagreement[] = [];
  const missingArtifacts: string[] = [];
  let relocated = false;

  for (const run of published.runs) {
    if (run.runId === null) {
      // A run that never produced a result has nothing to re-score. It is
      // carried through unchanged so the totals still add up.
      recomputed.push(run);
      continue;
    }
    const runDir = path.join(bundleDir, 'runs', run.runId);
    const resultRaw = await readFile(path.join(runDir, 'result.json'), 'utf8').catch(() => null);
    if (resultRaw === null) {
      missingArtifacts.push(run.runId);
      recomputed.push(run);
      continue;
    }
    const result = relocate(RunResultSchema.parse(JSON.parse(resultRaw)), runDir);
    relocated = true;
    const checks = await evaluateRun(result, fixtures.get(run.caseId) ?? null);
    const verified = result.verification.kind === 'passed' && allPassed(checks);
    recomputed.push({ ...run, checks, verified, status: result.outcome.status });

    if (verified !== run.verified) {
      disagreements.push({
        runId: run.runId,
        field: 'verified',
        published: String(run.verified),
        recomputed: String(verified),
      });
    }
    if (result.outcome.status !== run.status) {
      disagreements.push({
        runId: run.runId,
        field: 'status',
        published: run.status,
        recomputed: result.outcome.status,
      });
    }
    for (const check of checks) {
      const before = run.checks.find((entry) => entry.name === check.name);
      if (before !== undefined && before.passed !== check.passed) {
        disagreements.push({
          runId: run.runId,
          field: `check:${check.name}`,
          published: String(before.passed),
          recomputed: String(check.passed),
        });
      }
    }
  }

  return { bundleDir, published, recomputed, disagreements, missingArtifacts, relocated };
}

/**
 * Points the result at the artifacts in the bundle rather than at the absolute
 * paths of the machine that produced it. Nothing else about the result is
 * touched: the checks read the same bytes, from a different directory.
 */
function relocate(result: RunResult, runDir: string): RunResult {
  return {
    ...result,
    artifacts: {
      ...result.artifacts,
      trajectoryPath: path.join(runDir, 'trajectory.jsonl'),
      patchPath: path.join(runDir, 'repair.patch'),
      verificationLogPath: path.join(runDir, 'verification.log'),
    },
  };
}
