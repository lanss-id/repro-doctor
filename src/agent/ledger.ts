import { z } from 'zod';
import { HypothesisSchema, type Hypothesis } from '../domain/trajectory.js';

/** Structured final answer required from the advanced agent. */
export const AdvancedFinalOutputSchema = z.object({
  hypotheses: z.array(HypothesisSchema).max(8),
  patchSummary: z.string(),
});
export type AdvancedFinalOutput = z.infer<typeof AdvancedFinalOutputSchema>;

export function renderLedger(hypotheses: readonly Hypothesis[]): string {
  if (hypotheses.length === 0) {
    return '(the agent recorded no hypotheses)';
  }
  return hypotheses
    .map((entry) => `- [${entry.status}] ${entry.id}: ${entry.statement}\n  evidence: ${entry.evidence}`)
    .join('\n');
}

export function supportedHypotheses(hypotheses: readonly Hypothesis[]): Hypothesis[] {
  return hypotheses.filter((entry) => entry.status === 'supported' || entry.status === 'fixed');
}
