/**
 * Typed views over the two generated files the compositions read.
 *
 * Both are JSON produced by the pipeline, so TypeScript can only infer a shape
 * from whatever values happen to be in them today — a beat union keyed on a
 * `kind: string`, an interval that looks non-nullable because this run's
 * numbers were not null. The declarations here are the contract the pipeline
 * is required to keep, and the one place where the JSON is trusted.
 */
import rawTimeline from '../../timeline.json';
import rawEvidence from '../../evidence/evidence.json';

export interface CastCut {
  readonly at: number;
  readonly seconds: number;
}

export interface Cast {
  readonly width: number;
  readonly height: number;
  readonly cuts: readonly CastCut[];
  readonly events: readonly [number, string][];
}

export interface Highlight {
  readonly text: string;
  readonly label?: string;
  /** Seconds into the recording, resolved by pipeline/build.mjs. */
  readonly from: number;
  /** When it leaves again, or null to hold until the beat ends. */
  readonly until: number | null;
}

interface BeatBase {
  readonly start: number;
  readonly duration: number;
  /** Seconds into the beat at which each of its spoken sentences begins. */
  readonly cues: readonly number[];
}

export interface TerminalBeat extends BeatBase {
  readonly kind: 'terminal';
  readonly cast: Cast;
  readonly castFile: string;
  readonly castDuration: number;
  readonly highlights: readonly Highlight[];
}

export interface FigureBeat extends BeatBase {
  readonly kind: 'difference' | 'variance' | 'changelog' | 'subgroup' | 'mechanism';
}

export type ExperimentName = 'ablation' | 'reserve' | 'critic';

export interface ExperimentBeat extends BeatBase {
  readonly kind: 'experiment';
  readonly experiment: ExperimentName;
}

export type Beat = TerminalBeat | FigureBeat | ExperimentBeat;

export interface Caption {
  readonly text: string;
  readonly start: number;
  readonly duration: number;
}

export interface Section {
  readonly id: string;
  readonly title: string;
  readonly onScreen: string | null;
  readonly start: number;
  readonly duration: number;
  readonly audio: string | null;
  readonly text: string;
  readonly captions: readonly Caption[];
  readonly beats: readonly Beat[];
}

export interface Timeline {
  readonly fps: number;
  readonly width: number;
  readonly height: number;
  readonly totalSeconds: number;
  readonly durationInFrames: number;
  readonly hasAudio: boolean;
  readonly showCaptions: boolean;
  readonly sections: readonly Section[];
}

export interface Rate {
  readonly runs: number;
  readonly verified: number;
  readonly percent: number;
  readonly low: number;
  readonly high: number;
}

export interface Difference {
  readonly points: number;
  readonly low: number;
  readonly high: number;
  readonly includesZero: boolean;
}

export interface Comparison {
  readonly batch: {
    readonly runs: number;
    readonly repeats: number;
    readonly cases: readonly string[];
  };
  readonly baseline: Rate;
  readonly advanced: Rate;
  readonly difference: Difference;
}

export interface Experiment {
  readonly title: string;
  readonly controlLabel: string;
  readonly treatmentLabel: string;
  readonly cases: readonly string[];
  readonly control: Rate;
  readonly treatment: Rate;
  readonly difference: Difference;
  readonly rule: string;
  readonly decision: { readonly status: string; readonly verdict: string };
}

export interface Variance {
  readonly batches: readonly {
    readonly label: string;
    readonly verified: number;
    readonly runs: number;
    readonly percent: number;
  }[];
  readonly spreadPoints: number;
  readonly effectPoints: number;
}

export interface Mechanism {
  readonly statuses: readonly {
    readonly status: string;
    readonly label: string;
    readonly control: number;
    readonly treatment: number;
  }[];
  readonly note: { readonly text: string; readonly source: string };
}

export interface Subgroup {
  readonly cases: readonly string[];
  readonly exploratory: { readonly baseline: Rate; readonly advanced: Rate; readonly difference: Difference };
  readonly confirmatory: { readonly baseline: Rate; readonly advanced: Rate; readonly difference: Difference };
}

export interface ChangelogEntry {
  readonly stage: string;
  readonly what: string;
  readonly evidence: string;
  readonly decision: string;
}

export interface Evidence {
  readonly generatedAt: string;
  readonly comparison: Comparison;
  readonly variance: Variance;
  readonly ablation: Experiment;
  readonly mechanism: Mechanism;
  readonly reserve: Experiment;
  readonly critic: Experiment;
  readonly subgroup: Subgroup;
  readonly changelog: readonly ChangelogEntry[];
}

export const timeline = rawTimeline as unknown as Timeline;
export const evidence = rawEvidence as unknown as Evidence;
