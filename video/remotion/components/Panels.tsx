import React from 'react';
import { COLOURS, FONT_MONO, FONT_SANS } from '../theme';
import { Panel } from './Panel';
import { IntervalAxis, RateRow, Reveal, signed } from './Interval';
import type {
  ChangelogEntry,
  Comparison,
  Experiment,
  Mechanism,
  Subgroup,
  Variance,
} from '../lib/timeline';

/**
 * Every panel is staged against `cues`: the seconds at which each of its
 * section's spoken sentences begins. A figure arrives when it is spoken about
 * rather than all at once, which is the difference between a slide and an
 * explanation.
 */
export interface Staged {
  readonly cues: readonly number[];
}

const cueAt = (cues: readonly number[], index: number, fallback: number): number =>
  cues[index] ?? fallback;

/** Section 04: the headline comparison, and the interval that crosses zero. */
export const DifferencePanel: React.FC<Staged & { readonly comparison: Comparison }> = ({
  comparison,
  cues,
}) => {
  const cue = (index: number, fallback: number) => cueAt(cues, index, fallback);
  return (
    <Panel
      title={`${comparison.batch.runs} runs. ${comparison.batch.cases.length} broken repositories, both modes, ${comparison.batch.repeats} repeats.`}
      subtitle="Verified repair means the hidden oracle exited zero and every safety check passed."
      source="submission/evidence/confirmatory/eval.json"
      sourceDelay={cue(3, 8)}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <RateRow
          label="baseline"
          rate={comparison.baseline}
          colour={COLOURS.baseline}
          delay={cue(2, 4)}
        />
        <RateRow
          label="advanced"
          rate={comparison.advanced}
          colour={COLOURS.advanced}
          delay={cue(2, 4) + 0.35}
        />
      </div>

      <Reveal delay={cue(3, 8)}>
        <div style={{ fontFamily: FONT_SANS, fontSize: 26, color: COLOURS.muted, marginTop: 12 }}>
          advanced minus baseline
        </div>
      </Reveal>

      <IntervalAxis
        difference={comparison.difference}
        delay={cue(3, 8)}
        captionDelay={cue(4, 16)}
        caption={
          comparison.difference.includesZero
            ? 'It includes zero. By the rule fixed before the batch ran, that is a null result.'
            : 'The interval excludes zero.'
        }
      />
    </Panel>
  );
};

/**
 * Section 05, second half: the same arm run three times.
 *
 * One axis, three dots, and the effect size drawn on the same scale underneath.
 * The sentence this has to support is "the noise is bigger than the signal",
 * and two charts side by side would let a viewer avoid making the comparison.
 */
export const VariancePanel: React.FC<Staged & { readonly variance: Variance }> = ({
  variance,
  cues,
}) => {
  const cue = (index: number, fallback: number) => cueAt(cues, index, fallback);
  const min = 40;
  const max = 70;
  const position = (value: number) => ((value - min) / (max - min)) * 100;
  const percents = variance.batches.map((batch) => batch.percent);
  const lowest = Math.min(...percents);
  const highest = Math.max(...percents);
  const ticks = [40, 45, 50, 55, 60, 65, 70];

  return (
    <Panel
      title="The baseline arm has not changed by a character. It was run three times."
      subtitle="Same model, same instructions, same budget, temperature zero, nothing else touched."
      source="submission/evidence/*/eval.json and docs/EVALUATION.md"
      sourceDelay={cue(2, 5)}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '430px 1fr', gap: 34 }}>
        <div />
        <div style={{ position: 'relative', height: 26 }}>
          {ticks.map((tick) => (
            <div
              key={tick}
              style={{
                position: 'absolute',
                left: `${position(tick)}%`,
                transform: 'translateX(-50%)',
                fontFamily: FONT_MONO,
                fontSize: 19,
                color: COLOURS.faint,
              }}
            >
              {tick}%
            </div>
          ))}
        </div>

        {variance.batches.map((batch, index) => (
          <React.Fragment key={batch.label}>
            <Reveal delay={cue(2, 5) + index * 0.5} shift={10}>
              <div
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: 25,
                  color: COLOURS.text,
                  textAlign: 'right',
                  paddingTop: 8,
                }}
              >
                {batch.label}
                <span style={{ fontFamily: FONT_MONO, color: COLOURS.faint }}>
                  {'  '}
                  {batch.verified}/{batch.runs}
                </span>
              </div>
            </Reveal>
            <Reveal delay={cue(2, 5) + index * 0.5} shift={10}>
              <div style={{ position: 'relative', height: 52 }}>
                <div
                  style={{
                    position: 'absolute',
                    top: 17,
                    left: 0,
                    right: 0,
                    height: 1,
                    background: COLOURS.grid,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: 8,
                    left: `${position(batch.percent)}%`,
                    transform: 'translateX(-50%)',
                    width: 19,
                    height: 19,
                    borderRadius: 10,
                    background: COLOURS.baseline,
                  }}
                />
                <div
                  style={{
                    position: 'absolute',
                    top: 4,
                    left: `calc(${position(batch.percent)}% + 20px)`,
                    fontFamily: FONT_MONO,
                    fontSize: 24,
                    color: COLOURS.text,
                    whiteSpace: 'nowrap',
                  }}
                >
                  {batch.percent.toFixed(1)}%
                </div>
              </div>
            </Reveal>
          </React.Fragment>
        ))}

        <Bracket
          delay={cue(3, 9)}
          label="spread of an arm that did not change"
          colour={COLOURS.caution}
          left={position(lowest)}
          right={position(highest)}
          value={`${variance.spreadPoints.toFixed(1)} points`}
        />
        <Bracket
          delay={cue(4, 14)}
          label="the effect the benchmark is trying to detect"
          colour={COLOURS.advanced}
          left={position(min)}
          right={position(min + variance.effectPoints)}
          value={`${variance.effectPoints.toFixed(1)} points`}
        />
      </div>

      <Reveal delay={cue(5, 18)}>
        <div style={{ fontFamily: FONT_SANS, fontSize: 36, color: COLOURS.caution }}>
          The noise is bigger than the signal.
        </div>
      </Reveal>
    </Panel>
  );
};

/** A labelled span on the variance axis, so two spans can be compared by eye. */
const Bracket: React.FC<{
  readonly delay: number;
  readonly label: string;
  readonly colour: string;
  readonly left: number;
  readonly right: number;
  readonly value: string;
}> = ({ delay, label, colour, left, right, value }) => (
  <>
    <Reveal delay={delay}>
      <div
        style={{
          fontFamily: FONT_SANS,
          fontSize: 25,
          color: colour,
          textAlign: 'right',
          paddingTop: 4,
        }}
      >
        {label}
      </div>
    </Reveal>
    <Reveal delay={delay}>
      <div style={{ position: 'relative', height: 66 }}>
        <div
          style={{
            position: 'absolute',
            top: 6,
            left: `${left}%`,
            width: `${right - left}%`,
            height: 12,
            borderLeft: `2px solid ${colour}`,
            borderRight: `2px solid ${colour}`,
            borderBottom: `2px solid ${colour}`,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 24,
            left: `${(left + right) / 2}%`,
            transform: 'translateX(-50%)',
            fontFamily: FONT_MONO,
            fontSize: 34,
            color: colour,
            whiteSpace: 'nowrap',
          }}
        >
          {value}
        </div>
      </div>
    </Reveal>
  </>
);

/** Which spoken sentence each part of an experiment panel waits for. */
export interface ExperimentStaging {
  readonly rows: number;
  readonly axis: number;
  readonly verdict: number;
}

/** Sections 06 and 07: one ingredient removed, and what removing it cost. */
export const ExperimentPanel: React.FC<
  Staged & {
    readonly experiment: Experiment;
    readonly heading: string;
    readonly source: string;
    readonly differenceLabel: string;
    readonly staging: ExperimentStaging;
  }
> = ({ experiment, heading, source, differenceLabel, staging, cues }) => {
  const rows = cueAt(cues, staging.rows, 3);
  const axis = cueAt(cues, staging.axis, 5);
  const verdict = cueAt(cues, staging.verdict, 8);
  return (
    <Panel
      title={heading}
      subtitle={`${experiment.cases.length} cases, ${experiment.control.runs + experiment.treatment.runs} runs, control re-run alongside the treatment.`}
      source={source}
      sourceDelay={axis}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        <RateRow
          label={experiment.controlLabel.replace(/\s*\(.*\)$/, '')}
          rate={experiment.control}
          colour={COLOURS.advanced}
          delay={rows}
        />
        <RateRow
          label={experiment.treatmentLabel.replace(/\s*\(.*\)$/, '')}
          rate={experiment.treatment}
          colour={COLOURS.baseline}
          delay={rows + 0.35}
        />
      </div>

      <Reveal delay={axis}>
        <div style={{ fontFamily: FONT_SANS, fontSize: 26, color: COLOURS.muted, marginTop: 12 }}>
          {differenceLabel}
        </div>
      </Reveal>

      <IntervalAxis
        difference={experiment.difference}
        delay={axis}
        captionDelay={verdict}
        caption={
          experiment.difference.includesZero
            ? 'The interval includes zero.'
            : 'The interval excludes zero.'
        }
      />

      <Reveal delay={verdict + 0.4}>
        <div style={{ fontFamily: FONT_MONO, fontSize: 22, color: COLOURS.muted }}>
          decision rule fixed before the run · {experiment.decision.verdict}
        </div>
      </Reveal>
    </Panel>
  );
};

/**
 * Section 06, middle: what the treatment runs actually did.
 *
 * The ablation's headline number is right and the reason given for it was
 * wrong, which only reading the runs showed. The counts here are recomputed
 * from the bundle; the sentence under them is quoted, because which of those
 * runs hit the tool-call limit is in trajectories that are not committed.
 */
export const MechanismPanel: React.FC<Staged & { readonly mechanism: Mechanism }> = ({
  mechanism,
  cues,
}) => {
  const cue = (index: number, fallback: number) => cueAt(cues, index, fallback);
  return (
    <Panel
      title="But the mechanism was not what I predicted."
      subtitle="The same seventy runs, by what each one ended up doing."
      source="submission/evidence/ablation/eval.json"
      sourceDelay={cue(1, 3)}
    >
      <div
        style={{ display: 'grid', gridTemplateColumns: '1fr 210px 210px', gap: 18, marginTop: 4 }}
      >
        <div />
        {(['with the retry', 'without it'] as const).map((label) => (
          <div
            key={label}
            style={{
              fontFamily: FONT_SANS,
              fontSize: 23,
              color: COLOURS.muted,
              textAlign: 'right',
            }}
          >
            {label}
          </div>
        ))}

        {mechanism.statuses.map((row, index) => (
          <React.Fragment key={row.status}>
            <Reveal delay={cue(1, 3) + index * 0.3} shift={8}>
              <div style={{ fontFamily: FONT_SANS, fontSize: 27, color: COLOURS.text }}>
                {row.label}
              </div>
            </Reveal>
            {([row.control, row.treatment] as const).map((count, column) => (
              <Reveal key={column} delay={cue(1, 3) + index * 0.3} shift={8}>
                <div
                  style={{
                    fontFamily: FONT_MONO,
                    fontSize: 30,
                    textAlign: 'right',
                    color:
                      row.status === 'no-patch' && column === 1 ? COLOURS.caution : COLOURS.text,
                  }}
                >
                  {count}
                </div>
              </Reveal>
            ))}
          </React.Fragment>
        ))}
      </div>

      <Reveal delay={cue(2, 6)}>
        <div
          style={{
            fontFamily: FONT_SANS,
            fontSize: 27,
            lineHeight: 1.45,
            color: COLOURS.caution,
            maxWidth: 1340,
          }}
        >
          {mechanism.note.text}
          <span style={{ fontFamily: FONT_MONO, fontSize: 18, color: COLOURS.faint }}>
            {'  '}
            {mechanism.note.source}
          </span>
        </div>
      </Reveal>

      <Reveal delay={cue(3, 9)}>
        <div style={{ fontFamily: FONT_SANS, fontSize: 31, color: COLOURS.text }}>
One reservation, two effects: it funded the retry, and it made the agent patch earlier.
        </div>
      </Reveal>
    </Panel>
  );
};

/** Section 05, first half: what was tried, and what each attempt cost. */
export const ChangelogPanel: React.FC<Staged & { readonly entries: readonly ChangelogEntry[] }> = ({
  entries,
  cues,
}) => {
  const start = cueAt(cues, 0, 0) + 0.25;
  const span = Math.max(1, cueAt(cues, 2, 10) - start);
  return (
    <Panel
      title="Seven iterations, each with the run that caused it."
      subtitle="Failures are in the table with the same weight as the wins."
      source="docs/IMPROVEMENT_CHANGELOG.md"
      sourceDelay={start}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: 3 }}>
        {entries.map((entry, index) => (
          <Reveal
            key={entry.stage}
            delay={start + (span * index) / Math.max(1, entries.length - 1)}
            shift={8}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '175px 1fr 430px',
                gap: 26,
                padding: '9px 16px',
                borderRadius: 7,
                background: index % 2 === 0 ? 'rgba(255,255,255,0.018)' : 'transparent',
                alignItems: 'baseline',
              }}
            >
              <div style={{ fontFamily: FONT_MONO, fontSize: 21, color: COLOURS.advanced }}>
                {entry.stage}
              </div>
              <div
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: 21,
                  color: COLOURS.text,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {entry.what}
              </div>
              <div
                style={{
                  fontFamily: FONT_SANS,
                  fontSize: 19,
                  color: entry.decision.toLowerCase().startsWith('discard')
                    ? COLOURS.caution
                    : COLOURS.muted,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
              >
                {entry.decision}
              </div>
            </div>
          </Reveal>
        ))}
      </div>
    </Panel>
  );
};

/** Section 07, second half: the subgroup that looked like a finding and was not. */
export const SubgroupPanel: React.FC<Staged & { readonly subgroup: Subgroup }> = ({
  subgroup,
  cues,
}) => {
  const cue = (index: number, fallback: number) => cueAt(cues, index, fallback);
  const cards = [
    { label: 'First batch, where it was found', batch: subgroup.exploratory, delay: cue(1, 2) },
    { label: 'Next batch, testing it', batch: subgroup.confirmatory, delay: cue(3, 12) },
  ];

  return (
    <Panel
      title="The same five repositories, measured twice."
      subtitle="Found after seeing the first batch, so it became the next batch's hypothesis instead of its headline."
      source="submission/evidence/exploratory/eval.json and submission/evidence/confirmatory/eval.json"
      sourceDelay={cue(3, 12)}
    >
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 56 }}>
        {cards.map(({ label, batch, delay }) => (
          <Reveal key={label} delay={delay}>
            <div
              style={{
                border: `1px solid ${COLOURS.panelEdge}`,
                borderRadius: 12,
                padding: 30,
                background: COLOURS.panel,
              }}
            >
              <div style={{ fontFamily: FONT_SANS, fontSize: 25, color: COLOURS.muted }}>
                {label}
              </div>
              <div style={{ marginTop: 22, display: 'flex', flexDirection: 'column', gap: 12 }}>
                {(
                  [
                    ['baseline', batch.baseline],
                    ['advanced', batch.advanced],
                  ] as const
                ).map(([mode, rate]) => (
                  <div key={mode} style={{ display: 'flex', justifyContent: 'space-between' }}>
                    <span style={{ fontFamily: FONT_SANS, fontSize: 26, color: COLOURS.text }}>
                      {mode}
                    </span>
                    <span style={{ fontFamily: FONT_MONO, fontSize: 26, color: COLOURS.text }}>
                      {rate.verified}/{rate.runs}
                    </span>
                  </div>
                ))}
              </div>
              <div
                style={{
                  marginTop: 24,
                  paddingTop: 20,
                  borderTop: `1px solid ${COLOURS.panelEdge}`,
                  fontFamily: FONT_MONO,
                  fontSize: 30,
                  color: batch.difference.includesZero ? COLOURS.caution : COLOURS.positive,
                }}
              >
                {signed(batch.difference.points)} points
                <div style={{ fontSize: 20, color: COLOURS.faint, marginTop: 6 }}>
                  95% CI {signed(batch.difference.low)} to {signed(batch.difference.high)}
                  {batch.difference.includesZero ? ' · includes zero' : ' · excludes zero'}
                </div>
              </div>
            </div>
          </Reveal>
        ))}
      </div>

      <Reveal delay={cue(4, 20)}>
        <div style={{ fontFamily: FONT_SANS, fontSize: 34, color: COLOURS.caution }}>
          {`The ${signed(subgroup.exploratory.difference.points)} points was noise.`}
        </div>
      </Reveal>
    </Panel>
  );
};
