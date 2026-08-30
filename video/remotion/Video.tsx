import React from 'react';
import { AbsoluteFill, Audio, Sequence, staticFile, useCurrentFrame, useVideoConfig } from 'remotion';
import {
  evidence,
  timeline,
  type Beat,
  type Caption,
  type ExperimentName,
} from './lib/timeline';
import { COLOURS, FONT_SANS, SPACE } from './theme';
import { Terminal } from './components/Terminal';
import {
  ChangelogPanel,
  DifferencePanel,
  ExperimentPanel,
  MechanismPanel,
  SubgroupPanel,
  VariancePanel,
  type ExperimentStaging,
} from './components/Panels';

const frames = (seconds: number, fps: number): number => Math.max(1, Math.round(seconds * fps));

/**
 * The whole video.
 *
 * There is deliberately no number typed into this file or into any component
 * it renders. Terminal content comes from the recordings inlined into
 * timeline.json, and every figure comes from evidence.json, which
 * pipeline/evidence.mjs derives from the committed evaluation artifacts using
 * the project's own scoring code. Changing the result changes the video; there
 * is no path by which the video can say something the artifacts do not.
 */
export const SubmissionVideo: React.FC = () => {
  const { fps } = useVideoConfig();

  return (
    <AbsoluteFill style={{ background: COLOURS.background }}>
      <Grain />

      {timeline.sections.map((section) => (
        <Sequence
          key={section.id}
          from={frames(section.start, fps)}
          durationInFrames={frames(section.duration, fps)}
          name={`${section.id} ${section.title}`}
        >
          {section.audio === null ? null : <Audio src={staticFile(section.audio)} />}

          {section.beats.map((beat, index) => (
            <Sequence
              key={`${section.id}-${index}`}
              from={frames(beat.start, fps)}
              durationInFrames={frames(beat.duration, fps)}
              name={beat.kind}
            >
              <BeatContent beat={beat} sectionTitle={section.title} />
            </Sequence>
          ))}

          {timeline.showCaptions ? <Captions captions={section.captions} /> : null}
        </Sequence>
      ))}

      <Progress />
    </AbsoluteFill>
  );
};

const BeatContent: React.FC<{ readonly beat: Beat; readonly sectionTitle: string }> = ({
  beat,
  sectionTitle,
}) => {
  if (beat.kind === 'terminal') {
    const { cast } = beat;
    const cut = cast.cuts.reduce((total, entry) => total + entry.seconds, 0);
    return (
      <AbsoluteFill
        style={{
          alignItems: 'center',
          justifyContent: 'center',
          flexDirection: 'column',
          padding: SPACE.terminalFrame,
          paddingBottom: timeline.showCaptions
            ? SPACE.captionReserve
            : SPACE.terminalFrame,
        }}
      >
        <Terminal
          cast={cast}
          title={sectionTitle}
          highlights={beat.highlights}
          cutSeconds={cut}
          maxHeight={
            timeline.height - SPACE.terminalFrame -
            (timeline.showCaptions ? SPACE.captionReserve : SPACE.terminalFrame)
          }
          maxWidth={timeline.width - SPACE.terminalFrame * 2}
        />
      </AbsoluteFill>
    );
  }

  return (
    <AbsoluteFill style={{ padding: `${SPACE.frame}px ${SPACE.frame + 20}px` }}>
      <DataBeat beat={beat} />
    </AbsoluteFill>
  );
};

const DataBeat: React.FC<{ readonly beat: Beat }> = ({ beat }) => {
  switch (beat.kind) {
    case 'difference':
      return <DifferencePanel comparison={evidence.comparison} cues={beat.cues} />;
    case 'variance':
      return <VariancePanel variance={evidence.variance} cues={beat.cues} />;
    case 'changelog':
      return <ChangelogPanel entries={evidence.changelog} cues={beat.cues} />;
    case 'subgroup':
      return <SubgroupPanel subgroup={evidence.subgroup} cues={beat.cues} />;
    case 'mechanism':
      return <MechanismPanel mechanism={evidence.mechanism} cues={beat.cues} />;
    case 'experiment':
      return <ExperimentBeat name={beat.experiment} cues={beat.cues} />;
    case 'terminal':
      return null;
    default: {
      const unreachable: never = beat;
      return unreachable;
    }
  }
};

/**
 * The wording for each experiment, and which spoken sentence each part of its
 * panel waits for. `staging` indexes into the beat's own cues, so re-timing the
 * narration re-times the panel with it.
 */
const EXPERIMENT_COPY: Record<
  ExperimentName,
  {
    heading: string;
    differenceLabel: string;
    source: string;
    staging: ExperimentStaging;
  }
> = {
  ablation: {
    heading: 'Remove the bounded retry, and the tool call reserved for it.',
    differenceLabel: 'what removing it costs',
    source: 'submission/evidence/ablation/eval.json',
    staging: { rows: 2, axis: 3, verdict: 4 },
  },
  reserve: {
    heading: 'Hold the reservation still. Remove only the second turn.',
    differenceLabel: 'what removing only the turn costs',
    source: 'submission/evidence/reserve/eval.json',
    staging: { rows: 0, axis: 1, verdict: 2 },
  },
  critic: {
    heading: 'A critic that reviews the patch before the retry decision.',
    differenceLabel: 'what adding it gained',
    source: 'submission/evidence/critic/eval.json',
    staging: { rows: 2, axis: 2, verdict: 2 },
  },
};

const ExperimentBeat: React.FC<{
  readonly name: ExperimentName;
  readonly cues: readonly number[];
}> = ({ name, cues }) => {
  const copy = EXPERIMENT_COPY[name];
  return (
    <ExperimentPanel
      experiment={evidence[name]}
      heading={copy.heading}
      differenceLabel={copy.differenceLabel}
      source={copy.source}
      staging={copy.staging}
      cues={cues}
    />
  );
};

/** Spoken text, shown only while there is no voice track to speak it. */
const Captions: React.FC<{ readonly captions: readonly Caption[] }> = ({ captions }) => {
  const { fps } = useVideoConfig();
  return (
    <>
      {captions.map((caption) => (
        <Sequence
          key={caption.start}
          from={frames(caption.start, fps)}
          durationInFrames={frames(caption.duration, fps)}
          layout="none"
        >
          <div
            style={{
              position: 'absolute',
              left: 0,
              right: 0,
              bottom: 44,
              display: 'flex',
              justifyContent: 'center',
              padding: '0 200px',
            }}
          >
            <div
              style={{
                fontFamily: FONT_SANS,
                fontSize: 30,
                lineHeight: 1.42,
                color: COLOURS.text,
                textAlign: 'center',
                background: 'rgba(8,10,14,0.86)',
                border: `1px solid ${COLOURS.panelEdge}`,
                borderRadius: 10,
                padding: '14px 26px',
              }}
            >
              {caption.text}
            </div>
          </div>
        </Sequence>
      ))}
    </>
  );
};

const Progress: React.FC = () => {
  const frame = useCurrentFrame();
  const { durationInFrames } = useVideoConfig();
  return (
    <div
      style={{
        position: 'absolute',
        left: 0,
        bottom: 0,
        height: 3,
        width: `${(frame / durationInFrames) * 100}%`,
        background: COLOURS.accent,
        opacity: 0.34,
      }}
    />
  );
};

/** A very slight vignette, so a full-bleed near-black frame does not band. */
const Grain: React.FC = () => (
  <AbsoluteFill
    style={{
      background:
        'radial-gradient(120% 90% at 50% 0%, rgba(120,180,230,0.045) 0%, rgba(0,0,0,0) 62%)',
    }}
  />
);
