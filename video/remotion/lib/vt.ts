/**
 * A small deterministic terminal emulator, enough of one to replay the
 * asciicasts in ../../recordings.
 *
 * Deterministic is the requirement that shapes it. Remotion renders frames out
 * of order and in parallel, so the screen at frame N has to be a pure function
 * of the recording and N rather than of whatever the previous frame left
 * behind. Every call to `screenAt` starts from a blank screen and feeds it the
 * events up to that timestamp.
 *
 * It handles what the recorded sessions actually emit: SGR colour, cursor
 * motion, erase, scroll and line editing. Anything else is consumed and
 * ignored rather than printed, because a stray escape sequence rendered as
 * text is the one failure mode that would make the terminal look fake.
 */

const ESC = '\u001b';
const BEL = '\u0007';

export interface CastEvent {
  readonly time: number;
  readonly data: string;
}

export interface Cut {
  readonly at: number;
  readonly seconds: number;
}

export interface Cast {
  readonly width: number;
  readonly height: number;
  readonly duration: number;
  readonly events: readonly CastEvent[];
  /** Idle stretches removed by pipeline/trim.mjs, in recording order. */
  readonly cuts: readonly Cut[];
}

export interface Style {
  readonly fg: string | null;
  readonly bg: string | null;
  readonly bold: boolean;
  readonly dim: boolean;
  readonly italic: boolean;
  readonly underline: boolean;
  readonly inverse: boolean;
}

export interface Cell {
  readonly char: string;
  readonly style: Style;
}

export interface Run {
  readonly text: string;
  readonly style: Style;
}

const BLANK_STYLE: Style = {
  fg: null,
  bg: null,
  bold: false,
  dim: false,
  italic: false,
  underline: false,
  inverse: false,
};

const BLANK_CELL: Cell = { char: ' ', style: BLANK_STYLE };

/**
 * The sixteen ANSI slots. Chosen to sit on a near-black ground without any of
 * them vibrating: the recordings use green for the prompt, blue for node's test
 * reporter and red for failures, and all three have to stay legible when the
 * frame is scaled down.
 */
const ANSI_16 = [
  '#2c3038',
  '#e06c75',
  '#98c379',
  '#d9b06a',
  '#61a6d8',
  '#c67ac6',
  '#5bb4b0',
  '#c3c8d1',
  '#4a505c',
  '#f08d95',
  '#b4d99a',
  '#e8c98a',
  '#84c0e8',
  '#dc9adc',
  '#7fd0cc',
  '#e8edf5',
];

const CUBE_STEPS = [0, 95, 135, 175, 215, 255];

function rgb(r: number, g: number, b: number): string {
  const hex = (value: number): string => value.toString(16).padStart(2, '0');
  return `#${hex(r)}${hex(g)}${hex(b)}`;
}

function xterm256(index: number): string {
  const base = ANSI_16[index];
  if (base !== undefined) {
    return base;
  }
  if (index >= 232) {
    const level = 8 + (index - 232) * 10;
    return rgb(level, level, level);
  }
  const offset = index - 16;
  const r = CUBE_STEPS[Math.floor(offset / 36) % 6] ?? 0;
  const g = CUBE_STEPS[Math.floor(offset / 6) % 6] ?? 0;
  const b = CUBE_STEPS[offset % 6] ?? 0;
  return rgb(r, g, b);
}

/** Parses asciicast v2: a JSON header line followed by one JSON array per event. */
export function parseCast(source: string): Cast {
  const lines = source.split('\n').filter((line) => line.trim().length > 0);
  const [headerLine, ...rest] = lines;
  if (headerLine === undefined) {
    throw new Error('empty asciicast');
  }
  const header = JSON.parse(headerLine) as {
    width?: number;
    height?: number;
    cuts?: Cut[];
  };
  const events: CastEvent[] = [];
  for (const line of rest) {
    const parsed = JSON.parse(line) as [number, string, string];
    if (parsed[1] === 'o') {
      events.push({ time: parsed[0], data: parsed[2] });
    }
  }
  const last = events[events.length - 1];
  return {
    width: header.width ?? 80,
    height: header.height ?? 24,
    duration: last?.time ?? 0,
    events,
    cuts: header.cuts ?? [],
  };
}

class Screen {
  private readonly cells: Cell[][];
  private row = 0;
  private column = 0;
  private style: Style = BLANK_STYLE;
  private saved: { row: number; column: number } | null = null;

  constructor(
    private readonly cols: number,
    private readonly rows: number,
  ) {
    this.cells = Array.from({ length: rows }, () => this.blankRow());
  }

  private blankRow(): Cell[] {
    return Array.from({ length: this.cols }, () => BLANK_CELL);
  }

  rowsOut(): Cell[][] {
    return this.cells;
  }

  cursor(): { row: number; column: number } {
    return { row: this.row, column: Math.min(this.column, this.cols - 1) };
  }

  write(text: string): void {
    let index = 0;
    while (index < text.length) {
      const char = text[index] ?? '';
      if (char === ESC) {
        index = this.escape(text, index);
        continue;
      }
      index += 1;
      this.printable(char);
    }
  }

  private printable(char: string): void {
    switch (char) {
      case '\r':
        this.column = 0;
        return;
      case '\n':
        this.newline();
        return;
      case '\b':
        this.column = Math.max(0, this.column - 1);
        return;
      case '\t':
        this.column = Math.min(this.cols - 1, this.column + (8 - (this.column % 8)));
        return;
      default:
        break;
    }
    if (char < ' ') {
      return;
    }
    if (this.column >= this.cols) {
      this.column = 0;
      this.newline();
    }
    const row = this.cells[this.row];
    if (row !== undefined) {
      row[this.column] = { char, style: this.style };
    }
    this.column += 1;
  }

  private newline(): void {
    this.row += 1;
    if (this.row >= this.rows) {
      this.cells.shift();
      this.cells.push(this.blankRow());
      this.row = this.rows - 1;
    }
  }

  /** Consumes one escape sequence and returns the index just past it. */
  private escape(text: string, start: number): number {
    const next = text[start + 1];
    if (next === undefined) {
      return start + 1;
    }
    if (next === '[') {
      return this.csi(text, start);
    }
    if (next === ']') {
      // OSC, terminated by BEL or ST. Window titles, hyperlinks: nothing to draw.
      let index = start + 2;
      while (index < text.length) {
        if (text[index] === BEL) {
          return index + 1;
        }
        if (text[index] === ESC && text[index + 1] === '\\') {
          return index + 2;
        }
        index += 1;
      }
      return index;
    }
    if (next === '(' || next === ')' || next === '#') {
      return start + 3;
    }
    if (next === 'M') {
      this.row = Math.max(0, this.row - 1);
      return start + 2;
    }
    if (next === '7') {
      this.saved = { row: this.row, column: this.column };
      return start + 2;
    }
    if (next === '8') {
      this.restore();
      return start + 2;
    }
    return start + 2;
  }

  private restore(): void {
    if (this.saved !== null) {
      this.row = this.saved.row;
      this.column = this.saved.column;
    }
  }

  private csi(text: string, start: number): number {
    let index = start + 2;
    let body = '';
    while (index < text.length) {
      const char = text[index] ?? '';
      if (char >= '@' && char <= '~') {
        this.applyCsi(body, char);
        return index + 1;
      }
      body += char;
      index += 1;
    }
    return index;
  }

  private applyCsi(body: string, final: string): void {
    if (body.startsWith('?')) {
      // Private modes: cursor visibility, alternate screen, bracketed paste.
      // None of them change what is on the grid here.
      return;
    }
    const params = body.split(';').map((part) => (part === '' ? null : Number.parseInt(part, 10)));
    const at = (position: number, fallback: number): number => {
      const value = params[position];
      return value === null || value === undefined || Number.isNaN(value) ? fallback : value;
    };

    switch (final) {
      case 'm':
        this.sgr(params);
        return;
      case 'A':
        this.row = Math.max(0, this.row - at(0, 1));
        return;
      case 'B':
        this.row = Math.min(this.rows - 1, this.row + at(0, 1));
        return;
      case 'C':
        this.column = Math.min(this.cols - 1, this.column + at(0, 1));
        return;
      case 'D':
        this.column = Math.max(0, this.column - at(0, 1));
        return;
      case 'E':
        this.row = Math.min(this.rows - 1, this.row + at(0, 1));
        this.column = 0;
        return;
      case 'F':
        this.row = Math.max(0, this.row - at(0, 1));
        this.column = 0;
        return;
      case 'G':
        this.column = Math.max(0, Math.min(this.cols - 1, at(0, 1) - 1));
        return;
      case 'H':
      case 'f':
        this.row = Math.max(0, Math.min(this.rows - 1, at(0, 1) - 1));
        this.column = Math.max(0, Math.min(this.cols - 1, at(1, 1) - 1));
        return;
      case 'J':
        this.eraseDisplay(at(0, 0));
        return;
      case 'K':
        this.eraseLine(at(0, 0));
        return;
      case 'L':
        this.insertLines(at(0, 1));
        return;
      case 'M':
        this.deleteLines(at(0, 1));
        return;
      case 'P':
        this.deleteChars(at(0, 1));
        return;
      case '@':
        this.insertChars(at(0, 1));
        return;
      case 'X':
        this.eraseChars(at(0, 1));
        return;
      case 'd':
        this.row = Math.max(0, Math.min(this.rows - 1, at(0, 1) - 1));
        return;
      case 's':
        this.saved = { row: this.row, column: this.column };
        return;
      case 'u':
        this.restore();
        return;
      default:
        return;
    }
  }

  private eraseChars(count: number): void {
    const row = this.cells[this.row];
    if (row === undefined) {
      return;
    }
    for (let i = 0; i < count && this.column + i < this.cols; i += 1) {
      row[this.column + i] = BLANK_CELL;
    }
  }

  private eraseDisplay(mode: number): void {
    if (mode === 2 || mode === 3) {
      for (let r = 0; r < this.rows; r += 1) {
        this.cells[r] = this.blankRow();
      }
      return;
    }
    if (mode === 0) {
      this.eraseLine(0);
      for (let r = this.row + 1; r < this.rows; r += 1) {
        this.cells[r] = this.blankRow();
      }
      return;
    }
    this.eraseLine(1);
    for (let r = 0; r < this.row; r += 1) {
      this.cells[r] = this.blankRow();
    }
  }

  private eraseLine(mode: number): void {
    const row = this.cells[this.row];
    if (row === undefined) {
      return;
    }
    const from = mode === 0 ? this.column : 0;
    const to = mode === 1 ? this.column + 1 : this.cols;
    for (let c = from; c < to && c < this.cols; c += 1) {
      row[c] = BLANK_CELL;
    }
  }

  private insertLines(count: number): void {
    for (let i = 0; i < count; i += 1) {
      this.cells.splice(this.row, 0, this.blankRow());
      this.cells.length = this.rows;
    }
  }

  private deleteLines(count: number): void {
    for (let i = 0; i < count; i += 1) {
      this.cells.splice(this.row, 1);
      this.cells.push(this.blankRow());
    }
  }

  private deleteChars(count: number): void {
    const row = this.cells[this.row];
    if (row === undefined) {
      return;
    }
    row.splice(this.column, count);
    while (row.length < this.cols) {
      row.push(BLANK_CELL);
    }
  }

  private insertChars(count: number): void {
    const row = this.cells[this.row];
    if (row === undefined) {
      return;
    }
    for (let i = 0; i < count; i += 1) {
      row.splice(this.column, 0, BLANK_CELL);
    }
    row.length = this.cols;
  }

  private sgr(params: (number | null)[]): void {
    if (params.length === 0 || (params.length === 1 && params[0] === null)) {
      this.style = BLANK_STYLE;
      return;
    }
    let index = 0;
    while (index < params.length) {
      const code = params[index] ?? 0;
      if (code === 38 || code === 48) {
        const mode = params[index + 1];
        const isForeground = code === 38;
        if (mode === 5) {
          const colour = xterm256(params[index + 2] ?? 0);
          this.style = isForeground ? { ...this.style, fg: colour } : { ...this.style, bg: colour };
          index += 3;
          continue;
        }
        if (mode === 2) {
          const colour = rgb(params[index + 2] ?? 0, params[index + 3] ?? 0, params[index + 4] ?? 0);
          this.style = isForeground ? { ...this.style, fg: colour } : { ...this.style, bg: colour };
          index += 5;
          continue;
        }
        index += 2;
        continue;
      }
      this.style = applySimpleSgr(this.style, code);
      index += 1;
    }
  }
}

function applySimpleSgr(style: Style, code: number): Style {
  if (code === 0) {
    return BLANK_STYLE;
  }
  if (code === 1) {
    return { ...style, bold: true };
  }
  if (code === 2) {
    return { ...style, dim: true };
  }
  if (code === 3) {
    return { ...style, italic: true };
  }
  if (code === 4) {
    return { ...style, underline: true };
  }
  if (code === 7) {
    return { ...style, inverse: true };
  }
  if (code === 22) {
    return { ...style, bold: false, dim: false };
  }
  if (code === 23) {
    return { ...style, italic: false };
  }
  if (code === 24) {
    return { ...style, underline: false };
  }
  if (code === 27) {
    return { ...style, inverse: false };
  }
  if (code === 39) {
    return { ...style, fg: null };
  }
  if (code === 49) {
    return { ...style, bg: null };
  }
  if (code >= 30 && code <= 37) {
    return { ...style, fg: xterm256(code - 30) };
  }
  if (code >= 90 && code <= 97) {
    return { ...style, fg: xterm256(code - 90 + 8) };
  }
  if (code >= 40 && code <= 47) {
    return { ...style, bg: xterm256(code - 40) };
  }
  if (code >= 100 && code <= 107) {
    return { ...style, bg: xterm256(code - 100 + 8) };
  }
  return style;
}

export interface Frame {
  readonly rows: readonly (readonly Run[])[];
  readonly cursor: { readonly row: number; readonly column: number };
}

/**
 * The screen as it stood `seconds` into the recording. Pure: same input, same
 * output, no dependence on which frames were rendered before it.
 */
export function screenAt(cast: Cast, seconds: number): Frame {
  const screen = new Screen(cast.width, cast.height);
  for (const event of cast.events) {
    if (event.time > seconds) {
      break;
    }
    screen.write(event.data);
  }
  return { rows: screen.rowsOut().map(toRuns), cursor: screen.cursor() };
}

/** Collapses a row of cells into the fewest spans that still carry its styling. */
function toRuns(cells: readonly Cell[]): Run[] {
  const runs: Run[] = [];
  let current: { text: string; style: Style } | null = null;
  for (const cell of cells) {
    if (current !== null && sameStyle(current.style, cell.style)) {
      current.text += cell.char;
      continue;
    }
    if (current !== null) {
      runs.push(current);
    }
    current = { text: cell.char, style: cell.style };
  }
  if (current !== null) {
    runs.push(current);
  }
  return runs;
}

function sameStyle(a: Style, b: Style): boolean {
  return (
    a.fg === b.fg &&
    a.bg === b.bg &&
    a.bold === b.bold &&
    a.dim === b.dim &&
    a.italic === b.italic &&
    a.underline === b.underline &&
    a.inverse === b.inverse
  );
}
