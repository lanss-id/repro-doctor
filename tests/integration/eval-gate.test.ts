import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test, { after } from 'node:test';
import { useTemporaryArtifacts } from '../helpers/workspace.js';

const artifacts = await useTemporaryArtifacts('eval-gate');

const { runEvaluation, evalReportPath } = await import(
  '../../src/eval/run-eval.js'
);
const { EvalReportSchema } = await import('../../src/domain/eval.js');
const { EXPERIMENTS } = await import('../../src/eval/experiments.js');
const { DEFAULT_BUDGET } = await import('../../src/domain/budget.js');
const { silentLogger } = await import('../../src/infra/log.js');

// These runs never reach a model: runEvaluation refuses before spending.
const options = { repeats: 1, logger: silentLogger } as const;

test('without an API key the evaluation is pending, not zero', async () => {
  const report = await runEvaluation({ ...options, env: {} });
  assert.equal(report.status.kind, 'pending');
  if (report.status.kind !== 'pending') return;
  assert.equal(report.status.why, 'missing-api-key');
  assert.deepEqual(report.runs, []);
  for (const summary of report.summaries) {
    assert.equal(summary.verifiedRepairRate, null);
    assert.equal(summary.medianCostUsd, null);
  }
});

test('a live batch refuses to start when the pinned model has no price', async () => {
  const report = await runEvaluation({
    ...options,
    env: {
      OPENAI_API_KEY: 'sk-test-not-used-because-nothing-runs',
      REPRO_DOCTOR_MODEL: 'model-nobody-priced',
    },
  });
  assert.equal(report.status.kind, 'pending');
  if (report.status.kind !== 'pending') return;
  assert.equal(report.status.why, 'no-price-configured');
  assert.match(report.status.detail, /cost budget could not be enforced/u);
  assert.deepEqual(report.runs, [], 'nothing may run before the price is known');

  // The written report parses and says the same thing.
  const written = EvalReportSchema.parse(JSON.parse(await readFile(evalReportPath(), 'utf8')));
  assert.equal(written.status.kind, 'pending');
});

test('the default model is priced, so the price gate does not block it', async () => {
  const report = await runEvaluation({
    ...options,
    env: { OPENAI_API_KEY: 'sk-test-not-used-because-nothing-runs', REPRO_DOCTOR_MODEL: 'gpt-4.1-mini' },
    // No driverFactory and a priced model would start a live batch, so restrict
    // the plan to nothing by asking for a case that does not exist.
    cases: ['no-such-fixture'],
  });
  assert.equal(report.status.kind, 'complete');
  assert.deepEqual(report.cases, []);
});

test('the critic experiment selects its own cases and reports an undecided rule', async () => {
  const report = await runEvaluation({ ...options, env: {}, experiment: 'critic' });
  assert.deepEqual(report.cases, [...EXPERIMENTS.critic.cases].sort());
  assert.notEqual(report.experiment, null);
  if (report.experiment === null) return;
  assert.equal(report.experiment.name, 'critic');
  assert.match(report.experiment.rule, /\+10 percentage points/u);
  assert.match(report.experiment.rule, /\+25 percent/u);
  assert.equal(report.experiment.decision.status, 'pending');
  assert.equal(report.experiment.decision.keep, false);
  assert.match(report.experiment.decision.reason, /no measured repair rate/u);
  assert.equal(report.experiment.control.runs, 0);
  assert.equal(report.experiment.treatment.runs, 0);

  // The experiment must not overwrite the mode comparison it is measured
  // against: they answer different questions and are written to different files.
  assert.notEqual(evalReportPath('critic'), evalReportPath());
  const written = EvalReportSchema.parse(
    JSON.parse(await readFile(evalReportPath('critic'), 'utf8')),
  );
  assert.equal(written.experiment?.name, 'critic');
});

test('the ablation experiment selects the hard stratum and writes its own file', async () => {
  const report = await runEvaluation({ ...options, env: {}, experiment: 'ablation' });
  assert.deepEqual(report.cases, [...EXPERIMENTS.ablation.cases].sort());
  assert.notEqual(report.experiment, null);
  if (report.experiment === null) return;
  assert.equal(report.experiment.name, 'ablation');
  assert.match(report.experiment.rule, /excludes zero/u);
  assert.equal(report.experiment.decision.status, 'pending');

  // Three experiments, three files. A batch must never overwrite the batch it
  // is measured against.
  assert.notEqual(evalReportPath('ablation'), evalReportPath('critic'));
  assert.notEqual(evalReportPath('ablation'), evalReportPath());
  const written = EvalReportSchema.parse(
    JSON.parse(await readFile(evalReportPath('ablation'), 'utf8')),
  );
  assert.equal(written.experiment?.name, 'ablation');
});

test('the ablation arms differ only in the retry, and the critic arms only in the critic', () => {
  const { control: ablationControl, treatment: ablationTreatment } = EXPERIMENTS.ablation;
  assert.equal(ablationControl.criticEnabled, ablationTreatment.criticEnabled);
  assert.notEqual(ablationControl.retryEnabled, ablationTreatment.retryEnabled);

  const { control: criticControl, treatment: criticTreatment } = EXPERIMENTS.critic;
  assert.equal(criticControl.retryEnabled, criticTreatment.retryEnabled);
  assert.notEqual(criticControl.criticEnabled, criticTreatment.criticEnabled);
});

test('a raised tool-call ceiling is recorded in the report it produced', async () => {
  const budget = { ...DEFAULT_BUDGET, maxToolCalls: 25 };
  const report = await runEvaluation({ ...options, env: {}, budget });
  assert.equal(report.budget.maxToolCalls, 25);
  // Everything else about the budget has to survive untouched, or the batch is
  // not comparable with the one it is measured against.
  assert.equal(report.budget.maxPatchAttempts, DEFAULT_BUDGET.maxPatchAttempts);
  assert.equal(report.budget.maxWallClockSeconds, DEFAULT_BUDGET.maxWallClockSeconds);
  assert.equal(report.budget.maxCostUsd, DEFAULT_BUDGET.maxCostUsd);
});

after(async () => {
  await artifacts.cleanup();
});
