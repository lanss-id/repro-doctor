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
  type ExperimentName,
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
import { EXPERIMENTS, type ExperimentSpec } from './experiments.js';
import { summarizeArm, summarizeMode } from './scoring.js';

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
  /** Runs a two-arm experiment instead of the ordinary mode comparison. */
  readonly experiment?: ExperimentName;
}

/**
 * The mode comparison and the critic experiment answer different questions, so
 * they get different files. Sharing one meant that running the experiment
 * silently destroyed the comparison it was supposed to be measured against.
 */
export function evalReportPath(experiment: ExperimentName | null = null): string {
  const name = experiment === null ? 'eval.json' : `eval-${experiment}.json`;
  return path.join(artifactsRoot(), 'eval', name);
}

interface PlannedRun {
  readonly fixture: FixtureLayout;
  readonly mode: Mode;
  readonly arm: ExperimentArm | null;
  readonly repeat: number;
  readonly criticEnabled: boolean;
  readonly retryEnabled: boolean;
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

  const spec = options.experiment === undefined ? null : EXPERIMENTS[options.experiment];
  const selected = spec === null ? options.cases : spec.cases;
  const fixtures = (await loadAllFixtures()).filter(
    (fixture) => selected === undefined || selected.includes(fixture.meta.id),
  );
  // Every experiment holds mode fixed and varies one thing inside advanced
  // mode, so a batch that ran both modes would be comparing two things at once.
  const modes: readonly Mode[] = spec === null ? (options.modes ?? MODES) : ['advanced'];

  const runs: EvalRun[] = [];
  let status: EvalStatus = { kind: 'complete' };

  const blocked = blockingReason(live, config.apiKey, priceTable, model);
  if (blocked !== null) {
    status = blocked;
    logger.warn('eval.pending', { why: blocked.kind === 'pending' ? blocked.why : 'unknown' });
  } else {
    for (const planned of planRuns(fixtures, modes, options.repeats, spec)) {
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
          retryEnabled: planned.retryEnabled,
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
    experiment: spec === null ? null : experimentReport(spec, fixtures, runs),
  });

  const target = evalReportPath(options.experiment ?? null);
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  logger.info('eval.written', { path: target, status: report.status.kind, runs: runs.length });
  return report;
}

function planRuns(
  fixtures: readonly FixtureLayout[],
  modes: readonly Mode[],
  repeats: number,
  spec: ExperimentSpec | null,
): PlannedRun[] {
  const planned: PlannedRun[] = [];
  for (const fixture of fixtures) {
    for (const mode of modes) {
      for (let repeat = 1; repeat <= repeats; repeat += 1) {
        if (spec === null) {
          planned.push({
            fixture,
            mode,
            arm: null,
            repeat,
            criticEnabled: false,
            retryEnabled: true,
          });
          continue;
        }
        // Both arms of a repeat are planned next to each other so a batch that
        // stops early has run the same number of each, rather than a complete
        // control and a half-finished treatment.
        planned.push({ fixture, mode, arm: 'control', repeat, ...spec.control });
        planned.push({ fixture, mode, arm: 'treatment', repeat, ...spec.treatment });
      }
    }
  }
  return planned;
}

function experimentReport(
  spec: ExperimentSpec,
  fixtures: readonly FixtureLayout[],
  runs: readonly EvalRun[],
): ExperimentReport {
  const control = summarizeArm('advanced', 'control', runs);
  const treatment = summarizeArm('advanced', 'treatment', runs);
  return {
    name: spec.name,
    hypothesis: spec.hypothesis,
    rule: spec.rule,
    cases: fixtures.map((fixture) => fixture.meta.id),
    control,
    treatment,
    decision: spec.decide(control, treatment),
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
