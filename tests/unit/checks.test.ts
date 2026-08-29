import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_BUDGET } from '../../src/domain/budget.js';
import { RESULT_SCHEMA_VERSION, RunResultSchema, type RunResult } from '../../src/domain/result.js';
import type { VerificationOutcome } from '../../src/domain/verification.js';
import { sanitizeFindings } from '../../src/agent/diagnose.js';
import { costAccountingCheck, productionSandboxCheck } from '../../src/eval/checks.js';

function result(overrides: Partial<RunResult>): RunResult {
  return RunResultSchema.parse({
    schemaVersion: RESULT_SCHEMA_VERSION,
    runId: '20260829T101500Z-a1b2c3',
    caseId: 'entrypoint-mismatch',
    mode: 'advanced',
    model: 'gpt-4.1-mini',
    modelSettingsFingerprint: 'abcdef0123456789',
    startedAt: '2026-08-29T10:15:00.000Z',
    finishedAt: '2026-08-29T10:15:30.000Z',
    sandbox: {
      executor: 'docker',
      image: 'repro-doctor-runner:1',
      network: 'none',
      readOnlyRootFilesystem: true,
      noNewPrivileges: true,
      dockerSocketMounted: false,
      oracleMountedDuringRepair: false,
      secretsMounted: false,
      cpuLimit: '1',
      memoryLimit: '1g',
      commandTimeoutSeconds: 60,
      productionSafe: true,
    },
    repo: {
      inputPath: '/example/repo',
      workspacePath: '/example/workspace',
      treeChecksumBefore: 'a'.repeat(64),
      treeChecksumAfter: 'a'.repeat(64),
      mutated: false,
      fileCount: 6,
    },
    budget: DEFAULT_BUDGET,
    usage: {
      toolCalls: 5,
      patchAttempts: 1,
      wallClockMs: 30000,
      tokens: { inputTokens: 100, outputTokens: 20, totalTokens: 120, requests: 1 },
      cost: { kind: 'measured', usd: 0.00006 },
      limitHit: null,
    },
    outcome: { status: 'repaired' },
    verification: { kind: 'passed', exitCode: 0, durationMs: 1000, checks: ['PASS build'] },
    patch: {
      kind: 'present',
      path: '/example/repair.patch',
      sha256: 'b'.repeat(64),
      changedFiles: ['package.json'],
      addedLines: 1,
      removedLines: 1,
      sensitive: true,
    },
    artifacts: {
      runDir: '/example/run',
      resultPath: '/example/run/result.json',
      trajectoryPath: '/example/run/trajectory.jsonl',
      patchPath: '/example/run/repair.patch',
      verificationLogPath: '/example/run/verification.log',
      reportPath: '/example/run/report.html',
    },
    ...overrides,
  });
}

test('a live run with a measured cost passes the cost check', () => {
  const check = costAccountingCheck(result({}));
  assert.equal(check.passed, true);
  assert.match(check.detail, /measured \$0\.000060/u);
});

test('a live run with an unknown cost fails closed', () => {
  const check = costAccountingCheck(
    result({
      usage: {
        toolCalls: 5,
        patchAttempts: 1,
        wallClockMs: 30000,
        tokens: { inputTokens: 100, outputTokens: 20, totalTokens: 120, requests: 1 },
        cost: { kind: 'unknown', why: 'no-price-configured' },
        limitHit: null,
      },
    }),
  );
  assert.equal(check.passed, false);
  assert.match(check.detail, /cost budget was not enforced/u);
});

test('a scripted run is exempt from cost accounting and from being submittable', () => {
  const scripted = result({
    model: 'scripted-test-driver',
    usage: {
      toolCalls: 5,
      patchAttempts: 1,
      wallClockMs: 30000,
      tokens: null,
      cost: { kind: 'unknown', why: 'no-usage-reported' },
      limitHit: null,
    },
  });
  assert.equal(costAccountingCheck(scripted).passed, true);
  assert.equal(productionSandboxCheck(scripted).passed, false);
});

test('oracle findings lose every host path before they can be shown to the model', () => {
  const outcome: VerificationOutcome = {
    kind: 'failed',
    exitCode: 1,
    durationMs: 10,
    checks: [
      'FAIL the project compiles: Cannot find module /srv/runs/run-1/verify-interim/verification-workspace/dist/main.js',
      'PASS package.json is still valid JSON',
    ],
  };
  const findings = sanitizeFindings(outcome, '/srv/runs/run-1', {
    id: 'case/oracle',
    directory: '/srv/fixtures/case/oracle',
    entry: 'oracle.mjs',
    timeoutSeconds: 60,
  });
  const joined = findings.join('\n');
  assert.equal(joined.includes('/srv/runs/run-1'), false);
  assert.equal(joined.includes('/srv/fixtures/case/oracle'), false);
  assert.equal(joined.includes('oracle.mjs'), false);
  assert.match(joined, /FAIL the project compiles/u);
  assert.match(joined, /PASS package\.json is still valid JSON/u);
});

test('a verification that never completed is described rather than quoted', () => {
  const findings = sanitizeFindings({ kind: 'timed-out', timeoutMs: 1000 }, '/srv/runs/run-1', null);
  assert.deepEqual(findings, ['the verification did not complete: timed-out']);
});
