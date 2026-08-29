import { z } from 'zod';

/**
 * Summary of the diff between the pristine workspace copy and the repaired one.
 *
 * `sha256` is taken over the exact bytes of repair.patch. The file is stored
 * verbatim, without redaction, because both the checksum and `apply` depend on
 * byte equality. That makes it the one artifact of a run that may contain
 * whatever the repository under repair contained, which is why `sensitive` is
 * part of the schema rather than a note in a document nobody reads.
 */
export const PatchSummarySchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('present'),
    path: z.string(),
    sha256: z.string().length(64),
    changedFiles: z.array(z.string()),
    addedLines: z.number().int().nonnegative(),
    removedLines: z.number().int().nonnegative(),
    /** Always true: the stored patch is exact repository content, unredacted. */
    sensitive: z.literal(true),
  }),
  z.object({
    kind: z.literal('empty'),
    path: z.string(),
  }),
]);
export type PatchSummary = z.infer<typeof PatchSummarySchema>;

export const FileChangeSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('added'), path: z.string(), after: z.string() }),
  z.object({ kind: z.literal('removed'), path: z.string(), before: z.string() }),
  z.object({
    kind: z.literal('modified'),
    path: z.string(),
    before: z.string(),
    after: z.string(),
  }),
]);
export type FileChange = z.infer<typeof FileChangeSchema>;
