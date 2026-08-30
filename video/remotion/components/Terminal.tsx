import React, { useMemo } from 'react';
import { useCurrentFrame, useVideoConfig, interpolate } from 'remotion';
import { parseCast, screenAt, type Cast as ScreenCast, type Run, type Style } from '../lib/vt';
import type { Cast, Highlight } from '../lib/timeline';
import { COLOURS, FONT_MONO, FONT_SANS, MONO_ADVANCE } from '../theme';

interface TerminalProps {
  readonly cast: Cast;
  readonly title: string;
  readonly highlights?: readonly Highlight[];
  readonly fontSize?: number;
  /** Idle seconds the trim step removed, shown in the title bar. */
  readonly cutSeconds?: number;
  /** Pixels the window may occupy; the type shrinks rather than overflowing. */
  readonly maxHeight?: number;
  readonly maxWidth?: number;
}

const LINE_HEIGHT = 1.46;
/** Window chrome plus the padding around the grid. */
const CHROME_HEIGHT = 44;
const GRID_PADDING = 26;
/** Blank rows kept under the last line, so the window is not flush to the text. */
const BOTTOM_PADDING_ROWS = 1;
/** How many points across the recording are checked for the tallest screen. */
const HEIGHT_SAMPLES = 24;

/** The inlined timeline shape back into what the emulator reads. */
function toCast(cast: Cast): ScreenCast {
  return parseCast(
    [
      JSON.stringify({ version: 2, width: cast.width, height: cast.height, cuts: cast.cuts }),
      ...cast.events.map(([time, data]) => JSON.stringify([time, 'o', data])),
    ].join('\n'),
  );
}

function styleOf(style: Style): React.CSSProperties {
  const foreground = style.fg ?? COLOURS.text;
  const background = style.bg;
  return {
    color: style.inverse ? (background ?? COLOURS.background) : foreground,
    background: style.inverse ? foreground : (background ?? undefined),
    fontWeight: style.bold ? 700 : 400,
    fontStyle: style.italic ? 'italic' : undefined,
    textDecoration: style.underline ? 'underline' : undefined,
    opacity: style.dim ? 0.62 : 1,
  };
}

const lastUsedRow = (rows: readonly (readonly Run[])[]): number => {
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const line = rows[index];
    if (line !== undefined && line.some((run) => run.text.trim().length > 0)) {
      return index + 1;
    }
  }
  return 0;
};

/**
 * How tall the window has to be for this recording, in rows.
 *
 * A recorded terminal is 30 rows whether or not the session filled them, and a
 * window two thirds empty reads as a mistake. This measures the tallest the
 * content ever gets, once, and sizes the window to that: the frame is tight
 * and the window never resizes mid-scene, which would be worse than the empty
 * space it was meant to fix.
 */
const usedRowsOf = (cast: ScreenCast): number => {
  let tallest = 0;
  for (let sample = 0; sample <= HEIGHT_SAMPLES; sample += 1) {
    const seconds = (cast.duration * sample) / HEIGHT_SAMPLES;
    tallest = Math.max(tallest, lastUsedRow(screenAt(cast, seconds).rows));
  }
  return Math.min(cast.height, Math.max(6, tallest + BOTTOM_PADDING_ROWS));
};

/**
 * Where a phrase sits on the grid right now, or null while it is not on screen.
 *
 * `lineEnd` comes back with it so a label can be parked past the end of the
 * line rather than on top of whatever the box happens to be followed by.
 */
function locate(rows: readonly (readonly Run[])[], phrase: string) {
  for (const [index, runs] of rows.entries()) {
    const line = runs.map((run) => run.text).join('');
    const column = line.indexOf(phrase);
    if (column !== -1) {
      return { row: index, column, length: phrase.length, lineEnd: line.trimEnd().length };
    }
  }
  return null;
}

/**
 * A terminal window replaying a recorded session.
 *
 * The window is drawn here but nothing inside it is: every character comes from
 * the asciicast, through the emulator in ../lib/vt.ts. Highlights are the one
 * addition, and they can only box text that the recording actually printed —
 * the build refuses a phrase that is not in the cast, and this refuses to draw
 * one that has not been printed yet.
 */
export const Terminal: React.FC<TerminalProps> = ({
  cast,
  title,
  highlights = [],
  fontSize = 21,
  cutSeconds = 0,
  maxHeight = 1080,
  maxWidth = 1920,
}) => {
  const frame = useCurrentFrame();
  const { fps } = useVideoConfig();
  const seconds = frame / fps;

  const parsed = useMemo(() => toCast(cast), [cast]);
  const rows = useMemo(() => usedRowsOf(parsed), [parsed]);
  const screen = useMemo(() => screenAt(parsed, seconds), [parsed, seconds]);

  // The recording decides how many rows and columns there are, so the type
  // size is what gives: shrinking it keeps the whole session on screen, and
  // reflowing or cropping the grid would change what the recording said.
  const size = Math.min(
    fontSize,
    (maxHeight - CHROME_HEIGHT - GRID_PADDING * 2) / (rows * LINE_HEIGHT),
    (maxWidth - GRID_PADDING * 2) / (parsed.width * MONO_ADVANCE),
  );
  const charWidth = size * MONO_ADVANCE;
  const lineHeight = size * LINE_HEIGHT;
  const gridWidth = charWidth * parsed.width;
  const gridHeight = lineHeight * rows;

  const cursorVisible = seconds < parsed.duration + 0.4 && Math.floor(seconds * 2) % 2 === 0;

  const active = highlights.flatMap((highlight) => {
    if (seconds < highlight.from) {
      return [];
    }
    const at = locate(screen.rows, highlight.text);
    return at === null ? [] : [{ highlight, at }];
  });

  return (
    <div
      style={{
        background: COLOURS.panel,
        border: `1px solid ${COLOURS.panelEdge}`,
        borderRadius: 14,
        overflow: 'hidden',
        boxShadow: '0 30px 80px rgba(0,0,0,0.45)',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 10,
          padding: '12px 18px',
          borderBottom: `1px solid ${COLOURS.panelEdge}`,
          background: '#0d1116',
        }}
      >
        {[0, 1, 2].map((index) => (
          <div key={index} style={{ width: 11, height: 11, borderRadius: 6, background: '#3a4250' }} />
        ))}
        <div
          style={{
            marginLeft: 12,
            fontFamily: FONT_SANS,
            fontSize: 17,
            color: COLOURS.muted,
            letterSpacing: 0.2,
          }}
        >
          {title}
        </div>
        {cutSeconds > 0 ? (
          <div
            style={{
              marginLeft: 'auto',
              fontFamily: FONT_SANS,
              fontSize: 15,
              color: COLOURS.faint,
            }}
          >
            {`${cutSeconds.toFixed(0)}s of waiting cut · nothing sped up`}
          </div>
        ) : null}
      </div>

      <div
        style={{
          position: 'relative',
          padding: GRID_PADDING,
          width: gridWidth + GRID_PADDING * 2,
          height: gridHeight + GRID_PADDING * 2,
        }}
      >
        <div style={{ position: 'relative', width: gridWidth, height: gridHeight }}>
          {screen.rows.slice(0, rows).map((runs, rowIndex) => (
            <div
              key={rowIndex}
              style={{
                position: 'absolute',
                top: rowIndex * lineHeight,
                left: 0,
                height: lineHeight,
                lineHeight: `${lineHeight}px`,
                fontFamily: FONT_MONO,
                fontSize: size,
                whiteSpace: 'pre',
                // The recording contains the characters the source contains.
                // A ligature that renders === as one glyph is the font editing
                // the evidence.
                fontVariantLigatures: 'none',
                color: COLOURS.text,
              }}
            >
              {runs.map((run, runIndex) => (
                <span key={runIndex} style={styleOf(run.style)}>
                  {run.text}
                </span>
              ))}
            </div>
          ))}

          {cursorVisible && screen.cursor.row < rows ? (
            <div
              style={{
                position: 'absolute',
                top: screen.cursor.row * lineHeight + lineHeight * 0.12,
                left: screen.cursor.column * charWidth,
                width: charWidth,
                height: lineHeight * 0.78,
                background: COLOURS.accent,
                opacity: 0.55,
              }}
            />
          ) : null}

          {active.map(({ highlight, at }) => (
            <HighlightBox
              key={highlight.text}
              row={at.row}
              column={at.column}
              length={at.length}
              lineEnd={at.lineEnd}
              label={highlight.label}
              opacity={fade(seconds, highlight)}
              age={seconds - highlight.from}
              charWidth={charWidth}
              lineHeight={lineHeight}
              gridWidth={gridWidth}
              fontSize={size}
            />
          ))}
        </div>
      </div>
    </div>
  );
};

/** In over a quarter second, out over half a second when the hold expires. */
const fade = (seconds: number, highlight: Highlight): number => {
  const inward = interpolate(seconds - highlight.from, [0, 0.28], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  if (highlight.until === null) {
    return inward;
  }
  const outward = interpolate(seconds - highlight.until, [0, 0.5], [1, 0], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  return Math.min(inward, outward);
};

interface HighlightBoxProps {
  readonly row: number;
  readonly column: number;
  readonly length: number;
  readonly lineEnd: number;
  readonly label: string | undefined;
  readonly opacity: number;
  readonly age: number;
  readonly charWidth: number;
  readonly lineHeight: number;
  readonly gridWidth: number;
  readonly fontSize: number;
}

const HighlightBox: React.FC<HighlightBoxProps> = ({
  row,
  column,
  length,
  lineEnd,
  label,
  opacity,
  age,
  charWidth,
  lineHeight,
  gridWidth,
  fontSize,
}) => {
  const grow = interpolate(age, [0, 0.28], [0, 1], {
    extrapolateLeft: 'clamp',
    extrapolateRight: 'clamp',
  });
  const left = column * charWidth;
  const width = length * charWidth;
  const labelLeft = Math.max(left + width, lineEnd * charWidth) + 18;
  const labelFits = labelLeft + (label?.length ?? 0) * fontSize * 0.48 < gridWidth;

  if (opacity <= 0) {
    return null;
  }

  return (
    <>
      <div
        style={{
          position: 'absolute',
          top: row * lineHeight + lineHeight * 0.08,
          left: left - 5,
          width: (width + 10) * grow,
          height: lineHeight * 0.86,
          borderRadius: 5,
          border: `1.5px solid ${COLOURS.accent}`,
          background: 'rgba(120,180,230,0.12)',
          opacity,
        }}
      />
      {label === undefined ? null : (
        <div
          style={{
            position: 'absolute',
            top: labelFits
              ? row * lineHeight + lineHeight * 0.1
              : row * lineHeight + lineHeight * 1.06,
            left: labelFits ? labelLeft : left - 5,
            fontFamily: FONT_SANS,
            fontSize: fontSize * 0.78,
            color: COLOURS.accent,
            opacity,
            whiteSpace: 'nowrap',
            // A scrim, because a label that has to sit under its box lands on
            // the next line of real output.
            background: 'rgba(9,11,15,0.94)',
            padding: '2px 8px',
            borderRadius: 5,
          }}
        >
          {label}
        </div>
      )}
    </>
  );
};
