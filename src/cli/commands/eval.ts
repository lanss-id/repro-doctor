import { DEFAULT_BUDGET } from '../../domain/budget.js';
import { ExperimentNameSchema } from '../../domain/eval.js';
import { ReproDoctorError } from '../../domain/failure.js';
import { ModeSchema, type Mode } from '../../domain/mode.js';
import { ExecutorKindSchema } from '../../domain/result.js';
import { EXPERIMENTS, EXPERIMENT_NAMES } from '../../eval/experiments.js';
import { runEvaluation, evalReportPath } from '../../eval/run-eval.js';
import {
  formatDifferencePoints,
  formatMillis,
  formatRateWithInterval,
  formatUsd,
  proportionDifferenceInterval,
} from '../../eval/scoring.js';
import { createLogger } from '../../infra/log.js';
import { assertKnownFlags, numberFlag, stringFlag, type ParsedArgs } from '../args.js';
import type { Presenter } from '../presenter.js';

const KNOWN_FLAGS = ['repeats', 'case', 'mode', 'executor', 'experiment', 'max-tool-calls'];

export async function evalCommand(args: ParsedArgs, presenter: Presenter): Promise<number> {
  assertKnownFlags(args, KNOWN_FLAGS);
  const repeats = numberFlag(args, 'repeats') ?? 3;
  const caseFilter = stringFlag(args, 'case');
  const modeFilter = stringFlag(args, 'mode');
  const executorFlag = stringFlag(args, 'executor');
  const experimentFlag = stringFlag(args, 'experiment');
  const maxToolCalls = numberFlag(args, 'max-tool-calls');
  if (experimentFlag !== null && !EXPERIMENT_NAMES.some((name) => name === experimentFlag)) {
    throw new ReproDoctorError(
      'internal-error',
      `unknown experiment: ${experimentFlag}`,
      `the experiments are: ${EXPERIMENT_NAMES.join(', ')}`,
    );
  }
  const spec = experimentFlag === null ? null : EXPERIMENTS[ExperimentNameSchema.parse(experimentFlag)];
  const modes: readonly Mode[] | undefined =
    modeFilter === null ? undefined : [ModeSchema.parse(modeFilter)];

  // Raising the tool-call ceiling is the one budget knob the evaluation exposes,
  // because it is the one the budget-sensitivity experiment turns. It applies to
  // both modes at once: changing it for one arm alone would break the fairness
  // contract the whole comparison rests on.
  const budget =
    maxToolCalls === null
      ? undefined
      : { ...DEFAULT_BUDGET, maxToolCalls: Math.max(1, Math.trunc(maxToolCalls)) };

  presenter.heading(spec === null ? 'Evaluation' : `Experiment: ${spec.name}`);
  presenter.keyValue('repeats per case', String(repeats));
  presenter.keyValue('cases', spec === null ? (caseFilter ?? 'all fixtures') : spec.cases.join(', '));
  presenter.keyValue(
    'modes',
    spec === null
      ? modes === undefined
        ? 'baseline, advanced'
        : modes.join(', ')
      : `${spec.controlLabel} against ${spec.treatmentLabel}`,
  );
  if (budget !== undefined) {
    presenter.keyValue('tool-call ceiling', `${budget.maxToolCalls}, raised from ${DEFAULT_BUDGET.maxToolCalls}`);
  }
  if (spec !== null) {
    presenter.keyValue('decision rule', spec.rule);
  }

  const report = await runEvaluation({
    repeats: Math.max(1, Math.trunc(repeats)),
    logger: createLogger(),
    ...(caseFilter === null || spec !== null ? {} : { cases: [caseFilter] }),
    ...(modes === undefined || spec !== null ? {} : { modes }),
    ...(executorFlag === null ? {} : { executorKind: ExecutorKindSchema.parse(executorFlag) }),
    ...(spec === null ? {} : { experiment: spec.name }),
    ...(budget === undefined ? {} : { budget }),
  });

  presenter.heading('Summary');
  if (report.status.kind === 'pending') {
    presenter.line(`Status: pending (${report.status.why}).`);
    presenter.line(report.status.detail);
  } else if (report.status.kind === 'partial') {
    presenter.line(`Status: partial. ${report.status.detail}`);
  } else {
    presenter.line('Status: complete.');
  }
  for (const summary of report.summaries) {
    presenter.keyValue(
      summary.mode,
      `${summary.verifiedRepairs}/${summary.runs} verified, rate ${formatRateWithInterval(summary.verifiedRepairRate, summary.verifiedRepairs, summary.runs)}, median ${formatMillis(summary.medianWallClockMs)}, median cost ${summary.medianCostUsd === null ? 'unknown' : formatUsd(summary.medianCostUsd)}`,
    );
  }

  const advanced = report.summaries.find((entry) => entry.mode === 'advanced') ?? null;
  const baseline = report.summaries.find((entry) => entry.mode === 'baseline') ?? null;
  if (advanced !== null && baseline !== null) {
    presenter.keyValue(
      'advanced - baseline',
      formatDifferencePoints(
        proportionDifferenceInterval(
          advanced.verifiedRepairs,
          advanced.runs,
          baseline.verifiedRepairs,
          baseline.runs,
        ),
      ),
    );
  }

  if (report.experiment !== null && spec !== null) {
    const { control, treatment, decision } = report.experiment;
    presenter.heading(spec.title);
    presenter.keyValue(
      spec.controlLabel,
      `${control.verifiedRepairs}/${control.runs} verified, rate ${formatRateWithInterval(control.verifiedRepairRate, control.verifiedRepairs, control.runs)}, median cost ${control.medianCostUsd === null ? 'unknown' : formatUsd(control.medianCostUsd)}`,
    );
    presenter.keyValue(
      spec.treatmentLabel,
      `${treatment.verifiedRepairs}/${treatment.runs} verified, rate ${formatRateWithInterval(treatment.verifiedRepairRate, treatment.verifiedRepairs, treatment.runs)}, median cost ${treatment.medianCostUsd === null ? 'unknown' : formatUsd(treatment.medianCostUsd)}`,
    );
    presenter.keyValue('decision', spec.verdict[decision.status]);
    presenter.keyValue('why', decision.reason);
  }

  presenter.line();
  presenter.line(`Written to ${evalReportPath(spec === null ? null : spec.name)}`);
  presenter.line('Render the comparison page with: npm run report');
  return report.status.kind === 'complete' ? 0 : 1;
}
