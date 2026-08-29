import { buildComparisonReport } from '../../report/comparison.js';
import { assertKnownFlags, type ParsedArgs } from '../args.js';
import type { Presenter } from '../presenter.js';

export async function reportCommand(args: ParsedArgs, presenter: Presenter): Promise<number> {
  assertKnownFlags(args, []);
  const report = await buildComparisonReport();
  presenter.heading('Report');
  presenter.keyValue('written to', report.path);
  presenter.keyValue('evaluation status', report.evalStatus);
  presenter.keyValue('runs on disk', String(report.runCount));
  if (report.evalStatus === 'not-run-yet') {
    presenter.line();
    presenter.line('No evaluation data yet. The page says so rather than showing zeros.');
  }
  return 0;
}
