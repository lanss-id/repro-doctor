import { MODES } from '../../domain/mode.js';
import { ReproDoctorError } from '../../domain/failure.js';
import { ORACLE_ACCESS_CAVEAT, replayBundle } from '../../eval/replay.js';
import {
  formatDifferencePoints,
  formatRateWithInterval,
  proportionDifferenceInterval,
  summarizeMode,
} from '../../eval/scoring.js';
import { STRATUM_NAMES, summarizeStratum } from '../../eval/strata.js';
import { assertKnownFlags, type ParsedArgs } from '../args.js';
import type { Presenter } from '../presenter.js';

const KNOWN_FLAGS: readonly string[] = [];

export async function replayCommand(args: ParsedArgs, presenter: Presenter): Promise<number> {
  assertKnownFlags(args, KNOWN_FLAGS);
  const bundleDir = args.positionals[1];
  if (bundleDir === undefined) {
    throw new ReproDoctorError(
      'internal-error',
      'replay needs the directory of an evidence bundle',
      'for example: npm run doctor -- replay submission/evidence/confirmatory',
    );
  }

  const replay = await replayBundle(bundleDir);
  const { published, recomputed, disagreements, missingArtifacts } = replay;

  presenter.heading('Replay');
  presenter.keyValue('bundle', replay.bundleDir);
  presenter.keyValue('published', published.generatedAt);
  presenter.keyValue('model', published.model);
  presenter.keyValue('executor', published.executor);
  presenter.keyValue('repeats per case per mode', String(published.repeats));
  presenter.keyValue('tool-call ceiling', String(published.budget.maxToolCalls));
  presenter.keyValue('runs re-scored', `${published.runs.length - missingArtifacts.length}/${published.runs.length}`);
  presenter.line('No API key, no model call, no network and no sandbox: the committed');
  presenter.line('run artifacts go back through the same scoring code that produced the report.');

  presenter.heading('Recomputed result');
  for (const mode of MODES) {
    const summary = summarizeMode(mode, recomputed);
    presenter.keyValue(
      mode,
      `${summary.verifiedRepairs}/${summary.runs} verified, rate ${formatRateWithInterval(summary.verifiedRepairRate, summary.verifiedRepairs, summary.runs)}`,
    );
  }
  presenter.keyValue('advanced - baseline', difference(recomputed, null));

  presenter.heading('By difficulty stratum');
  presenter.line('Strata frozen in docs/PREREGISTRATION.md before the batch that tests them.');
  for (const stratum of STRATUM_NAMES) {
    for (const mode of MODES) {
      const summary = summarizeStratum(stratum, mode, recomputed);
      if (summary.runs === 0) {
        continue;
      }
      presenter.keyValue(
        `${stratum} / ${mode}`,
        `${summary.verifiedRepairs}/${summary.runs} verified, rate ${formatRateWithInterval(summary.verifiedRepairRate, summary.verifiedRepairs, summary.runs)}`,
      );
    }
    presenter.keyValue(`${stratum} difference`, difference(recomputed, stratum));
  }

  presenter.heading('Agreement with the published report');
  if (missingArtifacts.length > 0) {
    presenter.line(`${missingArtifacts.length} run(s) have no artifacts in this bundle and were not re-scored:`);
    for (const runId of missingArtifacts.slice(0, 10)) {
      presenter.line(`  ${runId}`);
    }
  }
  if (disagreements.length === 0) {
    presenter.line(`Every re-scored run agrees with the published report on status, on all seven checks and on the verified verdict.`);
  } else {
    presenter.line(`${disagreements.length} disagreement(s). The published report and this machine do not score these runs the same way:`);
    for (const entry of disagreements.slice(0, 20)) {
      presenter.line(`  ${entry.runId} ${entry.field}: published ${entry.published}, recomputed ${entry.recomputed}`);
    }
  }
  if (replay.relocated) {
    presenter.line();
    presenter.line(ORACLE_ACCESS_CAVEAT);
  }

  return disagreements.length === 0 && missingArtifacts.length === 0 ? 0 : 1;
}

function difference(
  runs: Parameters<typeof summarizeMode>[1],
  stratum: (typeof STRATUM_NAMES)[number] | null,
): string {
  const of = (mode: (typeof MODES)[number]): ReturnType<typeof summarizeMode> =>
    stratum === null ? summarizeMode(mode, runs) : summarizeStratum(stratum, mode, runs);
  const advanced = of('advanced');
  const baseline = of('baseline');
  return formatDifferencePoints(
    proportionDifferenceInterval(
      advanced.verifiedRepairs,
      advanced.runs,
      baseline.verifiedRepairs,
      baseline.runs,
    ),
  );
}
