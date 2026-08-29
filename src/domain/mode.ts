import { z } from 'zod';

/**
 * The two repair strategies under comparison. Everything else about a run
 * (model, repository, task, tools, budget, oracle) is held identical.
 */
export const ModeSchema = z.enum(['baseline', 'advanced']);
export type Mode = z.infer<typeof ModeSchema>;

export const MODES: readonly Mode[] = ModeSchema.options;

export function isMode(value: string): value is Mode {
  return ModeSchema.safeParse(value).success;
}
