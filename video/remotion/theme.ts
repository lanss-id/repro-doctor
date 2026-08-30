import { loadFont as loadMono } from '@remotion/google-fonts/JetBrainsMono';
import { loadFont as loadSans } from '@remotion/google-fonts/Inter';

// Two weights each, in latin only. The default pulls every weight and subset,
// which is a hundred-odd network requests per render worker for glyphs no frame
// uses.
const mono = loadMono('normal', { weights: ['400', '700'], subsets: ['latin'] });
const sans = loadSans('normal', { weights: ['400', '600'], subsets: ['latin'] });

export const FONT_MONO = `${mono.fontFamily}, "DejaVu Sans Mono", monospace`;
export const FONT_SANS = `${sans.fontFamily}, system-ui, sans-serif`;

/** JetBrains Mono advances 600 units per 1000 em, which is what positions the highlight boxes. */
export const MONO_ADVANCE = 0.6;

/**
 * Two greys and one blue, and no colour that argues with the narration.
 *
 * The section this palette is really built for is the comparison, where the
 * honest reading is "the interval includes zero". A green bar and a red bar
 * would tell the viewer a story the data does not support, so the two modes are
 * separated by weight rather than by hue, and the only saturated colour in the
 * project is reserved for the thing being pointed at.
 */
export const COLOURS = {
  background: '#0a0c10',
  panel: '#11151b',
  panelEdge: '#1d232d',
  grid: '#1a1f27',
  text: '#dce2ec',
  textStrong: '#ffffff',
  muted: '#7e8899',
  faint: '#525c6b',
  baseline: '#8b95a8',
  advanced: '#78b4e6',
  accent: '#78b4e6',
  caution: '#d8a548',
  positive: '#8cc79a',
  negative: '#d98b8b',
  zero: '#e4e9f2',
} as const;

export const SPACE = {
  frame: 84,
  /** Tighter margin for the terminal scenes, which need the height. */
  terminalFrame: 60,
  /** Kept clear at the bottom so a caption never lands on the window. */
  captionReserve: 132,
  gap: 28,
} as const;
