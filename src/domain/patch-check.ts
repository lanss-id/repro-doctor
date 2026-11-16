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
 * `oracle-mutated`: the oracle directory changed while it was being used.
 *
 * `verified` also requires that the same oracle FAILED on the unpatched
 * repository. An oracle that passes on the broken code cannot tell a fix from
 * no fix, so that case is `inconclusive`, never `verified`.
 */
export const PatchCheckStatusSchema = z.enum([
  'verified',
  'rejected',
  'inconclusive',
  'oracle-mutated',
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
/**
 * How a failing unpatched run was judged to be an assertion failure:
 * `reported-check`: the oracle printed an `[oracle] FAIL ...` line.
 * `declared-exit-status`: the caller declared (--oracle-failure-contract exit-status)
 * that this oracle exits non-zero only for failed assertions. That is the
 * caller's word, not something the run shows, so it is recorded as weaker.
 */
export const BaselineBasisSchema = z.enum(['reported-check', 'declared-exit-status']);
export type BaselineBasis = z.infer<typeof BaselineBasisSchema>;

export const OracleEvidenceSchema = z.object({
  id: z.string(),
  entry: z.string(),
  /**
   * Content snapshot of the oracle directory: sorted paths, file bytes and the
   * executable bit, with nothing ignored. A symlink contributes its target
   * STRING, not the bytes it points to; special files and empty directories are
   * not covered; neither is the runtime or environment the oracle runs in.
   * `id` is only a caller-supplied label.
   */
  digest: z.string().length(64),
  /** The oracle run on the unpatched repository, or null when nothing was run. */
  baseline: VerificationOutcomeSchema.nullable(),
  /** Number of symlinks in the oracle directory; any makes the digest incomplete, so the verdict is inconclusive. */
  symlinkCount: z.number().int().nonnegative(),
  /** The digest was re-computed after the runs and matched. */
  digestStable: z.boolean(),
  /**
   * Whether the oracle failed an assertion on the unpatched repo. It says the
   * oracle reacts to the patch. It does not say the failure is the reported bug,
   * and it is not a measure of correctness or coverage.
   */
  discriminates: z.boolean().nullable(),
  /** Null unless `discriminates` is true. */
  baselineBasis: BaselineBasisSchema.nullable(),
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

/**
 * Results written before oracle evidence existed (schema version 1). They never
 * ran the oracle on the unpatched repository, so a `verified` there means only
 * "the oracle passed the patched copy". They are readable, not upgraded.
 */
export const LegacyPatchCheckResultSchema = PatchCheckResultSchema.omit({ oracle: true, schemaVersion: true }).extend({
  schemaVersion: z.literal(1),
  status: z.enum(['verified', 'rejected', 'does-not-apply', 'source-mutated']),
});
export type LegacyPatchCheckResult = z.infer<typeof LegacyPatchCheckResultSchema>;

export const AnyPatchCheckResultSchema = z.union([PatchCheckResultSchema, LegacyPatchCheckResultSchema]);
export type AnyPatchCheckResult = z.infer<typeof AnyPatchCheckResultSchema>;

/** Parses a verification.json of schema version 1 or 2. Check `schemaVersion` before reading `oracle`. */
export function parsePatchCheckResult(json: unknown): AnyPatchCheckResult {
  return AnyPatchCheckResultSchema.parse(json);
}
