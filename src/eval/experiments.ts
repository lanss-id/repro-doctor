import type { ExperimentName, ModeSummary } from '../domain/eval.js';
import {
  MAX_COST_INCREASE_PERCENT,
  MIN_REPAIR_RATE_GAIN_POINTS,
  decideAblation,
  decideExperiment,
  type ExperimentDecision,
} from './scoring.js';

/**
 * What an experiment changes between its two arms, and what it is allowed to
 * conclude. Keeping this as data rather than as branches means the runner, the
 * CLI and the report all describe an experiment the same way, and adding one
 * does not mean finding every place that said `critic`.
 */

/** The two flags that distinguish one arm of an experiment from the other. */
export interface ArmSettings {
  readonly criticEnabled: boolean;
  readonly retryEnabled: boolean;
}

export interface ExperimentSpec {
  readonly name: ExperimentName;
  readonly title: string;
  readonly controlLabel: string;
  readonly treatmentLabel: string;
  /** Restricted on purpose. The reason is in docs/PREREGISTRATION.md. */
  readonly cases: readonly string[];
  readonly hypothesis: string;
  /** Fixed in writing before the experiment ran. */
  readonly rule: string;
  readonly control: ArmSettings;
  readonly treatment: ArmSettings;
  readonly decide: (control: ModeSummary, treatment: ModeSummary) => ExperimentDecision;
  readonly verdict: Readonly<Record<ExperimentDecision['status'], string>>;
}

const CRITIC: ExperimentSpec = {
  name: 'critic',
  title: 'Critic experiment',
  controlLabel: 'control (advanced)',
  treatmentLabel: 'treatment (advanced with a critic)',
  cases: ['broken-test-discovery', 'manifest-lockfile-mismatch', 'chained-two-faults'],
  hypothesis:
    'A critic call that reviews the proposed patch against the hypothesis ledger, and can send it back once, catches patches that satisfy the visible check without satisfying the contract.',
  rule: `Keep the critic only for at least +${MIN_REPAIR_RATE_GAIN_POINTS} percentage points of verified repair rate at no more than +${MAX_COST_INCREASE_PERCENT} percent median cost, measured against advanced mode without the critic over the same cases and repeats.`,
  control: { criticEnabled: false, retryEnabled: true },
  treatment: { criticEnabled: true, retryEnabled: true },
  decide: decideExperiment,
  verdict: {
    pending: 'Decision pending',
    keep: 'Keep the critic',
    discard: 'Discard the critic',
    unresolved: 'Undecided',
  },
};

/**
 * Advanced mode shipped five changes at once. This removes one of them, the
 * bounded evidence-driven retry, and measures what it was worth.
 *
 * The treatment arm drops three coupled things because they are one design:
 * the retry turn, the tool calls reserved for it, and the promise of a second
 * turn in the instructions. Releasing the reservation is deliberate. Holding
 * calls back for a turn that never happens would handicap the treatment on
 * budget as well as on structure, and would measure two changes while claiming
 * to measure one. It also makes the ablation conservative: the treatment arm
 * gets more usable calls in its only turn, so if it still loses, the retry is
 * doing real work.
 */
const ABLATION: ExperimentSpec = {
  name: 'ablation',
  title: 'Bounded-retry ablation',
  controlLabel: 'control (advanced as published)',
  treatmentLabel: 'treatment (advanced without the retry)',
  cases: [
    'broken-test-discovery',
    'chained-two-faults',
    'manifest-lockfile-mismatch',
    'monorepo-build-order',
    'tsconfig-include-scope',
  ],
  hypothesis:
    'The bounded evidence-driven retry is the ingredient that carries advanced mode. Removing it lowers the verified repair rate on hard faults.',
  rule:
    'Call the bounded retry load-bearing only if the 95 percent interval on control minus treatment excludes zero, over the same cases, repeats, model and budget. An interval that includes zero is reported as unresolved, never as evidence that the retry does not help.',
  control: { criticEnabled: false, retryEnabled: true },
  treatment: { criticEnabled: false, retryEnabled: false },
  decide: decideAblation,
  verdict: {
    pending: 'Decision pending',
    keep: 'The retry is load-bearing',
    discard: 'Remove the retry',
    unresolved: 'Unresolved at this sample size',
  },
};

export const EXPERIMENTS: Readonly<Record<ExperimentName, ExperimentSpec>> = {
  critic: CRITIC,
  ablation: ABLATION,
};

export const EXPERIMENT_NAMES: readonly ExperimentName[] = Object.keys(
  EXPERIMENTS,
) as ExperimentName[];
