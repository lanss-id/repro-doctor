import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_BUDGET } from '../../src/domain/budget.js';
import { EVAL_SCHEMA_VERSION, EvalReportSchema, type EvalReport } from '../../src/domain/eval.js';
import { renderComparisonHtml } from '../../src/report/comparison.js';
import { escapeHtml } from '../../src/report/html.js';

function report(overrides: Partial<EvalReport>): EvalReport {
  return EvalReportSchema.parse({
    schemaVersion: EVAL_SCHEMA_VERSION,
    generatedAt: '2026-08-29T12:00:00.000Z',
    status: { kind: 'complete' },
    model: 'gpt-4.1-mini',
    executor: 'docker',
    repeats: 3,
    budget: DEFAULT_BUDGET,
    cases: ['entrypoint-mismatch'],
    runs: [],
    summaries: [],
    experiment: null,
    ...overrides,
  });
}

test('escapeHtml neutralises markup', () => {
  assert.equal(escapeHtml('<script>"x" & \'y\'</script>'), '&lt;script&gt;&quot;x&quot; &amp; &#39;y&#39;&lt;/script&gt;');
});

test('with no evaluation on disk the page says so instead of showing zeros', () => {
  const html = renderComparisonHtml(null, []);
  assert.match(html, /No evaluation has been run/u);
  assert.match(html, /pending/u);
  assert.equal(/0\.0%/u.test(html), false, 'an unmeasured rate must not be rendered as 0.0%');
});

test('a pending evaluation is labelled pending, not failed', () => {
  const html = renderComparisonHtml(
    report({
      status: { kind: 'pending', why: 'missing-api-key', detail: 'OPENAI_API_KEY is not set.' },
    }),
    [],
  );
  assert.match(html, /Evaluation pending: missing-api-key/u);
  assert.match(html, /not zero, they are unmeasured/u);
});

test('measured summaries are rendered with their real numbers', () => {
  const html = renderComparisonHtml(
    report({
      runs: [
        {
          caseId: 'entrypoint-mismatch',
          mode: 'baseline',
          arm: null,
          repeat: 1,
          runId: null,
          status: 'unverified-patch',
          verified: false,
          wallClockMs: 4000,
          cost: { kind: 'measured', usd: 0.02 },
          checks: [{ name: 'semantic-oracle', passed: false, detail: 'oracle did not pass: failed' }],
          error: null,
        },
      ],
      summaries: [
        {
          mode: 'baseline',
          runs: 2,
          verifiedRepairs: 1,
          verifiedRepairRate: 0.5,
          medianWallClockMs: 4000,
          medianCostUsd: 0.02,
          costUnknownRuns: 0,
          unsafeMutations: 0,
          budgetViolations: 0,
          oracleAccessViolations: 0,
        },
      ],
    }),
    [],
  );
  assert.match(html, /50\.0%/u);
  assert.match(html, /4\.0s/u);
  assert.match(html, /\$0\.0200/u);
  assert.match(html, /semantic-oracle/u);
});

test('the critic experiment prints the rule next to the verdict', () => {
  const arm = (rate: number, cost: number | null) => ({
    mode: 'advanced' as const,
    runs: 9,
    verifiedRepairs: Math.round(rate * 9),
    verifiedRepairRate: rate,
    medianWallClockMs: 5000,
    medianCostUsd: cost,
    costUnknownRuns: cost === null ? 9 : 0,
    unsafeMutations: 0,
    budgetViolations: 0,
    oracleAccessViolations: 0,
  });
  const html = renderComparisonHtml(
    report({
      experiment: {
        name: 'critic',
        hypothesis: 'a critic catches patches that satisfy the visible check only',
        rule: 'Keep the critic only for at least +10 percentage points at no more than +25 percent cost.',
        cases: ['broken-test-discovery'],
        control: arm(0.33, 0.02),
        treatment: arm(0.67, 0.021),
        decision: {
          status: 'keep',
          keep: true,
          repairRateDeltaPoints: 34,
          costChangePercent: 5,
          intervalLowPoints: 4,
          intervalHighPoints: 64,
          reason: '+34.0 points for 5.0% cost change, both within the rule',
        },
      },
    }),
    [],
  );
  assert.match(html, /Critic experiment/u);
  assert.match(html, /at least \+10 percentage points/u);
  assert.match(html, /Keep the critic/u);
  assert.match(html, /33\.0%/u);
  assert.match(html, /67\.0%/u);
});

test('an unmeasured critic experiment is pending rather than discarded', () => {
  const pending = {
    mode: 'advanced' as const,
    runs: 0,
    verifiedRepairs: 0,
    verifiedRepairRate: null,
    medianWallClockMs: null,
    medianCostUsd: null,
    costUnknownRuns: 0,
    unsafeMutations: 0,
    budgetViolations: 0,
    oracleAccessViolations: 0,
  };
  const html = renderComparisonHtml(
    report({
      experiment: {
        name: 'critic',
        hypothesis: 'a critic catches patches that satisfy the visible check only',
        rule: 'Keep the critic only for at least +10 percentage points at no more than +25 percent cost.',
        cases: ['broken-test-discovery'],
        control: pending,
        treatment: pending,
        decision: {
          status: 'pending',
          keep: false,
          repairRateDeltaPoints: null,
          costChangePercent: null,
          intervalLowPoints: null,
          intervalHighPoints: null,
          reason: 'no measured repair rate yet',
        },
      },
    }),
    [],
  );
  assert.match(html, /Decision pending/u);
  assert.doesNotMatch(html, /Discard the critic/u);
});

test('an unpriced batch shows the cost as unknown', () => {
  const html = renderComparisonHtml(
    report({
      summaries: [
        {
          mode: 'advanced',
          runs: 3,
          verifiedRepairs: 3,
          verifiedRepairRate: 1,
          medianWallClockMs: 5000,
          medianCostUsd: null,
          costUnknownRuns: 3,
          unsafeMutations: 0,
          budgetViolations: 0,
          oracleAccessViolations: 0,
        },
      ],
    }),
    [],
  );
  assert.match(html, /unknown \(3 run\(s\) unpriced\)/u);
});
