import { ReproDoctorError } from '../../domain/failure.js';
import { ModeSchema, type Mode } from '../../domain/mode.js';
import { ExecutorKindSchema } from '../../domain/result.js';
import {
  CRITIC_EXPERIMENT_CASES,
  CRITIC_RULE,
  runEvaluation,
  evalReportPath,
} from '../../eval/run-eval.js';
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

const KNOWN_FLAGS = ['repeats', 'case', 'mode', 'executor', 'experiment'];

export async function evalCommand(args: ParsedArgs, presenter: Presenter): Promise<number> {
  assertKnownFlags(args, KNOWN_FLAGS);
  const repeats = numberFlag(args, 'repeats') ?? 3;
  const caseFilter = stringFlag(args, 'case');
  const modeFilter = stringFlag(args, 'mode');
  const executorFlag = stringFlag(args, 'executor');
  const experimentFlag = stringFlag(args, 'experiment');
  if (experimentFlag !== null && experimentFlag !== 'critic') {
    throw new ReproDoctorError(
      'internal-error',
      `unknown experiment: ${experimentFlag}`,
      'the only experiment is: critic',
    );
  }
  const modes: readonly Mode[] | undefined =
    modeFilter === null ? undefined : [ModeSchema.parse(modeFilter)];

  presenter.heading(experimentFlag === null ? 'Evaluation' : 'Experiment: critic');
  presenter.keyValue('repeats per case', String(repeats));
  presenter.keyValue(
    'cases',
    experimentFlag === 'critic' ? CRITIC_EXPERIMENT_CASES.join(', ') : (caseFilter ?? 'all fixtures'),
  );
  presenter.keyValue(
    'modes',
    experimentFlag === 'critic'
      ? 'advanced control against advanced with a critic'
      : modes === undefined
        ? 'baseline, advanced'
        : modes.join(', '),
  );
  if (experimentFlag === 'critic') {
    presenter.keyValue('decision rule', CRITIC_RULE);
  }

  const report = await runEvaluation({
    repeats: Math.max(1, Math.trunc(repeats)),
    logger: createLogger(),
    ...(caseFilter === null || experimentFlag === 'critic' ? {} : { cases: [caseFilter] }),
    ...(modes === undefined || experimentFlag === 'critic' ? {} : { modes }),
    ...(executorFlag === null ? {} : { executorKind: ExecutorKindSchema.parse(executorFlag) }),
    ...(experimentFlag === null ? {} : { experiment: experimentFlag }),
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

  if (report.experiment !== null) {
    const { control, treatment, decision } = report.experiment;
    presenter.heading('Critic experiment');
    presenter.keyValue(
      'control (advanced)',
      `${control.verifiedRepairs}/${control.runs} verified, rate ${formatRateWithInterval(control.verifiedRepairRate, control.verifiedRepairs, control.runs)}, median cost ${control.medianCostUsd === null ? 'unknown' : formatUsd(control.medianCostUsd)}`,
    );
    presenter.keyValue(
      'treatment (+critic)',
      `${treatment.verifiedRepairs}/${treatment.runs} verified, rate ${formatRateWithInterval(treatment.verifiedRepairRate, treatment.verifiedRepairs, treatment.runs)}, median cost ${treatment.medianCostUsd === null ? 'unknown' : formatUsd(treatment.medianCostUsd)}`,
    );
    presenter.keyValue(
      'decision',
      decision.status === 'pending'
        ? 'pending, the experiment has not produced complete measurements'
        : decision.status === 'keep'
          ? 'keep the critic'
          : 'discard the critic',
    );
    presenter.keyValue('why', decision.reason);
  }

  presenter.line();
  presenter.line(`Written to ${evalReportPath(report.experiment === null ? null : 'critic')}`);
  presenter.line('Render the comparison page with: npm run report');
  return report.status.kind === 'complete' ? 0 : 1;
}
