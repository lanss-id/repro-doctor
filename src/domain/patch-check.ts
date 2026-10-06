import { z } from 'zod';
import { RunIdSchema } from './ids.js';
import { SandboxProfileSchema } from './result.js';
import { VerificationOutcomeSchema } from './verification.js';

export const PATCH_CHECK_SCHEMA_VERSION = 1;

/**
 * The verdict on a patch someone else wrote: another agent, a colleague, a bot.
 *
 * `verified` is the only success, and it means one thing: the hidden oracle
 * exited zero against a copy of the repository with the patch applied. The
 * repository's own check is reported beside it and does not decide, because a
 * check the patch author could see is the check a patch can be shaped to pass.
 */
export const PatchCheckStatusSchema = z.enum([
  'verified',
  'rejected',
  'does-not-apply',
  'source-mutated',
]);
export type PatchCheckStatus = z.infer<typeof PatchCheckStatusSchema>;

export const VisibleCheckSchema = z.object({
  command: z.string(),
  passed: z.boolean(),
  exitCode: z.number().int().nullable(),
});

export const PatchCheckResultSchema = z.object({
  schemaVersion: z.literal(PATCH_CHECK_SCHEMA_VERSION),
  id: RunIdSchema,
  startedAt: z.string(),
  finishedAt: z.string(),
  status: PatchCheckStatusSchema,
  detail: z.string(),
  patch: z.object({
    sourcePath: z.string(),
    sha256: z.string().length(64),
    changedFiles: z.array(z.string()),
    addedLines: z.number().int().nonnegative(),
    removedLines: z.number().int().nonnegative(),
  }),
  repo: z.object({
    inputPath: z.string(),
    treeChecksumBefore: z.string().length(64),
    treeChecksumAfter: z.string().length(64),
    mutated: z.boolean(),
  }),
  oracleId: z.string(),
  /** Null when the patch did not apply, so nothing was run. */
  visibleCheck: VisibleCheckSchema.nullable(),
  verification: VerificationOutcomeSchema,
  sandbox: SandboxProfileSchema.nullable(),
  artifacts: z.object({
    dir: z.string(),
    resultPath: z.string(),
    patchPath: z.string(),
    checkLogPath: z.string(),
    verificationLogPath: z.string(),
  }),
});
export type PatchCheckResult = z.infer<typeof PatchCheckResultSchema>;
