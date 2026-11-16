import { z } from 'zod';
import { RunIdSchema } from './ids.js';
import { SandboxProfileSchema } from './result.js';
import { VerificationOutcomeSchema } from './verification.js';

export const PATCH_CHECK_SCHEMA_VERSION = 2;

/**
 * The verdict on a patch someone else wrote: another agent, a colleague, a bot.
 *
 * `verified` is the only success, and it means one thing: the hidden oracle
 * exited zero against a copy of the repository with the patch applied. The
 * repository's own check is reported beside it and does not decide, because a
 * check the patch author could see is the check a patch can be shaped to pass.
 *
 * `verified` also requires that the same oracle FAILED on the unpatched
 * repository. An oracle that passes on the broken code cannot tell a fix from
 * no fix, so that case is `inconclusive`, never `verified`.
 */
export const PatchCheckStatusSchema = z.enum([
  'verified',
  'rejected',
  'inconclusive',
  'does-not-apply',
  'source-mutated',
]);
export type PatchCheckStatus = z.infer<typeof PatchCheckStatusSchema>;

export const VisibleCheckSchema = z.object({
  command: z.string(),
  passed: z.boolean(),
  exitCode: z.number().int().nullable(),
});

/**
 * What stands behind the verdict: which oracle bytes ran, and whether that
 * oracle discriminates (fails an assertion before the patch). `discriminates`
 * is null when that could not be judged: not run, timeout, oracle error, or a
 * non-zero exit with no reported failed check (possibly a crash or setup error).
 * It does not measure how much of the intended behaviour the oracle covers.
 */
export const OracleEvidenceSchema = z.object({
  id: z.string(),
  entry: z.string(),
  /**
   * Tree checksum of every file in the oracle directory (nothing ignored).
   * `id` is only a caller-supplied label; the digest is what identifies the bytes.
   */
  /** Tree checksum of the oracle directory, so the exact oracle can be re-identified. */
  digest: z.string().length(64),
  /** The oracle run on the unpatched repository, or null when nothing was run. */
  baseline: VerificationOutcomeSchema.nullable(),
  discriminates: z.boolean().nullable(),
});
export type OracleEvidence = z.infer<typeof OracleEvidenceSchema>;

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
  oracle: OracleEvidenceSchema,
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
