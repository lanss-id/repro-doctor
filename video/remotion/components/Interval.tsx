import React from 'react';
import { interpolate, spring, useCurrentFrame, useVideoConfig } from 'remotion';
import type { Difference, Rate } from '../lib/timeline';
import { COLOURS, FONT_MONO, FONT_SANS } from '../theme';

export const signed = (value: number): string =>
  `${value >= 0 ? '+' : '−'}${Math.abs(value).toFixed(1)}`;

/** Entry timing shared by every panel, so nothing arrives at a different rhythm. */
export const useReveal = (delaySeconds: number): number => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  return spring({
    frame: frame - delaySeconds * fps,
    fps,
    config: { damping: 200, mass: 0.5 },
    durationInFrames: Math.round(fps * 0.55),
  });
};

export const Reveal: React.FC<{
  readonly delay: number;
  readonly children: React.ReactNode;
  readonly shift?: number;
}> = ({ delay, children, shift = 14 }) => {
  const progress = useReveal(delay);
  return (
    <div
      style={{
        opacity: progress,
        transform: `translateY(${(1 - progress) * shift}px)`,
      }}
    >
      {children}
    </div>
  );
};

/** One mode's verified repair rate, with the interval its sample size supports. */
export const RateRow: React.FC<{
  readonly label: string;
  readonly rate: Rate;
  readonly colour: string;
  readonly scaleMax?: number;
  readonly delay: number;
}> = ({ label, rate, colour, scaleMax = 100, delay }) => {
  const progress = useReveal(delay);
  const toPercent = (value: number) => `${(value / scaleMax) * 100}%`;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: '190px 1fr 300px', alignItems: 'center', gap: 26 }}>
      <div style={{ fontFamily: FONT_SANS, fontSize: 30, color: COLOURS.text }}>{label}</div>
      <div style={{ position: 'relative', height: 44 }}>
        <div
          style={{
            position: 'absolute',
            top: 17,
            left: 0,
            right: 0,
            height: 10,
            borderRadius: 5,
            background: COLOURS.grid,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 17,
            left: 0,
            width: `calc(${toPercent(rate.percent)} * ${progress})`,
            height: 10,
            borderRadius: 5,
            background: colour,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 11,
            left: toPercent(rate.low),
            width: toPercent(rate.high - rate.low),
            height: 22,
            borderLeft: `2px solid ${colour}`,
            borderRight: `2px solid ${colour}`,
            borderTop: `2px solid ${colour}`,
            borderBottom: `2px solid ${colour}`,
            borderRadius: 3,
            opacity: progress * 0.42,
          }}
        />
      </div>
      <div style={{ fontFamily: FONT_MONO, fontSize: 27, color: COLOURS.text, opacity: progress }}>
        {rate.verified}/{rate.runs}
        <span style={{ color: COLOURS.muted }}>
          {'  '}
          {rate.percent.toFixed(1)}%
        </span>
        <div style={{ fontSize: 20, color: COLOURS.faint, marginTop: 4 }}>
          95% CI {rate.low.toFixed(1)}–{rate.high.toFixed(1)}
        </div>
      </div>
    </div>
  );
};

/**
 * The difference and the interval around it, on an axis with zero drawn as a
 * line rather than as a tick.
 *
 * Zero is the whole point of this component. Every claim this project makes
 * turns on whether the interval crosses that line, so the line is the most
 * prominent thing on the axis and the interval is drawn against it rather than
 * against the point estimate.
 */
export const IntervalAxis: React.FC<{
  readonly difference: Difference;
  readonly domain?: readonly [number, number];
  readonly delay: number;
  readonly caption?: string;
  /** When the reading lands, which is a beat after the interval is drawn. */
  readonly captionDelay?: number;
}> = ({ difference, domain, delay, caption, captionDelay }) => {
  const progress = useReveal(delay);
  const zeroPulse = useReveal(delay + 0.5);

  const padding = 12;
  const [min, max] = domain ?? [
    Math.min(-10, Math.floor((difference.low - padding) / 10) * 10),
    Math.max(10, Math.ceil((difference.high + padding) / 10) * 10),
  ];
  const position = (value: number) => ((value - min) / (max - min)) * 100;

  const ticks: number[] = [];
  for (let value = Math.ceil(min / 10) * 10; value <= max; value += 10) {
    ticks.push(value);
  }

  const colour = difference.includesZero ? COLOURS.caution : COLOURS.positive;

  return (
    <div style={{ width: '100%' }}>
      <div style={{ position: 'relative', height: 150 }}>
        <div
          style={{
            position: 'absolute',
            top: 74,
            left: 0,
            right: 0,
            height: 1,
            background: COLOURS.grid,
          }}
        />

        {ticks.map((tick) => (
          <div
            key={tick}
            style={{
              position: 'absolute',
              top: 84,
              left: `${position(tick)}%`,
              transform: 'translateX(-50%)',
              fontFamily: FONT_MONO,
              fontSize: 20,
              color: tick === 0 ? COLOURS.zero : COLOURS.faint,
            }}
          >
            {tick === 0 ? '0' : signed(tick)}
          </div>
        ))}

        <div
          style={{
            position: 'absolute',
            top: 68,
            left: `${position(difference.low)}%`,
            width: `${(position(difference.high) - position(difference.low)) * progress}%`,
            height: 13,
            borderRadius: 7,
            background: colour,
            opacity: 0.34,
          }}
        />
        {[difference.low, difference.high].map((value) => (
          <div
            key={value}
            style={{
              position: 'absolute',
              top: 58,
              left: `${position(value)}%`,
              width: 2,
              height: 33,
              background: colour,
              opacity: progress,
            }}
          />
        ))}

        <div
          style={{
            position: 'absolute',
            top: 62,
            left: `${position(difference.points)}%`,
            transform: 'translateX(-50%)',
            width: 25,
            height: 25,
            borderRadius: 13,
            background: colour,
            opacity: progress,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: 42,
            left: `${position(0)}%`,
            width: 3,
            marginLeft: -1,
            height: 40,
            background: COLOURS.zero,
            opacity: 0.5 + zeroPulse * 0.5,
          }}
        />

        <div
          style={{
            position: 'absolute',
            top: 18,
            left: `${position(difference.points)}%`,
            transform: 'translateX(-50%)',
            fontFamily: FONT_MONO,
            fontSize: 40,
            color: COLOURS.textStrong,
            opacity: progress,
            whiteSpace: 'nowrap',
          }}
        >
          {signed(difference.points)}
        </div>
      </div>

      <div
        style={{
          marginTop: 6,
          fontFamily: FONT_MONO,
          fontSize: 25,
          color: COLOURS.muted,
          opacity: interpolate(progress, [0.4, 1], [0, 1], { extrapolateLeft: 'clamp' }),
        }}
      >
        {signed(difference.points)} points, 95% CI {signed(difference.low)} to {signed(difference.high)}
      </div>

      {caption === undefined ? null : (
        <Reveal delay={captionDelay ?? delay + 0.9}>
          <div
            style={{
              marginTop: 20,
              fontFamily: FONT_SANS,
              fontSize: 32,
              color: difference.includesZero ? COLOURS.caution : COLOURS.positive,
            }}
          >
            {caption}
          </div>
        </Reveal>
      )}
    </div>
  );
};
