import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { EvalReportSchema } from '../../src/domain/eval.js';
import { MODES } from '../../src/domain/mode.js';
import {
  proportionDifferenceInterval,
  summarizeMode,
  wilsonInterval,
} from '../../src/eval/scoring.js';
import { STRATUM_NAMES, summarizeStratum } from '../../src/eval/strata.js';
import { projectRoot } from '../../src/infra/project-root.js';

/**
 * The headline numbers live in six documents and a landing page. Twice now a
 * batch has been re-run and a document has been left quoting the batch before
 * it, once in the first command of the reproduction guide. Prose cannot be
 * type-checked, so this checks it instead: every number below is computed from
 * the committed evidence bundle and has to appear, to the digit, in the
 * documents that claim it.
 *
 * It fails when a batch is re-run and a document is not, which is the whole
 * point. Update the documents, not this test.
 */

const BUNDLE = path.join(projectRoot(), 'submission', 'evidence', 'confirmatory');
const CLAIMANTS = ['README.md', 'docs/EVALUATION.md'] as const;

const report = EvalReportSchema.parse(
  JSON.parse(await readFile(path.join(BUNDLE, 'eval.json'), 'utf8')),
);
const documents = new Map<string, string>();
for (const name of CLAIMANTS) {
  documents.set(name, await readFile(path.join(projectRoot(), name), 'utf8'));
}

function requireEverywhere(label: string, token: string): void {
  for (const [name, text] of documents) {
    assert.ok(
      text.includes(token),
      `${name} does not contain ${token}, the published ${label}. Either the document is stale or the bundle changed under it.`,
    );
  }
}

const percent = (value: number): string => (value * 100).toFixed(1);
const points = (value: number): string =>
  `${value >= 0 ? '+' : '-'}${Math.abs(value * 100).toFixed(1)}`;

test('every document that quotes the headline rate quotes the measured one', () => {
  for (const mode of MODES) {
    const summary = summarizeMode(mode, report.runs);
    const interval = wilsonInterval(summary.verifiedRepairs, summary.runs);
    assert.notEqual(interval, null);
    if (interval === null) return;

    requireEverywhere(`${mode} count`, `${summary.verifiedRepairs}/${summary.runs}`);
    requireEverywhere(`${mode} rate`, `${percent(summary.verifiedRepairRate ?? 0)}%`);
    requireEverywhere(`${mode} interval low`, percent(interval.low));
    requireEverywhere(`${mode} interval high`, percent(interval.high));
  }
});

test('every document that quotes the difference quotes its interval too', () => {
  const advanced = summarizeMode('advanced', report.runs);
  const baseline = summarizeMode('baseline', report.runs);
  const difference = proportionDifferenceInterval(
    advanced.verifiedRepairs,
    advanced.runs,
    baseline.verifiedRepairs,
    baseline.runs,
  );
  assert.notEqual(difference, null);
  if (difference === null) return;

  requireEverywhere('difference', `${points(difference.point)} points`);
  requireEverywhere('difference interval low', points(difference.low));
  requireEverywhere('difference interval high', points(difference.high));
});

test('the stratified result is published, not only the aggregate', () => {
  for (const stratum of STRATUM_NAMES) {
    const advanced = summarizeStratum(stratum, 'advanced', report.runs);
    const baseline = summarizeStratum(stratum, 'baseline', report.runs);
    if (advanced.runs === 0 || baseline.runs === 0) {
      continue;
    }
    const difference = proportionDifferenceInterval(
      advanced.verifiedRepairs,
      advanced.runs,
      baseline.verifiedRepairs,
      baseline.runs,
    );
    if (difference === null) {
      continue;
    }
    const evaluationDoc = documents.get('docs/EVALUATION.md') ?? '';
    assert.ok(
      evaluationDoc.includes(`${points(difference.point)} points`),
      `docs/EVALUATION.md does not report the ${stratum} stratum difference of ${points(difference.point)} points`,
    );
  }
});
