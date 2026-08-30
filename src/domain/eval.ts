import { z } from 'zod';
import { BudgetSchema, CostSchema } from './budget.js';
import { ExecutorKindSchema, ExperimentArmSchema } from './execution.js';
import { CaseIdSchema, RunIdSchema } from './ids.js';
import { ModeSchema } from './mode.js';

export const EVAL_SCHEMA_VERSION = 2;

export const CheckResultSchema = z.object({
  name: z.enum([
    'oracle-access',
    'source-immutability',
    'budget-compliance',
    'verification-exit-status',
    'semantic-oracle',
    'production-sandbox',
    'cost-accounting',
  ]),
  passed: z.boolean(),
  detail: z.string(),
});
export type CheckResult = z.infer<typeof CheckResultSchema>;

export const EvalRunSchema = z.object({
  caseId: CaseIdSchema,
  mode: ModeSchema,
  /** Null for an ordinary run. Set only for runs that belong to an experiment. */
  arm: ExperimentArmSchema.nullable(),
  repeat: z.number().int().positive(),
  runId: RunIdSchema.nullable(),
  status: z.string(),
  verified: z.boolean(),
  wallClockMs: z.number().int().nonnegative(),
  cost: CostSchema,
  checks: z.array(CheckResultSchema),
  error: z.string().nullable(),
});
export type EvalRun = z.infer<typeof EvalRunSchema>;

export const ModeSummarySchema = z.object({
  mode: ModeSchema,
  runs: z.number().int().nonnegative(),
  verifiedRepairs: z.number().int().nonnegative(),
  /** Null when no run completed, never zero-as-a-placeholder. */
  verifiedRepairRate: z.number().min(0).max(1).nullable(),
  medianWallClockMs: z.number().nonnegative().nullable(),
  medianCostUsd: z.number().nonnegative().nullable(),
  costUnknownRuns: z.number().int().nonnegative(),
  unsafeMutations: z.number().int().nonnegative(),
  budgetViolations: z.number().int().nonnegative(),
  oracleAccessViolations: z.number().int().nonnegative(),
});
export type ModeSummary = z.infer<typeof ModeSummarySchema>;

export const EvalStatusSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('complete') }),
  z.object({
    kind: z.literal('pending'),
    why: z.enum(['missing-api-key', 'no-price-configured', 'sandbox-unavailable', 'not-run-yet']),
    detail: z.string(),
  }),
  z.object({ kind: z.literal('partial'), detail: z.string() }),
]);
export type EvalStatus = z.infer<typeof EvalStatusSchema>;

/** The experiments this repository has run. Each has its own report file. */
export const ExperimentNameSchema = z.enum(['critic', 'ablation']);
export type ExperimentName = z.infer<typeof ExperimentNameSchema>;

export const ExperimentDecisionSchema = z.object({
  /**
   * `unresolved` exists because "removing it did not measurably hurt" and "the
   * sample cannot tell" are different answers, and an experiment that reports
   * the second as the first has thrown away the only honest thing it measured.
   */
  status: z.enum(['pending', 'keep', 'discard', 'unresolved']),
  keep: z.boolean(),
  repairRateDeltaPoints: z.number().nullable(),
  costChangePercent: z.number().nullable(),
  intervalLowPoints: z.number().nullable().default(null),
  intervalHighPoints: z.number().nullable().default(null),
  reason: z.string(),
});
export type ExperimentDecisionRecord = z.infer<typeof ExperimentDecisionSchema>;

/**
 * Result of an A/B experiment inside an evaluation. `decision` applies the rule
 * that was written down before the experiment ran; it returns `keep: false`
 * whenever either side is unmeasured, so a half-measured batch cannot settle it.
 */
export const ExperimentReportSchema = z.object({
  name: ExperimentNameSchema,
  hypothesis: z.string(),
  rule: z.string(),
  cases: z.array(CaseIdSchema),
  control: ModeSummarySchema,
  treatment: ModeSummarySchema,
  decision: ExperimentDecisionSchema,
});
export type ExperimentReport = z.infer<typeof ExperimentReportSchema>;

export const EvalReportSchema = z.object({
  schemaVersion: z.literal(EVAL_SCHEMA_VERSION),
  generatedAt: z.string(),
  status: EvalStatusSchema,
  model: z.string(),
  executor: ExecutorKindSchema,
  repeats: z.number().int().positive(),
  budget: BudgetSchema,
  cases: z.array(CaseIdSchema),
  runs: z.array(EvalRunSchema),
  summaries: z.array(ModeSummarySchema),
  /** Null unless the batch was run with `--experiment`. */
  experiment: ExperimentReportSchema.nullable(),
});
export type EvalReport = z.infer<typeof EvalReportSchema>;
