import { z } from 'zod';

/**
 * Every way a run can end badly. Kept as a closed set so reports can group
 * failures without string matching.
 */
export const FailureReasonSchema = z.enum([
  'missing-api-key',
  'no-price-configured',
  'model-error',
  'model-refused',
  'tool-error',
  'sandbox-unavailable',
  'oracle-error',
  'oracle-missing',
  'patch-invalid',
  'patch-empty',
  'wall-clock-timeout',
  'budget-exhausted',
  'unsafe-path',
  'source-mutated',
  'internal-error',
]);
export type FailureReason = z.infer<typeof FailureReasonSchema>;

/** Error carrying a domain failure reason, so the CLI never has to guess. */
export class ReproDoctorError extends Error {
  readonly reason: FailureReason;
  readonly detail: string | undefined;

  constructor(reason: FailureReason, message: string, detail?: string) {
    super(message);
    this.name = 'ReproDoctorError';
    this.reason = reason;
    this.detail = detail;
  }
}

export function toFailureReason(error: unknown): FailureReason {
  if (error instanceof ReproDoctorError) {
    return error.reason;
  }
  return 'internal-error';
}

export function describeError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }
  return String(error);
}
