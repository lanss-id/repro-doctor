import { z } from 'zod';
import { CaseIdSchema } from './ids.js';

export const FaultKindSchema = z.enum([
  'package-entrypoint',
  'module-format',
  'import-casing',
  'tsconfig-scope',
  'environment-contract',
  'build-order',
  'test-discovery',
  'service-contract',
  'manifest-lockfile',
  'chained',
]);
export type FaultKind = z.infer<typeof FaultKindSchema>;

/**
 * Fixture metadata lives beside the broken repository, never inside it. The
 * agent copies only `repo/`, so it cannot read the answer key.
 */
export const FixtureMetaSchema = z.object({
  id: CaseIdSchema,
  title: z.string().min(1),
  summary: z.string().min(1),
  faultKinds: z.array(FaultKindSchema).min(1),
  faultCount: z.number().int().positive(),
  difficulty: z.enum(['easy', 'medium', 'hard']),
  /** Files a correct minimal repair is expected to touch. Used for reporting only. */
  expectedTouchedFiles: z.array(z.string()).min(1),
  oracle: z.object({
    entry: z.string().min(1),
    timeoutSeconds: z.number().int().positive(),
    checks: z.array(z.string()).min(1),
  }),
  reference: z.object({
    script: z.string().min(1),
    patch: z.string().min(1),
  }),
});
export type FixtureMeta = z.infer<typeof FixtureMetaSchema>;

export interface FixtureLayout {
  readonly meta: FixtureMeta;
  readonly root: string;
  readonly repoDir: string;
  readonly oracleDir: string;
  readonly referenceDir: string;
  readonly metaPath: string;
}
