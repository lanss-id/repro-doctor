import { z } from 'zod';

/**
 * Vocabulary shared by run results and trajectory events. It lives in its own
 * module so both can import the authoritative definition without either one
 * depending on the other.
 */

export const ExecutorKindSchema = z.enum(['docker', 'local-test-adapter']);
export type ExecutorKind = z.infer<typeof ExecutorKindSchema>;

/** How a run ended. The tags of RunOutcome are exactly these values. */
export const RunStatusSchema = z.enum([
  'repaired',
  'unverified-patch',
  'no-patch',
  'budget-exhausted',
  'failed',
]);
export type RunStatus = z.infer<typeof RunStatusSchema>;

/**
 * Which arm of an A/B experiment a run belongs to. Null for ordinary runs,
 * which are not part of an experiment at all.
 */
export const ExperimentArmSchema = z.enum(['control', 'treatment']);
export type ExperimentArm = z.infer<typeof ExperimentArmSchema>;
