import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { EvalReportSchema, type EvalReport, type EvalRun } from '../domain/eval.js';
import { MODES, type Mode } from '../domain/mode.js';
import type { RunResult } from '../domain/result.js';
import { evalReportPath } from '../eval/run-eval.js';
import {
  formatDifferencePoints,
  formatMillis,
  formatRateWithInterval,
  formatUsd,
  proportionDifferenceInterval,
} from '../eval/scoring.js';
import { listRunResults } from '../infra/artifacts.js';
import { artifactsRoot } from '../infra/project-root.js';
import { escapeHtml, htmlDocument, statusClass } from './html.js';

export function comparisonReportPath(): string {
  return path.join(artifactsRoot(), 'report', 'index.html');
}

export async function loadEvalReport(experiment: 'critic' | null = null): Promise<EvalReport | null> {
  const raw = await readFile(evalReportPath(experiment), 'utf8').catch(() => null);
  if (raw === null) {
    return null;
  }
  const parsed = EvalReportSchema.safeParse(JSON.parse(raw));
  return parsed.success ? parsed.data : null;
}

export interface ComparisonReport {
  readonly path: string;
  readonly html: string;
  readonly evalStatus: string;
  readonly runCount: number;
}

/**
 * Builds the comparison page from artifacts on disk. It never fabricates a
 * number: with no evaluation on disk the page says so and shows whatever
 * individual runs exist.
 */
export async function buildComparisonReport(): Promise<ComparisonReport> {
  const report = await loadEvalReport();
  const experiment = await loadEvalReport('critic');
  const runs = await listRunResults();
  const html = renderComparisonHtml(report, runs, experiment);
  const target = comparisonReportPath();
  await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, html, 'utf8');
  return {
    path: target,
    html,
    evalStatus: report === null ? 'not-run-yet' : report.status.kind,
    runCount: runs.length,
  };
}

export function renderComparisonHtml(
  report: EvalReport | null,
  runs: readonly RunResult[],
  experimentReport: EvalReport | null = null,
): string {
  const body = [
    '<h1>Repro Doctor: baseline against advanced</h1>',
    '<p class="subtitle">Verified repair means the hidden semantic oracle exited zero and every safety check passed. Nothing on this page is estimated.</p>',
    renderStatusNotice(report, runs),
    renderSummaryTable(report),
    renderExperiment(experimentReport ?? report),
    renderPerCaseTable(report),
    renderFailures(report),
    renderRunIndex(runs),
    `<footer>Built by <code>npm run report</code> from <code>${escapeHtml(evalReportPath())}</code> and <code>${escapeHtml(path.join(artifactsRoot(), 'runs'))}</code>.</footer>`,
  ].join('\n');
  return htmlDocument('Repro Doctor evaluation report', body);
}

function renderStatusNotice(report: EvalReport | null, runs: readonly RunResult[]): string {
  if (report === null) {
    return `<div class="notice"><strong>No evaluation has been run.</strong> There is no <code>${escapeHtml(evalReportPath())}</code> on this machine, so every aggregate below is empty. Run <code>npm run eval -- --repeats 3</code> with OPENAI_API_KEY set to fill it in. ${runs.length} individual run(s) are on disk.</div>`;
  }
  if (report.status.kind === 'pending') {
    return `<div class="notice"><strong>Evaluation pending: ${escapeHtml(report.status.why)}.</strong> ${escapeHtml(report.status.detail)} The rates below are not zero, they are unmeasured.</div>`;
  }
  if (report.status.kind === 'partial') {
    return `<div class="notice"><strong>Partial evaluation.</strong> ${escapeHtml(report.status.detail)}</div>`;
  }
  return `<p class="muted">Evaluation completed ${escapeHtml(report.generatedAt)} with model <code>${escapeHtml(report.model)}</code>, executor <code>${escapeHtml(report.executor)}</code>, ${report.repeats} repeat(s) per case.</p>`;
}

function renderSummaryTable(report: EvalReport | null): string {
  const rows = MODES.map((mode) => {
    const summary = report?.summaries.find((entry) => entry.mode === mode) ?? null;
    return `<tr>
      <td><strong>${escapeHtml(mode)}</strong></td>
      <td class="num">${summary === null ? 'pending' : summary.runs}</td>
      <td class="num">${summary === null ? 'pending' : formatRateWithInterval(summary.verifiedRepairRate, summary.verifiedRepairs, summary.runs)}</td>
      <td class="num">${summary === null ? 'pending' : formatMillis(summary.medianWallClockMs)}</td>
      <td class="num">${summary === null ? 'pending' : summary.medianCostUsd === null ? `unknown (${summary.costUnknownRuns} run(s) unpriced)` : formatUsd(summary.medianCostUsd)}</td>
      <td class="num ${summary !== null && summary.unsafeMutations > 0 ? 'fail' : ''}">${summary === null ? 'pending' : summary.unsafeMutations}</td>
      <td class="num ${summary !== null && summary.budgetViolations > 0 ? 'fail' : ''}">${summary === null ? 'pending' : summary.budgetViolations}</td>
      <td class="num ${summary !== null && summary.oracleAccessViolations > 0 ? 'fail' : ''}">${summary === null ? 'pending' : summary.oracleAccessViolations}</td>
    </tr>`;
  }).join('\n');
  return `<h2>Aggregate</h2>
<table>
<tr><th>Mode</th><th class="num">Runs</th><th class="num">Verified repair rate</th><th class="num">Median time</th><th class="num">Median cost</th><th class="num">Unsafe mutations</th><th class="num">Budget violations</th><th class="num">Oracle access violations</th></tr>
${rows}
</table>
${renderDifference(report)}`;
}

/**
 * The headline of this project is the comparison, so the comparison gets its
 * own interval. A reader who sees two rates will subtract them; this says what
 * that subtraction is worth at the sample size actually run.
 */
function renderDifference(report: EvalReport | null): string {
  const advanced = report?.summaries.find((entry) => entry.mode === 'advanced') ?? null;
  const baseline = report?.summaries.find((entry) => entry.mode === 'baseline') ?? null;
  if (advanced === null || baseline === null) {
    return '';
  }
  const difference = proportionDifferenceInterval(
    advanced.verifiedRepairs,
    advanced.runs,
    baseline.verifiedRepairs,
    baseline.runs,
  );
  if (difference === null) {
    return '';
  }
  const includesZero = difference.low <= 0 && difference.high >= 0;
  const reading = includesZero
    ? `The interval includes zero, so ${advanced.runs} runs per mode do not establish that the difference is real.`
    : 'The interval excludes zero.';
  return `<p><strong>Advanced minus baseline: ${escapeHtml(formatDifferencePoints(difference))}.</strong> ${escapeHtml(reading)}</p>`;
}

/**
 * The critic experiment, when one was run. The decision rule was fixed before
 * the experiment, so the page prints the rule next to the verdict rather than
 * only the verdict.
 */
function renderExperiment(report: EvalReport | null): string {
  const experiment = report?.experiment ?? null;
  if (experiment === null) {
    return '';
  }
  const rows = [
    ['control (advanced)', experiment.control],
    ['treatment (advanced with a critic)', experiment.treatment],
  ] as const;
  const body = rows
    .map(
      ([label, summary]) => `<tr>
        <td><strong>${escapeHtml(label)}</strong></td>
        <td class="num">${summary.runs}</td>
        <td class="num">${formatRateWithInterval(summary.verifiedRepairRate, summary.verifiedRepairs, summary.runs)}</td>
        <td class="num">${summary.medianCostUsd === null ? 'unknown' : formatUsd(summary.medianCostUsd)}</td>
      </tr>`,
    )
    .join('\n');
  const decision = experiment.decision;
  const decisionLabel =
    decision.status === 'pending'
      ? 'Decision pending'
      : decision.status === 'keep'
        ? 'Keep the critic'
        : 'Discard the critic';
  const decisionClass = decision.status === 'pending' ? 'warn' : decision.keep ? 'pass' : 'fail';
  return `<h2>Critic experiment</h2>
<p>${escapeHtml(experiment.hypothesis)}</p>
<p class="muted">Measured separately from the table above, ${report === null ? '' : `on ${escapeHtml(report.generatedAt)} with ${report.repeats} repeat(s), `}and stored in <code>${escapeHtml(evalReportPath('critic'))}</code>.</p>
<p class="muted">Cases: ${experiment.cases.map((id) => `<code>${escapeHtml(id)}</code>`).join(', ')}. Rule fixed before the experiment: ${escapeHtml(experiment.rule)}</p>
<table>
<tr><th>Arm</th><th class="num">Runs</th><th class="num">Verified repair rate</th><th class="num">Median cost</th></tr>
${body}
</table>
<p><strong class="${decisionClass}">${decisionLabel}</strong>: ${escapeHtml(decision.reason)}</p>`;
}

function renderPerCaseTable(report: EvalReport | null): string {
  if (report === null || report.cases.length === 0) {
    return '<h2>Per case</h2><p class="muted">No cases have been evaluated yet.</p>';
  }
  const rows = report.cases
    .map((caseId) => {
      const cells = MODES.map((mode) => renderCaseCell(report.runs, caseId, mode)).join('');
      return `<tr><td><code>${escapeHtml(caseId)}</code></td>${cells}</tr>`;
    })
    .join('\n');
  return `<h2>Per case</h2>
<table>
<tr><th>Case</th>${MODES.map((mode) => `<th>${escapeHtml(mode)}</th>`).join('')}</tr>
${rows}
</table>`;
}

function renderCaseCell(runs: readonly EvalRun[], caseId: string, mode: Mode): string {
  const matching = runs.filter((run) => run.caseId === caseId && run.mode === mode);
  if (matching.length === 0) {
    return '<td class="muted">pending</td>';
  }
  const verified = matching.filter((run) => run.verified).length;
  const evidence = matching
    .map((run) => {
      const failedChecks = run.checks.filter((check) => !check.passed).map((check) => check.name);
      const trace = run.runId === null ? 'no run directory' : `artifacts/runs/${run.runId}/`;
      const detail = failedChecks.length === 0 ? run.status : `${run.status}; failed: ${failedChecks.join(', ')}`;
      return `<div class="muted">repeat ${run.repeat}: ${escapeHtml(detail)} &middot; <code>${escapeHtml(trace)}</code></div>`;
    })
    .join('');
  return `<td><span class="${statusClass(verified === matching.length)}">${verified}/${matching.length} verified</span>${evidence}</td>`;
}

function renderFailures(report: EvalReport | null): string {
  if (report === null) {
    return '';
  }
  const failures = report.runs.filter((run) => !run.verified);
  if (failures.length === 0) {
    return `<h2>Failures</h2><p class="muted">${report.runs.length === 0 ? 'No runs yet.' : 'Every scored run passed.'}</p>`;
  }
  const rows = failures
    .map(
      (run) => `<tr>
        <td><code>${escapeHtml(run.caseId)}</code></td>
        <td>${escapeHtml(run.mode)}</td>
        <td class="num">${run.repeat}</td>
        <td>${escapeHtml(run.status)}</td>
        <td>${escapeHtml(run.error ?? (run.checks.filter((check) => !check.passed).map((check) => `${check.name}: ${check.detail}`).join(' | ') || 'oracle did not pass'))}</td>
        <td><code>${escapeHtml(run.runId === null ? 'no run directory' : `artifacts/runs/${run.runId}/trajectory.jsonl`)}</code></td>
      </tr>`,
    )
    .join('\n');
  return `<h2>Failures</h2>
<table>
<tr><th>Case</th><th>Mode</th><th class="num">Repeat</th><th>Status</th><th>Why</th><th>Trace</th></tr>
${rows}
</table>`;
}

function renderRunIndex(runs: readonly RunResult[]): string {
  if (runs.length === 0) {
    return '<h2>Runs on disk</h2><p class="muted">No runs have been recorded on this machine.</p>';
  }
  const rows = runs
    .slice(0, 100)
    .map(
      (run) => `<tr>
        <td><code>${escapeHtml(run.runId)}</code></td>
        <td>${escapeHtml(run.caseId ?? '-')}</td>
        <td>${escapeHtml(run.mode)}</td>
        <td class="${statusClass(run.outcome.status === 'repaired')}">${escapeHtml(run.outcome.status)}</td>
        <td>${escapeHtml(run.verification.kind)}</td>
        <td>${escapeHtml(run.sandbox.executor)}${run.sandbox.productionSafe ? '' : ' <span class="warn">(test adapter)</span>'}</td>
        <td><code>${escapeHtml(run.artifacts.runDir)}</code></td>
      </tr>`,
    )
    .join('\n');
  return `<h2>Runs on disk</h2>
<table>
<tr><th>Run</th><th>Case</th><th>Mode</th><th>Outcome</th><th>Oracle</th><th>Executor</th><th>Artifacts</th></tr>
${rows}
</table>`;
}
