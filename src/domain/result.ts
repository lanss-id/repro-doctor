import { z } from 'zod';
import { BudgetLimitKindSchema, BudgetSchema, BudgetUsageSchema } from './budget.js';
import { ExecutorKindSchema, RunStatusSchema, type RunStatus } from './execution.js';
import { FailureReasonSchema } from './failure.js';
import { CaseIdSchema, RunIdSchema } from './ids.js';
import { ModeSchema } from './mode.js';
import { PatchSummarySchema } from './patch.js';
import { VerificationOutcomeSchema } from './verification.js';

export const RESULT_SCHEMA_VERSION = 2;

export { ExecutorKindSchema, RunStatusSchema };
export type { ExecutorKind, RunStatus } from './execution.js';

export const SandboxProfileSchema = z.object({
  executor: ExecutorKindSchema,
  image: z.string().nullable(),
  network: z.enum(['none', 'host-inherited']),
  readOnlyRootFilesystem: z.boolean(),
  /**
   * False when the host rejects `--security-opt no-new-privileges`, which some
   * Docker setups do. The run still drops every capability and runs unprivileged;
   * the flag is recorded here rather than assumed.
   */
  noNewPrivileges: z.boolean(),
  dockerSocketMounted: z.literal(false),
  oracleMountedDuringRepair: z.literal(false),
  secretsMounted: z.literal(false),
  cpuLimit: z.string().nullable(),
  memoryLimit: z.string().nullable(),
  commandTimeoutSeconds: z.number().int().positive(),
  /** False for the local test adapter, which is not an isolation boundary. */
  productionSafe: z.boolean(),
});
export type SandboxProfile = z.infer<typeof SandboxProfileSchema>;

export const RepoStateSchema = z.object({
  inputPath: z.string(),
  workspacePath: z.string(),
  treeChecksumBefore: z.string().length(64),
  treeChecksumAfter: z.string().length(64),
  mutated: z.boolean(),
  fileCount: z.number().int().nonnegative(),
});
export type RepoState = z.infer<typeof RepoStateSchema>;

/** How the run ended. `repaired` is the only success. */
export const RunOutcomeSchema = z.discriminatedUnion('status', [
  z.object({ status: z.literal('repaired') }),
  z.object({ status: z.literal('unverified-patch'), detail: z.string() }),
  z.object({ status: z.literal('no-patch'), detail: z.string() }),
  z.object({
    status: z.literal('budget-exhausted'),
    limit: BudgetLimitKindSchema,
    detail: z.string(),
  }),
  z.object({ status: z.literal('failed'), reason: FailureReasonSchema, detail: z.string() }),
]);
export type RunOutcome = z.infer<typeof RunOutcomeSchema>;

/**
 * Compile-time proof that RunStatusSchema and the tags of RunOutcome stay in
 * step. Adding a variant to one without the other stops the build here.
 */
type StatusesAgree = RunOutcome['status'] extends RunStatus
  ? RunStatus extends RunOutcome['status']
    ? true
    : never
  : never;
const _statusesAgree: StatusesAgree = true;
void _statusesAgree;

export const RunResultSchema = z.object({
  schemaVersion: z.literal(RESULT_SCHEMA_VERSION),
  runId: RunIdSchema,
  caseId: CaseIdSchema.nullable(),
  mode: ModeSchema,
  model: z.string(),
  modelSettingsFingerprint: z.string(),
  startedAt: z.string(),
  finishedAt: z.string(),
  sandbox: SandboxProfileSchema,
  repo: RepoStateSchema,
  budget: BudgetSchema,
  usage: BudgetUsageSchema,
  outcome: RunOutcomeSchema,
  verification: VerificationOutcomeSchema,
  patch: PatchSummarySchema,
  artifacts: z.object({
    runDir: z.string(),
    resultPath: z.string(),
    trajectoryPath: z.string(),
    patchPath: z.string(),
    verificationLogPath: z.string(),
    reportPath: z.string(),
  }),
});
export type RunResult = z.infer<typeof RunResultSchema>;

export function isVerifiedRepair(result: RunResult): boolean {
  return result.outcome.status === 'repaired' && result.verification.kind === 'passed';
}
