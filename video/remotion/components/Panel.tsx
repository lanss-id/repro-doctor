import React from 'react';
import { COLOURS, FONT_MONO, FONT_SANS } from '../theme';
import { Reveal } from './Interval';

/**
 * The frame every data slide sits in.
 *
 * `source` is not decoration. Each panel names the committed artifact its
 * numbers were computed from, so a viewer who wants to check one knows which
 * file to open, and so that a panel with nothing behind it cannot be built.
 */
export const Panel: React.FC<{
  readonly title: string;
  readonly subtitle?: string;
  readonly source: string;
  readonly sourceDelay?: number;
  readonly children: React.ReactNode;
}> = ({ title, subtitle, source, sourceDelay = 1.4, children }) => (
  <div
    style={{
      width: '100%',
      height: '100%',
      display: 'flex',
      flexDirection: 'column',
      justifyContent: 'center',
      gap: 34,
    }}
  >
    <Reveal delay={0}>
      <div>
        <div
          style={{
            fontFamily: FONT_SANS,
            fontSize: 44,
            color: COLOURS.textStrong,
            letterSpacing: -0.4,
          }}
        >
          {title}
        </div>
        {subtitle === undefined ? null : (
          <div style={{ fontFamily: FONT_SANS, fontSize: 28, color: COLOURS.muted, marginTop: 10 }}>
            {subtitle}
          </div>
        )}
      </div>
    </Reveal>

    <div style={{ display: 'flex', flexDirection: 'column', gap: 26 }}>{children}</div>

    <Reveal delay={sourceDelay}>
      <div style={{ fontFamily: FONT_MONO, fontSize: 18, color: COLOURS.faint }}>{source}</div>
    </Reveal>
  </div>
);
