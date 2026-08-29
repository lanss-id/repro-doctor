import { z } from 'zod';

/**
 * Result of running the hidden semantic oracle against the repaired workspace.
 * The oracle is executed after the agent session is over, in a separate
 * container, from a directory the agent never had access to.
 */
export const VerificationOutcomeSchema = z.discriminatedUnion('kind', [
  z.object({
    kind: z.literal('passed'),
    exitCode: z.literal(0),
    durationMs: z.number().int().nonnegative(),
    checks: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('failed'),
    exitCode: z.number().int(),
    durationMs: z.number().int().nonnegative(),
    checks: z.array(z.string()),
  }),
  z.object({
    kind: z.literal('timed-out'),
    timeoutMs: z.number().int().nonnegative(),
  }),
  z.object({
    kind: z.literal('oracle-error'),
    message: z.string(),
  }),
  z.object({
    kind: z.literal('skipped'),
    why: z.enum(['no-oracle-registered', 'no-patch-produced', 'run-aborted']),
  }),
]);
export type VerificationOutcome = z.infer<typeof VerificationOutcomeSchema>;

export function isVerified(outcome: VerificationOutcome): boolean {
  return outcome.kind === 'passed';
}

export function describeVerification(outcome: VerificationOutcome): string {
  switch (outcome.kind) {
    case 'passed':
      return `oracle passed (${outcome.checks.length} checks)`;
    case 'failed':
      return `oracle failed with exit code ${outcome.exitCode}`;
    case 'timed-out':
      return `oracle timed out after ${outcome.timeoutMs} ms`;
    case 'oracle-error':
      return `oracle could not run: ${outcome.message}`;
    case 'skipped':
      return `verification skipped (${outcome.why})`;
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}
