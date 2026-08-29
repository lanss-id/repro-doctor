import assert from 'node:assert/strict';
import test from 'node:test';
import { DEFAULT_BUDGET, isWithinBudget, type Budget } from '../../src/domain/budget.js';
import { BudgetExceededError, BudgetTracker } from '../../src/agent/budget-tracker.js';

const budget: Budget = {
  maxToolCalls: 3,
  maxPatchAttempts: 1,
  maxWallClockSeconds: 10,
  maxCostUsd: 0.1,
  commandTimeoutSeconds: 5,
};

test('the default budget is the one the project documents', () => {
  assert.deepEqual(DEFAULT_BUDGET, {
    maxToolCalls: 12,
    maxPatchAttempts: 2,
    maxWallClockSeconds: 360,
    maxCostUsd: 0.3,
    commandTimeoutSeconds: 60,
  });
});

test('tool calls are charged until the limit, then refused', () => {
  const tracker = new BudgetTracker(budget);
  tracker.chargeToolCall();
  tracker.chargeToolCall();
  tracker.chargeToolCall();
  assert.equal(tracker.remainingToolCalls, 0);
  assert.throws(() => tracker.chargeToolCall(), BudgetExceededError);
  assert.equal(tracker.hitLimit, 'tool-calls');
});

test('patch attempts have their own limit', () => {
  const tracker = new BudgetTracker(budget);
  tracker.chargePatchAttempt();
  assert.throws(() => tracker.chargePatchAttempt(), BudgetExceededError);
  assert.equal(tracker.hitLimit, 'patch-attempts');
});

test('the wall clock stops the run once it is past the limit', () => {
  let now = 1_000_000;
  const tracker = new BudgetTracker(budget, now, () => now);
  tracker.chargeToolCall();
  now += 11_000;
  assert.throws(() => tracker.assertWallClock(), BudgetExceededError);
  assert.equal(tracker.hitLimit, 'wall-clock');
});

test('a command never gets a longer timeout than the run has left', () => {
  let now = 1_000_000;
  const tracker = new BudgetTracker(budget, now, () => now);
  assert.equal(tracker.commandTimeoutMs(), 5000);
  now += 8_000;
  assert.equal(tracker.commandTimeoutMs(), 2000);
  now += 5_000;
  assert.equal(tracker.commandTimeoutMs(), 1000);
});

test('a measured cost above the limit stops the run, an unknown cost does not', () => {
  const tracker = new BudgetTracker(budget);
  tracker.assertCost({ kind: 'unknown', why: 'no-price-configured' });
  assert.equal(tracker.hitLimit, null);
  tracker.assertCost({ kind: 'measured', usd: 0.05 });
  assert.throws(() => tracker.assertCost({ kind: 'measured', usd: 0.2 }), BudgetExceededError);
  assert.equal(tracker.hitLimit, 'cost');
});

test('the snapshot reports what was spent', () => {
  let now = 1_000_000;
  const tracker = new BudgetTracker(budget, now, () => now);
  tracker.chargeToolCall();
  tracker.chargePatchAttempt();
  tracker.addTokens({ inputTokens: 100, outputTokens: 20, totalTokens: 120, requests: 1 });
  now += 2_500;
  const snapshot = tracker.snapshot({ kind: 'measured', usd: 0.01 });
  assert.equal(snapshot.toolCalls, 1);
  assert.equal(snapshot.patchAttempts, 1);
  assert.equal(snapshot.wallClockMs, 2500);
  assert.deepEqual(snapshot.tokens, { inputTokens: 100, outputTokens: 20, totalTokens: 120, requests: 1 });
  assert.equal(isWithinBudget(snapshot, budget), true);
});

test('usage from several model calls accumulates instead of replacing', () => {
  const tracker = new BudgetTracker(budget);
  tracker.addTokens({ inputTokens: 100, outputTokens: 20, totalTokens: 120, requests: 1 });
  tracker.addTokens({ inputTokens: 50, outputTokens: 10, totalTokens: 60, requests: 1 });
  tracker.addTokens({ inputTokens: 5, outputTokens: 1, totalTokens: 6, requests: 1 });
  assert.deepEqual(tracker.tokenUsage, {
    inputTokens: 155,
    outputTokens: 31,
    totalTokens: 186,
    requests: 3,
  });
});

test('a limit reached outside a charge, such as the deadline, is still recorded', () => {
  const tracker = new BudgetTracker(budget);
  assert.equal(tracker.hitLimit, null);
  tracker.markLimit('wall-clock');
  assert.equal(tracker.hitLimit, 'wall-clock');
  assert.equal(tracker.snapshot({ kind: 'unknown', why: 'no-model-call' }).limitHit, 'wall-clock');
});

test('isWithinBudget catches an over-budget snapshot', () => {
  assert.equal(
    isWithinBudget(
      {
        toolCalls: 99,
        patchAttempts: 0,
        wallClockMs: 0,
        tokens: null,
        cost: { kind: 'unknown', why: 'no-model-call' },
        limitHit: null,
      },
      budget,
    ),
    false,
  );
});
