import { randomBytes } from 'node:crypto';
import { z } from 'zod';

/**
 * Run identifiers double as directory names under artifacts/runs, so the
 * character set is restricted to what is safe in a path segment.
 */
export const RunIdSchema = z
  .string()
  .regex(/^[0-9]{8}T[0-9]{6}Z-[a-z0-9]{6}$/u, 'run id must look like 20260829T101500Z-a1b2c3');
export type RunId = z.infer<typeof RunIdSchema>;

export const CaseIdSchema = z
  .string()
  .regex(/^[a-z0-9][a-z0-9-]{1,48}[a-z0-9]$/u, 'case id must be lowercase kebab-case');
export type CaseId = z.infer<typeof CaseIdSchema>;

export function newRunId(now: Date = new Date()): RunId {
  const stamp = now.toISOString().replace(/[-:]/gu, '').replace(/\.\d{3}/u, '');
  const suffix = randomBytes(4).toString('hex').slice(0, 6);
  return RunIdSchema.parse(`${stamp}-${suffix}`);
}
