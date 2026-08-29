import {
  type Budget,
  type BudgetLimitKind,
  type BudgetUsage,
  type Cost,
  type TokenUsage,
} from '../domain/budget.js';
import { ReproDoctorError } from '../domain/failure.js';

export class BudgetExceededError extends ReproDoctorError {
  readonly limit: BudgetLimitKind;

  constructor(limit: BudgetLimitKind, detail: string) {
    super('budget-exhausted', `budget limit reached: ${limit}`, detail);
    this.name = 'BudgetExceededError';
    this.limit = limit;
  }
}

/**
 * Single source of truth for spend during a run. Both modes share one instance
 * type and one set of limits; the advanced mode's preflight commands are
 * charged here too, so its extra structure is never free.
 */
export class BudgetTracker {
  private toolCalls = 0;
  private patchAttempts = 0;
  private reservedToolCalls = 0;
  private tokens: TokenUsage | null = null;
  private limitHit: BudgetLimitKind | null = null;

  constructor(
    private readonly budget: Budget,
    private readonly startedAtMs: number = Date.now(),
    private readonly now: () => number = Date.now,
  ) {}

  get elapsedMs(): number {
    return this.now() - this.startedAtMs;
  }

  /**
   * Calls the current turn may still spend. A reservation is subtracted here,
   * so the number the agent is shown is the number it can actually use, while
   * the hard cap below stays the only thing that can end a run.
   */
  get remainingToolCalls(): number {
    return Math.max(0, this.budget.maxToolCalls - this.toolCalls - this.reservedToolCalls);
  }

  /**
   * Sets, rather than adds to, the number of calls held back from the agent's
   * own turn so a promised later step still has budget. Advanced mode promises
   * one evidence-driven repair turn; without a reservation a first patch on the
   * last call silently cancels it.
   *
   * The reserve is subtracted from what the agent is shown and from what the
   * retry decision reads. It is deliberately not enforced in `chargeToolCall`:
   * a hard refusal there would end the run mid-turn, which is a worse failure
   * than an agent that ignores the number it was given.
   */
  setToolCallReserve(count: number): void {
    this.reservedToolCalls = Math.max(0, count);
  }

  /** Hands the reservation back, immediately before the step it was held for. */
  clearToolCallReserve(): void {
    this.reservedToolCalls = 0;
  }

  get remainingPatchAttempts(): number {
    return Math.max(0, this.budget.maxPatchAttempts - this.patchAttempts);
  }

  get remainingWallClockMs(): number {
    return Math.max(0, this.budget.maxWallClockSeconds * 1000 - this.elapsedMs);
  }

  get hitLimit(): BudgetLimitKind | null {
    return this.limitHit;
  }

  get toolCallsUsed(): number {
    return this.toolCalls;
  }

  get patchAttemptsUsed(): number {
    return this.patchAttempts;
  }

  /** Records a tool call, or throws when it would exceed a limit. */
  chargeToolCall(): void {
    this.assertWallClock();
    if (this.toolCalls >= this.budget.maxToolCalls) {
      this.limitHit = 'tool-calls';
      throw new BudgetExceededError('tool-calls', `limit=${this.budget.maxToolCalls}`);
    }
    this.toolCalls += 1;
  }

  chargePatchAttempt(): void {
    this.assertWallClock();
    if (this.patchAttempts >= this.budget.maxPatchAttempts) {
      this.limitHit = 'patch-attempts';
      throw new BudgetExceededError('patch-attempts', `limit=${this.budget.maxPatchAttempts}`);
    }
    this.patchAttempts += 1;
  }

  assertWallClock(): void {
    if (this.elapsedMs > this.budget.maxWallClockSeconds * 1000) {
      this.limitHit = 'wall-clock';
      throw new BudgetExceededError(
        'wall-clock',
        `limit=${this.budget.maxWallClockSeconds}s elapsed=${Math.round(this.elapsedMs / 1000)}s`,
      );
    }
  }

  /**
   * Adds one model call's usage to the running total. Every turn of a run,
   * including the feedback retry and any critic call, is accumulated here, so
   * the cost the budget enforces is the cost of the whole run.
   */
  addTokens(usage: TokenUsage): void {
    const previous = this.tokens;
    this.tokens =
      previous === null
        ? usage
        : {
            inputTokens: previous.inputTokens + usage.inputTokens,
            outputTokens: previous.outputTokens + usage.outputTokens,
            totalTokens: previous.totalTokens + usage.totalTokens,
            requests: previous.requests + usage.requests,
          };
  }

  /** Records a limit that was reached outside a charge, such as the deadline. */
  markLimit(limit: BudgetLimitKind): void {
    this.limitHit = limit;
  }

  assertCost(cost: Cost): void {
    if (cost.kind === 'measured' && cost.usd > this.budget.maxCostUsd) {
      this.limitHit = 'cost';
      throw new BudgetExceededError('cost', `limit=${this.budget.maxCostUsd} spent=${cost.usd}`);
    }
  }

  /** Timeout for a single sandbox command, never longer than the run has left. */
  commandTimeoutMs(): number {
    return Math.max(1000, Math.min(this.budget.commandTimeoutSeconds * 1000, this.remainingWallClockMs));
  }

  snapshot(cost: Cost): BudgetUsage {
    return {
      toolCalls: this.toolCalls,
      patchAttempts: this.patchAttempts,
      wallClockMs: Math.round(this.elapsedMs),
      tokens: this.tokens,
      cost,
      limitHit: this.limitHit,
    };
  }

  get tokenUsage(): TokenUsage | null {
    return this.tokens;
  }
}
