import { z } from 'zod';
import { BudgetLimitKindSchema, BudgetSchema } from './budget.js';
import { ExecutorKindSchema, RunStatusSchema } from './execution.js';
import { FailureReasonSchema } from './failure.js';
import { CaseIdSchema } from './ids.js';
import { ModeSchema } from './mode.js';
import { VerificationOutcomeSchema } from './verification.js';

export const HypothesisStatusSchema = z.enum(['proposed', 'supported', 'refuted', 'fixed']);
export type HypothesisStatus = z.infer<typeof HypothesisStatusSchema>;

export const HypothesisSchema = z.object({
  id: z.string().min(1),
  statement: z.string().min(1),
  evidence: z.string(),
  status: HypothesisStatusSchema,
});
export type Hypothesis = z.infer<typeof HypothesisSchema>;

const base = {
  seq: z.number().int().nonnegative(),
  ts: z.string().min(1),
};

/**
 * `interim` is the independent oracle run that drives the advanced mode's one
 * feedback retry. `final` is the run that decides the outcome.
 */
export const VerificationStageSchema = z.enum(['interim', 'final']);
export type VerificationStage = z.infer<typeof VerificationStageSchema>;

/**
 * One line of trajectory.jsonl. Every payload is redacted before it is written,
 * so these records are safe to attach to a submission.
 */
export const TrajectoryEventSchema = z.discriminatedUnion('type', [
  z.object({
    ...base,
    type: z.literal('run.started'),
    mode: ModeSchema,
    caseId: CaseIdSchema.nullable(),
    model: z.string(),
    executor: ExecutorKindSchema,
    budget: BudgetSchema,
  }),
  z.object({
    ...base,
    type: z.literal('workspace.prepared'),
    fileCount: z.number().int().nonnegative(),
    treeChecksum: z.string().length(64),
  }),
  z.object({
    ...base,
    type: z.literal('preflight.completed'),
    findings: z.array(z.string()),
    commandsRun: z.number().int().nonnegative(),
  }),
  z.object({
    ...base,
    type: z.literal('hypothesis.updated'),
    ledger: z.array(HypothesisSchema),
  }),
  z.object({
    ...base,
    type: z.literal('model.message'),
    role: z.enum(['assistant', 'system', 'user']),
    text: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal('tool.call'),
    callId: z.string(),
    tool: z.string(),
    argsJson: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal('tool.result'),
    callId: z.string(),
    tool: z.string(),
    ok: z.boolean(),
    exitCode: z.number().int().nullable(),
    durationMs: z.number().int().nonnegative(),
    output: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal('patch.attempt'),
    attempt: z.number().int().positive(),
    files: z.array(z.string()),
    accepted: z.boolean(),
    note: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal('evidence.gate'),
    attempt: z.number().int().positive(),
    passed: z.boolean(),
    command: z.string(),
    exitCode: z.number().int().nullable(),
    detail: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal('budget.exceeded'),
    limit: BudgetLimitKindSchema,
    detail: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal('critic.reviewed'),
    approved: z.boolean(),
    critique: z.string(),
    parsed: z.boolean(),
  }),
  z.object({
    ...base,
    type: z.literal('verification.started'),
    oracleId: z.string(),
    stage: VerificationStageSchema,
  }),
  z.object({
    ...base,
    type: z.literal('verification.completed'),
    outcome: VerificationOutcomeSchema,
    stage: VerificationStageSchema,
  }),
  z.object({
    ...base,
    type: z.literal('error'),
    reason: FailureReasonSchema,
    message: z.string(),
  }),
  z.object({
    ...base,
    type: z.literal('run.finished'),
    status: RunStatusSchema,
    wallClockMs: z.number().int().nonnegative(),
  }),
]);
export type TrajectoryEvent = z.infer<typeof TrajectoryEventSchema>;

/** Everything except the bookkeeping fields the writer fills in. */
export type TrajectoryEventInput = DistributiveOmit<TrajectoryEvent, 'seq' | 'ts'>;

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never;

export function serializeEvent(event: TrajectoryEvent): string {
  return JSON.stringify(TrajectoryEventSchema.parse(event));
}

export function parseTrajectory(jsonl: string): TrajectoryEvent[] {
  return jsonl
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line, index) => {
      const parsed = TrajectoryEventSchema.safeParse(JSON.parse(line));
      if (!parsed.success) {
        throw new Error(`trajectory line ${index + 1} is not a valid event: ${parsed.error.message}`);
      }
      return parsed.data;
    });
}
