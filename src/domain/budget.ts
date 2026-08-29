import { z } from 'zod';

/**
 * Hard limits applied identically to both modes. A run that hits any limit is
 * stopped; it is never silently extended.
 */
export const BudgetSchema = z.object({
  maxToolCalls: z.number().int().positive(),
  maxPatchAttempts: z.number().int().positive(),
  maxWallClockSeconds: z.number().int().positive(),
  maxCostUsd: z.number().positive(),
  /** Per-command timeout inside the sandbox. */
  commandTimeoutSeconds: z.number().int().positive(),
});
export type Budget = z.infer<typeof BudgetSchema>;

export const DEFAULT_BUDGET: Budget = Object.freeze({
  maxToolCalls: 12,
  maxPatchAttempts: 2,
  maxWallClockSeconds: 360,
  maxCostUsd: 0.3,
  commandTimeoutSeconds: 60,
});

export const BudgetLimitKindSchema = z.enum([
  'tool-calls',
  'patch-attempts',
  'wall-clock',
  'cost',
]);
export type BudgetLimitKind = z.infer<typeof BudgetLimitKindSchema>;

/**
 * Token counts are only present when the model provider reported them. A run
 * that never reached the provider keeps them null rather than zero, so reports
 * can tell "no call happened" apart from "a call used nothing".
 */
export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
  requests: z.number().int().nonnegative(),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

export const CostSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('measured'), usd: z.number().nonnegative() }),
  z.object({
    kind: z.literal('unknown'),
    why: z.enum(['no-price-configured', 'no-usage-reported', 'no-model-call']),
  }),
]);
export type Cost = z.infer<typeof CostSchema>;

export const BudgetUsageSchema = z.object({
  toolCalls: z.number().int().nonnegative(),
  patchAttempts: z.number().int().nonnegative(),
  wallClockMs: z.number().int().nonnegative(),
  tokens: TokenUsageSchema.nullable(),
  cost: CostSchema,
  limitHit: BudgetLimitKindSchema.nullable(),
});
export type BudgetUsage = z.infer<typeof BudgetUsageSchema>;

export function isWithinBudget(usage: BudgetUsage, budget: Budget): boolean {
  if (usage.toolCalls > budget.maxToolCalls) return false;
  if (usage.patchAttempts > budget.maxPatchAttempts) return false;
  if (usage.wallClockMs > budget.maxWallClockSeconds * 1000) return false;
  if (usage.cost.kind === 'measured' && usage.cost.usd > budget.maxCostUsd) return false;
  return true;
}
