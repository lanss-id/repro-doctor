#!/usr/bin/env node
/**
 * Derives every number the video shows.
 *
 * The rule this file exists to enforce: the Remotion compositions contain no
 * literal figures. Each one reads this file, and each field here comes from a
 * committed evaluation artifact scored by the project's own scoring code
 * (`dist/src/eval/scoring.js`), so a re-run that changes the result changes the
 * video without anyone editing a component.
 *
 * The one exception is the development batch's baseline rate, which predates
 * the labelled evidence bundle and survives only in `docs/EVALUATION.md`. It is
 * parsed out of that table rather than typed in here, and carries a `source`
 * field saying so.
 */
import { access, readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const OUT = path.join(ROOT, 'video/evidence/evidence.json');

const { summarizeMode, summarizeArm, proportionDifferenceInterval, wilsonInterval } = await import(
  path.join(ROOT, 'dist/src/eval/scoring.js')
);
const { DIFFICULTY_STRATA, STRATUM_NAMES, summarizeStratum } = await import(
  path.join(ROOT, 'dist/src/eval/strata.js')
);
const { EXPERIMENTS } = await import(path.join(ROOT, 'dist/src/eval/experiments.js'));

const readJson = async (relative) => JSON.parse(await readFile(path.join(ROOT, relative), 'utf8'));

/** A rate plus the interval its sample size supports, in percentage points. */
const rate = (summary) => {
  const interval = wilsonInterval(summary.verifiedRepairs, summary.runs);
  return {
    runs: summary.runs,
    verified: summary.verifiedRepairs,
    percent: summary.verifiedRepairRate === null ? null : summary.verifiedRepairRate * 100,
    low: interval === null ? null : interval.low * 100,
    high: interval === null ? null : interval.high * 100,
    medianWallClockMs: summary.medianWallClockMs,
    medianCostUsd: summary.medianCostUsd,
    unsafeMutations: summary.unsafeMutations,
    budgetViolations: summary.budgetViolations,
    oracleAccessViolations: summary.oracleAccessViolations,
  };
};

/** treatment minus control, in percentage points, with Newcombe's interval. */
const difference = (treatmentSuccesses, treatmentTotal, controlSuccesses, controlTotal) => {
  const d = proportionDifferenceInterval(
    treatmentSuccesses,
    treatmentTotal,
    controlSuccesses,
    controlTotal,
  );
  if (d === null) {
    return null;
  }
  return {
    points: d.point * 100,
    low: d.low * 100,
    high: d.high * 100,
    includesZero: d.low <= 0 && d.high >= 0,
  };
};

const comparisonOf = (report) => {
  const baseline = summarizeMode('baseline', report.runs);
  const advanced = summarizeMode('advanced', report.runs);
  return {
    baseline: rate(baseline),
    advanced: rate(advanced),
    difference: difference(
      advanced.verifiedRepairs,
      advanced.runs,
      baseline.verifiedRepairs,
      baseline.runs,
    ),
  };
};

const subsetComparison = (report, cases) => {
  const runs = report.runs.filter((run) => cases.includes(run.caseId));
  return comparisonOf({ ...report, runs });
};

const batchOf = (report) => ({
  generatedAt: report.generatedAt,
  model: report.model,
  executor: report.executor,
  repeats: report.repeats,
  cases: report.cases,
  runs: report.runs.length,
});

// ---------------------------------------------------------------- comparison

const confirmatory = await readJson('submission/evidence/confirmatory/eval.json');
const exploratory = await readJson('submission/evidence/exploratory/eval.json');

const comparison = { batch: batchOf(confirmatory), ...comparisonOf(confirmatory) };

const strata = STRATUM_NAMES.map((name) => {
  const baseline = summarizeStratum(name, 'baseline', confirmatory.runs);
  const advanced = summarizeStratum(name, 'advanced', confirmatory.runs);
  return {
    name,
    cases: DIFFICULTY_STRATA[name],
    baseline: rate(baseline),
    advanced: rate(advanced),
    difference: difference(
      advanced.verifiedRepairs,
      advanced.runs,
      baseline.verifiedRepairs,
      baseline.runs,
    ),
  };
});

// ------------------------------------------------------------------ variance
//
// Three batches of the byte-identical baseline arm. Two are recomputed from
// their bundles; the development batch has no bundle and is read out of the
// documented table, which is the same number the site and the README publish.

const evaluationDoc = await readFile(path.join(ROOT, 'docs/EVALUATION.md'), 'utf8');
const developmentRow = evaluationDoc.match(
  /\|\s*Development batch,\s*(\d+ \w+)\s*\|\s*(\d+)\/(\d+),/,
);
if (developmentRow === null) {
  throw new Error(
    'the development batch row is no longer in docs/EVALUATION.md; the variance chart has no source',
  );
}

const varianceBatch = (label, verified, runs, source) => ({
  label,
  verified,
  runs,
  percent: (verified / runs) * 100,
  source,
});

const exploratoryBaseline = summarizeMode('baseline', exploratory.runs);
const confirmatoryBaseline = summarizeMode('baseline', confirmatory.runs);

const batches = [
  varianceBatch(
    `Development batch, ${developmentRow[1]}`,
    Number(developmentRow[2]),
    Number(developmentRow[3]),
    'docs/EVALUATION.md',
  ),
  varianceBatch(
    'Exploratory batch, 30 August',
    exploratoryBaseline.verifiedRepairs,
    exploratoryBaseline.runs,
    'submission/evidence/exploratory/eval.json',
  ),
  varianceBatch(
    'Confirmatory batch, 30 August',
    confirmatoryBaseline.verifiedRepairs,
    confirmatoryBaseline.runs,
    'submission/evidence/confirmatory/eval.json',
  ),
];
const percents = batches.map((batch) => batch.percent);
const variance = {
  batches,
  spreadPoints: Math.max(...percents) - Math.min(...percents),
  effectPoints: comparison.difference.points,
  note: 'The baseline arm is byte-identical across all three. Only advanced instructions changed.',
};

// --------------------------------------------------------------- experiments

const experimentOf = async (name, directory) => {
  const report = await readJson(`submission/evidence/${directory}/eval.json`);
  const spec = EXPERIMENTS[name];
  const control = summarizeArm('advanced', 'control', report.runs);
  const treatment = summarizeArm('advanced', 'treatment', report.runs);
  const decision = spec.decide(control, treatment);
  // An ablation asks what removing the ingredient cost, so its difference runs
  // control minus treatment; an A/B test asks what adding it gained.
  const isAblation = name !== 'critic';
  return {
    name,
    title: spec.title,
    batch: batchOf(report),
    cases: spec.cases,
    hypothesis: spec.hypothesis,
    rule: spec.rule,
    controlLabel: spec.controlLabel,
    treatmentLabel: spec.treatmentLabel,
    removes: isAblation ? spec.treatmentLabel : null,
    control: rate(control),
    treatment: rate(treatment),
    difference: isAblation
      ? difference(
          control.verifiedRepairs,
          control.runs,
          treatment.verifiedRepairs,
          treatment.runs,
        )
      : difference(
          treatment.verifiedRepairs,
          treatment.runs,
          control.verifiedRepairs,
          control.runs,
        ),
    decision: { ...decision, verdict: spec.verdict[decision.status] },
  };
};

const ablation = await experimentOf('ablation', 'ablation');
const reserve = await experimentOf('reserve', 'reserve');
const critic = await experimentOf('critic', 'critic');

// ------------------------------------- why the first ablation was misleading
//
// The status breakdown is recomputed from the bundle. The sentence underneath
// it is not: which of those runs had a patch refused at the tool-call limit is
// in the trajectories, which are not committed, so the claim is quoted from the
// document that makes it rather than restated here as if it were derived.

const STATUS_LABELS = {
  repaired: 'Verified repair',
  'unverified-patch': 'Patch produced, oracle rejected it',
  'no-patch': 'No patch at all',
  'budget-exhausted': 'Budget exhausted',
};

const ablationReport = await readJson('submission/evidence/ablation/eval.json');
const countByStatus = (arm) => {
  const counts = new Map();
  for (const run of ablationReport.runs.filter((entry) => entry.arm === arm)) {
    counts.set(run.status, (counts.get(run.status) ?? 0) + 1);
  }
  return counts;
};
const ablationControlCounts = countByStatus('control');
const ablationTreatmentCounts = countByStatus('treatment');

const mechanismSentence = evaluationDoc
  .replace(/\n/g, ' ')
  .match(/Twenty of its thirty-five treatment runs[^.]+\./);
if (mechanismSentence === null) {
  throw new Error(
    'the sentence about what the ablation treatment runs actually did is no longer in docs/EVALUATION.md',
  );
}

const mechanism = {
  statuses: Object.entries(STATUS_LABELS).map(([status, label]) => ({
    status,
    label,
    control: ablationControlCounts.get(status) ?? 0,
    treatment: ablationTreatmentCounts.get(status) ?? 0,
  })),
  note: {
    text: mechanismSentence[0].replace(/\*\*/g, '').replace(/\s+/g, ' ').trim(),
    source: 'docs/EVALUATION.md',
  },
};

// ------------------------------------------------- the subgroup that vanished

const hardCases = DIFFICULTY_STRATA.hard;
const subgroup = {
  cases: hardCases,
  exploratory: subsetComparison(exploratory, hardCases),
  confirmatory: subsetComparison(confirmatory, hardCases),
  note: 'The five cases were chosen after seeing the exploratory batch, so they became the next batch’s hypothesis rather than its headline.',
};

// ------------------------------------------------------- how the modes failed

const failureProfile = (() => {
  const label = {
    'oracle-rejected': 'Patch produced, oracle rejected it',
    'no-patch': 'No patch at all',
    'budget-exhausted': 'Budget exhausted',
  };
  const bucket = (run) => {
    if (run.status === 'budget-exhausted') {
      return 'budget-exhausted';
    }
    return run.status === 'no-patch' ? 'no-patch' : 'oracle-rejected';
  };
  const rows = new Map();
  for (const run of confirmatory.runs.filter((entry) => !entry.verified)) {
    const key = bucket(run);
    const row = rows.get(key) ?? { key, label: label[key] ?? key, baseline: 0, advanced: 0 };
    row[run.mode] += 1;
    rows.set(key, row);
  }
  return [...rows.values()].sort((a, b) => b.baseline + b.advanced - (a.baseline + a.advanced));
})();

// ------------------------------------------------------------- the demo run

// `artifacts/` is not committed, so the run the video shows is published under
// submission/examples like every other run this project asks anyone to check.
// The working copy is only a fallback for a machine that has just recorded one.
const demoRunId = (await readFile(path.join(ROOT, 'video/recordings/03a-run-id.txt'), 'utf8')).trim();
const demoDirectory = (await access(path.join(ROOT, 'submission/examples/video-run/result.json'))
  .then(() => true)
  .catch(() => false))
  ? 'submission/examples/video-run'
  : `artifacts/runs/${demoRunId}`;
const demoResult = await readJson(`${demoDirectory}/result.json`);
const demoPatch = await readFile(path.join(ROOT, demoDirectory, 'repair.patch'), 'utf8');
const demoAttempts = await readJson('video/recordings/03a-attempts.json');

const demo = {
  publishedAt: demoDirectory,
  runId: demoResult.runId,
  caseId: demoResult.caseId,
  mode: demoResult.mode,
  model: demoResult.model,
  sandbox: demoResult.sandbox,
  checksumBefore: demoResult.repo.treeChecksumBefore,
  checksumAfter: demoResult.repo.treeChecksumAfter,
  mutated: demoResult.repo.mutated,
  filesChanged: [...demoPatch.matchAll(/^--- a\/(.+)$/gm)].map((match) => match[1]),
  verification: demoResult.verification,
  usage: demoResult.usage,
  attempts: demoAttempts.attempts,
  attemptsNote: demoAttempts.note,
};

// ------------------------------------------------------------- the changelog

const changelogDoc = await readFile(path.join(ROOT, 'docs/IMPROVEMENT_CHANGELOG.md'), 'utf8');
const glanceSection = changelogDoc.split('\n## At a glance\n')[1]?.split('\n## ')[0];
const glanceRows = (glanceSection ?? '').split('\n').filter((line) => line.startsWith('|'));
if (glanceRows.length < 3) {
  throw new Error('the "At a glance" table is no longer in docs/IMPROVEMENT_CHANGELOG.md');
}
const changelog = glanceRows
  .slice(2)
  .map((line) =>
    line
      .split('|')
      .slice(1, -1)
      .map((cell) => cell.trim().replace(/`/g, '')),
  )
  .filter((cells) => cells.length === 4)
  .map(([stage, what, evidence, decision]) => ({ stage, what, evidence, decision }));

// ---------------------------------------------------------------------- write

const evidence = {
  generatedAt: new Date().toISOString(),
  generatedBy: 'video/pipeline/evidence.mjs',
  comparison,
  strata,
  variance,
  ablation,
  mechanism,
  reserve,
  critic,
  subgroup,
  failureProfile,
  demo,
  changelog,
};

await mkdir(path.dirname(OUT), { recursive: true });
await writeFile(OUT, `${JSON.stringify(evidence, null, 2)}\n`, 'utf8');
console.log(`wrote ${path.relative(ROOT, OUT)}`);
console.log(
  `  advanced minus baseline  ${comparison.difference.points.toFixed(1)} points (${comparison.difference.low.toFixed(1)} to ${comparison.difference.high.toFixed(1)})`,
);
console.log(`  baseline variance spread ${variance.spreadPoints.toFixed(1)} points`);
console.log(`  ablation                 ${ablation.difference.points.toFixed(1)} points`);
console.log(`  reserve                  ${reserve.difference.points.toFixed(1)} points`);
console.log(`  critic                   ${critic.difference.points.toFixed(1)} points`);
