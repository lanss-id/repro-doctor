import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_BUDGET, type Budget } from '../domain/budget.js';
import { loadRuntimeConfig } from '../domain/config.js';
import {
  EVAL_SCHEMA_VERSION,
  EvalReportSchema,
  type EvalReport,
  type EvalRun,
  type EvalStatus,
  type ExperimentReport,
} from '../domain/eval.js';
import type { ExperimentArm } from '../domain/execution.js';
import { ReproDoctorError, describeError } from '../domain/failure.js';
import type { FixtureLayout } from '../domain/fixture.js';
import { MODES, type Mode } from '../domain/mode.js';
import type { ExecutorKind } from '../domain/result.js';
import { diagnose, type DiagnoseOptions } from '../agent/diagnose.js';
import { describePrice, hasPrice, loadPriceTable } from '../agent/pricing.js';
import { findIsolationProblems, loadAllFixtures } from '../fixtures/registry.js';
import { artifactsRoot } from '../infra/project-root.js';
import { createLogger, type Logger } from '../infra/log.js';
import { allPassed, evaluateRun } from './checks.js';
import {
  MAX_COST_INCREASE_PERCENT,
  MIN_REPAIR_RATE_GAIN_POINTS,
  decideExperiment,
  summarizeArm,
  summarizeMode,
} from './scoring.js';

export const CRITIC_EXPERIMENT_CASES: readonly string[] = [
  'broken-test-discovery',
  'manifest-lockfile-mismatch',
  'chained-two-faults',
];

export const CRITIC_HYPOTHESIS =
  'A critic call that reviews the proposed patch against the hypothesis ledger, and can send it back once, catches patches that satisfy the visible check without satisfying the contract.';

export const CRITIC_RULE = `Keep the critic only for at least +${MIN_REPAIR_RATE_GAIN_POINTS} percentage points of verified repair rate at no more than +${MAX_COST_INCREASE_PERCENT} percent median cost, measured against advanced mode without the critic over the same cases and repeats.`;

export interface EvalOptions {
  readonly repeats: number;
  readonly cases?: readonly string[];
  readonly modes?: readonly Mode[];
  readonly budget?: Budget;
  readonly executorKind?: ExecutorKind;
  readonly logger?: Logger;
  readonly env?: NodeJS.ProcessEnv;
  readonly allowLocalAdapter?: boolean;
  readonly driverFactory?: DiagnoseOptions['driverFactory'];
  readonly criticFactory?: DiagnoseOptions['criticFactory'];
  readonly modelOverride?: string;
  /** `critic` runs the A/B experiment instead of the ordinary mode comparison. */
  readonly experiment?: 'critic';
}

/**
 * The mode comparison and the critic experiment answer different questions, so
 * they get different files. Sharing one meant that running the experiment
 * silently destroyed the comparison it was supposed to be measured against.
 */
export function evalReportPath(experiment: 'critic' | null = null): string {
  const name = experiment === null ? 'eval.json' : `eval-${experiment}.json`;
  return path.join(artifactsRoot(), 'eval', name);
}

interface PlannedRun {
  readonly fixture: FixtureLayout;
  readonly mode: Mode;
  readonly arm: ExperimentArm | null;
  readonly repeat: number;
  readonly criticEnabled: boolean;
}

/**
 * Runs the benchmark and scores the results.
 *
 * It fails closed twice before spending anything: once if a fixture leaks its
 * answers, and once if the pinned model has no configured token price, because
 * an unpriced batch cannot report a cost or enforce a cost budget. With no API
 * key it does not run at all and says so.
 */
export async function runEvaluation(options: EvalOptions): Promise<EvalReport> {
  const env = options.env ?? process.env;
  const config = loadRuntimeConfig(env);
  const logger = options.logger ?? createLogger();
  const budget = options.budget ?? DEFAULT_BUDGET;
  const executorKind = options.executorKind ?? config.defaultExecutor;
  const model = options.modelOverride ?? config.model;
  const priceTable = loadPriceTable(env);
  const live = options.driverFactory === undefined;

  const isolationProblems = await findIsolationProblems();
  if (isolationProblems.length > 0) {
    throw new ReproDoctorError(
      'oracle-error',
      'fixture isolation is broken; refusing to score anything',
      isolationProblems.map((problem) => `${problem.caseId}: ${problem.problem}`).join('; '),
    );
  }

  const experiment = options.experiment ?? null;
  const selected = experiment === 'critic' ? CRITIC_EXPERIMENT_CASES : options.cases;
  const fixtures = (await loadAllFixtures()).filter(
    (fixture) => selected === undefined || selected.includes(fixture.meta.id),
  );
  const modes: readonly Mode[] =
    experiment === 'critic' ? ['advanced'] : (options.modes ?? MODES);

  const runs: EvalRun[] = [];
  let status: EvalStatus = { kind: 'complete' };

  const blocked = blockingReason(live, config.apiKey, priceTable, model);
  if (blocked !== null) {
    status = blocked;
    logger.warn('eval.pending', { why: blocked.kind === 'pending' ? blocked.why : 'unknown' });
  } else {
    for (const planned of planRuns(fixtures, modes, options.repeats, experiment)) {
      logger.info('eval.run.start', {
        case: planned.fixture.meta.id,
        mode: planned.mode,
        arm: planned.arm ?? 'none',
        repeat: planned.repeat,
      });
      const started = Date.now();
      try {
        const result = await diagnose({
          repoPath: planned.fixture.repoDir,
          mode: planned.mode,
          budget,
          executorKind,
          caseId: planned.fixture.meta.id,
          oracle: {
            id: `${planned.fixture.meta.id}/oracle`,
            directory: planned.fixture.oracleDir,
            entry: planned.fixture.meta.oracle.entry,
            timeoutSeconds: planned.fixture.meta.oracle.timeoutSeconds,
          },
          logger,
          env,
          modelOverride: model,
          criticEnabled: planned.criticEnabled,
          ...(options.criticFactory === undefined ? {} : { criticFactory: options.criticFactory }),
          ...(options.allowLocalAdapter === undefined
            ? {}
            : { allowLocalAdapter: options.allowLocalAdapter }),
          ...(options.driverFactory === undefined ? {} : { driverFactory: options.driverFactory }),
        });
        const checks = await evaluateRun(result, planned.fixture);
        runs.push({
          caseId: planned.fixture.meta.id,
          mode: planned.mode,
          arm: planned.arm,
          repeat: planned.repeat,
          runId: result.runId,
          status: result.outcome.status,
          verified: result.verification.kind === 'passed' && allPassed(checks),
          wallClockMs: result.usage.wallClockMs,
          cost: result.usage.cost,
          checks,
          error: null,
        });
      } catch (error) {
        logger.error('eval.run.failed', {
          case: planned.fixture.meta.id,
          mode: planned.mode,
          message: describeError(error),
        });
        runs.push({
          caseId: planned.fixture.meta.id,
          mode: planned.mode,
          arm: planned.arm,
          repeat: planned.repeat,
          runId: null,
          status: 'failed',
          verified: false,
          wallClockMs: Date.now() - started,
          cost: { kind: 'unknown', why: 'no-model-call' },
          checks: [],
          error: describeError(error),
        });
        status = { kind: 'partial', detail: 'at least one run failed before producing a result' };
      }
    }
  }

  const report: EvalReport = EvalReportSchema.parse({
    schemaVersion: EVAL_SCHEMA_VERSION,
    generatedAt: new Date().toISOString(),
    status,
    model,
    executor: executorKind,
    repeats: options.repeats,
    budget,
    cases: fixtures.map((fixture) => fixture.meta.id),
    runs,
    summaries: modes.map((mode) => summarizeMode(mode, runs)),
    experiment: experiment === 'critic' ? criticReport(fixtures, runs) : null,
  });

  const target = evalReportPath(experiment);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  logger.info('eval.written', { path: target, status: report.status.kind, runs: runs.length });
  return report;
}

function planRuns(
  fixtures: readonly FixtureLayout[],
  modes: readonly Mode[],
  repeats: number,
  experiment: 'critic' | null,
): PlannedRun[] {
  const planned: PlannedRun[] = [];
  for (const fixture of fixtures) {
    for (const mode of modes) {
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        if (experiment === 'critic') {
          planned.push({ fixture, mode, arm: 'control', repeat, criticEnabled: false });
          planned.push({ fixture, mode, arm: 'treatment', repeat, criticEnabled: true });
        } else {
          planned.push({ fixture, mode, arm: null, repeat, criticEnabled: false });
        }
      }
    }
  }
  return planned;
}

function criticReport(fixtures: readonly FixtureLayout[], runs: readonly EvalRun[]): ExperimentReport {
  const control = summarizeArm('advanced', 'control', runs);
  const treatment = summarizeArm('advanced', 'treatment', runs);
  return {
    name: 'critic',
    hypothesis: CRITIC_HYPOTHESIS,
    rule: CRITIC_RULE,
    cases: fixtures.map((fixture) => fixture.meta.id),
    control,
    treatment,
    decision: decideExperiment(control, treatment),
  };
}

function blockingReason(
  live: boolean,
  apiKey: string | null,
  priceTable: ReturnType<typeof loadPriceTable>,
  model: string,
): EvalStatus | null {
  if (!live) {
    return null;
  }
  if (apiKey === null) {
    return {
      kind: 'pending',
      why: 'missing-api-key',
      detail:
        'OPENAI_API_KEY is not set, so no live run happened. Every number in this report is pending, not zero.',
    };
  }
  if (!hasPrice(priceTable, model)) {
    return {
      kind: 'pending',
      why: 'no-price-configured',
      detail: `${describePrice(priceTable, model)}. A scored batch will not run without one: the cost budget could not be enforced and the reported cost would be unknown. Add the model to config/pricing.json, or set REPRO_DOCTOR_PRICE_INPUT_PER_MTOK and REPRO_DOCTOR_PRICE_OUTPUT_PER_MTOK.`,
    };
  }
  return null;
}
