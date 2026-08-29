import { ReproDoctorError } from '../../domain/failure.js';
import type { FileMap } from '../fs/snapshot.js';

export const DEFAULT_CONTEXT_LINES = 3;
const MAX_DIFFABLE_LINES = 4000;
const NO_NEWLINE_MARKER = '\\ No newline at end of file';

export class PatchFormatError extends ReproDoctorError {
  constructor(message: string, detail?: string) {
    super('patch-invalid', message, detail);
    this.name = 'PatchFormatError';
  }
}

export interface DiffLine {
  readonly op: ' ' | '-' | '+';
  readonly text: string;
  /** Set when the line is the last one of its side and has no trailing newline. */
  readonly noNewline: boolean;
}

export interface Hunk {
  readonly oldStart: number;
  readonly oldLines: number;
  readonly newStart: number;
  readonly newLines: number;
  readonly lines: readonly DiffLine[];
}

export type FilePatchKind = 'added' | 'removed' | 'modified';

export interface FilePatch {
  readonly path: string;
  readonly kind: FilePatchKind;
  readonly hunks: readonly Hunk[];
}

export interface ParsedPatch {
  readonly files: readonly FilePatch[];
}

interface SplitText {
  readonly lines: readonly string[];
  readonly endsWithNewline: boolean;
}

export function splitLines(text: string): SplitText {
  if (text.length === 0) {
    return { lines: [], endsWithNewline: true };
  }
  const endsWithNewline = text.endsWith('\n');
  const body = endsWithNewline ? text.slice(0, -1) : text;
  return { lines: body.split('\n'), endsWithNewline };
}

export function joinLines(lines: readonly string[], endsWithNewline: boolean): string {
  if (lines.length === 0) {
    return '';
  }
  return lines.join('\n') + (endsWithNewline ? '\n' : '');
}

/** Longest common subsequence over lines, capped so a huge file cannot stall a run. */
function diffLines(before: readonly string[], after: readonly string[]): DiffLine[] {
  if (before.length > MAX_DIFFABLE_LINES || after.length > MAX_DIFFABLE_LINES) {
    return [
      ...before.map((text): DiffLine => ({ op: '-', text, noNewline: false })),
      ...after.map((text): DiffLine => ({ op: '+', text, noNewline: false })),
    ];
  }
  const rows = before.length;
  const columns = after.length;
  const table: Uint32Array[] = Array.from(
    { length: rows + 1 },
    () => new Uint32Array(columns + 1),
  );
  for (let i = rows - 1; i >= 0; i -= 1) {
    const row = table[i];
    const next = table[i + 1];
    if (row === undefined || next === undefined) continue;
    for (let j = columns - 1; j >= 0; j -= 1) {
      row[j] =
        before[i] === after[j]
          ? (next[j + 1] ?? 0) + 1
          : Math.max(next[j] ?? 0, row[j + 1] ?? 0);
    }
  }
  const result: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < rows && j < columns) {
    if (before[i] === after[j]) {
      result.push({ op: ' ', text: before[i] ?? '', noNewline: false });
      i += 1;
      j += 1;
      continue;
    }
    const down = table[i + 1]?.[j] ?? 0;
    const right = table[i]?.[j + 1] ?? 0;
    if (down >= right) {
      result.push({ op: '-', text: before[i] ?? '', noNewline: false });
      i += 1;
    } else {
      result.push({ op: '+', text: after[j] ?? '', noNewline: false });
      j += 1;
    }
  }
  while (i < rows) {
    result.push({ op: '-', text: before[i] ?? '', noNewline: false });
    i += 1;
  }
  while (j < columns) {
    result.push({ op: '+', text: after[j] ?? '', noNewline: false });
    j += 1;
  }
  return result;
}

function buildHunks(
  script: readonly DiffLine[],
  contextLines: number,
  beforeEndsWithNewline: boolean,
  afterEndsWithNewline: boolean,
): Hunk[] {
  const changeIndexes = script
    .map((line, index) => (line.op === ' ' ? -1 : index))
    .filter((index) => index >= 0);
  if (changeIndexes.length === 0) {
    return [];
  }

  const ranges: Array<{ start: number; end: number }> = [];
  for (const index of changeIndexes) {
    const start = Math.max(0, index - contextLines);
    const end = Math.min(script.length - 1, index + contextLines);
    const last = ranges[ranges.length - 1];
    if (last !== undefined && start <= last.end + 1) {
      last.end = Math.max(last.end, end);
    } else {
      ranges.push({ start, end });
    }
  }

  const hunks: Hunk[] = [];
  let oldLineNumber = 1;
  let newLineNumber = 1;
  let cursor = 0;
  for (const range of ranges) {
    while (cursor < range.start) {
      const line = script[cursor];
      if (line === undefined) break;
      if (line.op !== '+') oldLineNumber += 1;
      if (line.op !== '-') newLineNumber += 1;
      cursor += 1;
    }
    const lines: DiffLine[] = [];
    let oldCount = 0;
    let newCount = 0;
    const hunkOldStart = oldLineNumber;
    const hunkNewStart = newLineNumber;
    for (let index = range.start; index <= range.end; index += 1) {
      const line = script[index];
      if (line === undefined) break;
      const isLastOfOld = line.op !== '+' && isFinalOldLine(script, index);
      const isLastOfNew = line.op !== '-' && isFinalNewLine(script, index);
      const noNewline =
        (isLastOfOld && !beforeEndsWithNewline) || (isLastOfNew && !afterEndsWithNewline);
      lines.push({ op: line.op, text: line.text, noNewline });
      if (line.op !== '+') {
        oldCount += 1;
        oldLineNumber += 1;
      }
      if (line.op !== '-') {
        newCount += 1;
        newLineNumber += 1;
      }
      cursor = index + 1;
    }
    hunks.push({
      oldStart: oldCount === 0 ? hunkOldStart - 1 : hunkOldStart,
      oldLines: oldCount,
      newStart: newCount === 0 ? hunkNewStart - 1 : hunkNewStart,
      newLines: newCount,
      lines,
    });
  }
  return hunks;
}

function isFinalOldLine(script: readonly DiffLine[], index: number): boolean {
  for (let i = index + 1; i < script.length; i += 1) {
    if (script[i]?.op !== '+') return false;
  }
  return true;
}

function isFinalNewLine(script: readonly DiffLine[], index: number): boolean {
  for (let i = index + 1; i < script.length; i += 1) {
    if (script[i]?.op !== '-') return false;
  }
  return true;
}

function renderHunk(hunk: Hunk): string[] {
  const header = `@@ -${hunk.oldStart},${hunk.oldLines} +${hunk.newStart},${hunk.newLines} @@`;
  const body: string[] = [header];
  for (const line of hunk.lines) {
    body.push(`${line.op}${line.text}`);
    if (line.noNewline) {
      body.push(NO_NEWLINE_MARKER);
    }
  }
  return body;
}

/**
 * Two files can have identical lines and still differ: one ends with a newline
 * and the other does not. The line-based script sees no change there, so the
 * last line is rewritten as a delete plus an insert and the no-newline markers
 * carry the real difference.
 */
function withTrailingNewlineChange(script: DiffLine[]): DiffLine[] {
  if (script.length === 0 || script.some((line) => line.op !== ' ')) {
    return script;
  }
  const last = script[script.length - 1];
  if (last === undefined) {
    return script;
  }
  return [
    ...script.slice(0, -1),
    { op: '-', text: last.text, noNewline: false },
    { op: '+', text: last.text, noNewline: false },
  ];
}

export interface CreatePatchOptions {
  readonly contextLines?: number;
}

/**
 * Unified diff between two in-memory trees. Paths are emitted with the usual
 * `a/` and `b/` prefixes so the output is readable by `git apply` and by humans,
 * even though this project applies patches with its own applier.
 */
export function createUnifiedDiff(
  before: FileMap,
  after: FileMap,
  options: CreatePatchOptions = {},
): string {
  const contextLines = options.contextLines ?? DEFAULT_CONTEXT_LINES;
  const paths = [...new Set([...before.keys(), ...after.keys()])].sort();
  const out: string[] = [];
  for (const filePath of paths) {
    const beforeText = before.get(filePath);
    const afterText = after.get(filePath);
    if (beforeText === afterText) {
      continue;
    }
    const beforeSplit = splitLines(beforeText ?? '');
    const afterSplit = splitLines(afterText ?? '');
    const script = withTrailingNewlineChange(diffLines(beforeSplit.lines, afterSplit.lines));
    const hunks = buildHunks(
      script,
      contextLines,
      beforeText === undefined ? true : beforeSplit.endsWithNewline,
      afterText === undefined ? true : afterSplit.endsWithNewline,
    );
    if (hunks.length === 0) {
      continue;
    }
    out.push(`--- ${beforeText === undefined ? '/dev/null' : `a/${filePath}`}`);
    out.push(`+++ ${afterText === undefined ? '/dev/null' : `b/${filePath}`}`);
    for (const hunk of hunks) {
      out.push(...renderHunk(hunk));
    }
  }
  return out.length === 0 ? '' : out.join('\n') + '\n';
}

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/u;

function stripPrefix(header: string): string {
  const value = header.trim();
  if (value === '/dev/null') return value;
  if (value.startsWith('a/') || value.startsWith('b/')) {
    return value.slice(2);
  }
  return value;
}

export function parseUnifiedDiff(patchText: string): ParsedPatch {
  const lines = patchText.split('\n');
  const files: FilePatch[] = [];
  let index = 0;

  while (index < lines.length) {
    const line = lines[index];
    if (line === undefined || !line.startsWith('--- ')) {
      index += 1;
      continue;
    }
    const nextLine = lines[index + 1];
    if (nextLine === undefined || !nextLine.startsWith('+++ ')) {
      throw new PatchFormatError(`missing +++ header after line ${index + 1}`);
    }
    const oldPath = stripPrefix(line.slice(4));
    const newPath = stripPrefix(nextLine.slice(4));
    if (oldPath === '/dev/null' && newPath === '/dev/null') {
      throw new PatchFormatError('a file patch cannot have /dev/null on both sides');
    }
    const kind: FilePatchKind =
      oldPath === '/dev/null' ? 'added' : newPath === '/dev/null' ? 'removed' : 'modified';
    const filePath = kind === 'added' ? newPath : oldPath;
    if (kind === 'modified' && oldPath !== newPath) {
      throw new PatchFormatError(`renames are not supported: ${oldPath} -> ${newPath}`);
    }
    index += 2;

    const hunks: Hunk[] = [];
    while (index < lines.length) {
      const hunkLine = lines[index];
      if (hunkLine === undefined || !hunkLine.startsWith('@@')) {
        break;
      }
      const match = HUNK_HEADER.exec(hunkLine);
      if (match === null) {
        throw new PatchFormatError(`malformed hunk header: ${hunkLine}`);
      }
      const oldStart = Number(match[1]);
      const oldLines = match[2] === undefined ? 1 : Number(match[2]);
      const newStart = Number(match[3]);
      const newLines = match[4] === undefined ? 1 : Number(match[4]);
      index += 1;

      const body: DiffLine[] = [];
      let seenOld = 0;
      let seenNew = 0;
      while (index < lines.length && (seenOld < oldLines || seenNew < newLines)) {
        const raw = lines[index];
        if (raw === undefined) {
          break;
        }
        if (raw.startsWith(NO_NEWLINE_MARKER)) {
          const last = body[body.length - 1];
          if (last === undefined) {
            throw new PatchFormatError('no-newline marker without a preceding line');
          }
          body[body.length - 1] = { ...last, noNewline: true };
          index += 1;
          continue;
        }
        const op = raw.charAt(0);
        if (op !== ' ' && op !== '+' && op !== '-') {
          throw new PatchFormatError(`unexpected line inside a hunk: ${raw}`);
        }
        body.push({ op, text: raw.slice(1), noNewline: false });
        if (op !== '+') seenOld += 1;
        if (op !== '-') seenNew += 1;
        index += 1;
      }
      if (seenOld !== oldLines || seenNew !== newLines) {
        throw new PatchFormatError(
          `hunk line counts do not match its header`,
          `header=${hunkLine} countedOld=${seenOld} countedNew=${seenNew}`,
        );
      }
      // A trailing no-newline marker may follow the final counted line.
      const trailing = lines[index];
      if (trailing !== undefined && trailing.startsWith(NO_NEWLINE_MARKER)) {
        const last = body[body.length - 1];
        if (last !== undefined) {
          body[body.length - 1] = { ...last, noNewline: true };
        }
        index += 1;
      }
      hunks.push({ oldStart, oldLines, newStart, newLines, lines: body });
    }

    if (hunks.length === 0) {
      throw new PatchFormatError(`file patch for ${filePath} has no hunks`);
    }
    files.push({ path: filePath, kind, hunks });
  }

  if (files.length === 0) {
    throw new PatchFormatError('patch contains no file sections');
  }
  return { files };
}

export interface ApplyResult {
  readonly files: ReadonlyMap<string, string | null>;
  readonly changedPaths: readonly string[];
}

/**
 * Applies a parsed patch with strict context checking. Every context and
 * removed line must match the target exactly; there is no fuzz and no offset
 * search, because a silently relocated hunk is how a repair turns into damage.
 */
export function applyUnifiedDiff(current: FileMap, patch: ParsedPatch): ApplyResult {
  const result = new Map<string, string | null>();
  for (const filePatch of patch.files) {
    const existing = current.get(filePatch.path);
    if (filePatch.kind === 'added' && existing !== undefined) {
      throw new PatchFormatError(`patch adds ${filePatch.path} but the file already exists`);
    }
    if (filePatch.kind !== 'added' && existing === undefined) {
      throw new PatchFormatError(`patch modifies ${filePatch.path} but the file is missing`);
    }
    const source = splitLines(existing ?? '');
    const output: Array<{ text: string; noNewline: boolean }> = [];
    let sourceIndex = 0;

    for (const hunk of filePatch.hunks) {
      const target = hunk.oldStart === 0 ? 0 : hunk.oldStart - 1;
      if (target < sourceIndex) {
        throw new PatchFormatError(
          `hunks are out of order in ${filePatch.path}`,
          `hunk starts at ${hunk.oldStart} but ${sourceIndex} lines were already consumed`,
        );
      }
      while (sourceIndex < target) {
        const text = source.lines[sourceIndex];
        if (text === undefined) {
          throw new PatchFormatError(
            `hunk for ${filePatch.path} starts past the end of the file`,
            `line ${hunk.oldStart}`,
          );
        }
        output.push({ text, noNewline: false });
        sourceIndex += 1;
      }
      for (const line of hunk.lines) {
        if (line.op === '+') {
          output.push({ text: line.text, noNewline: line.noNewline });
          continue;
        }
        const actual = source.lines[sourceIndex];
        if (actual !== line.text) {
          throw new PatchFormatError(
            `context mismatch in ${filePatch.path} at line ${sourceIndex + 1}`,
            `expected=${JSON.stringify(line.text)} actual=${JSON.stringify(actual ?? null)}`,
          );
        }
        sourceIndex += 1;
        if (line.op === ' ') {
          output.push({ text: line.text, noNewline: line.noNewline });
        }
      }
    }

    while (sourceIndex < source.lines.length) {
      const text = source.lines[sourceIndex];
      if (text === undefined) break;
      output.push({ text, noNewline: sourceIndex === source.lines.length - 1 && !source.endsWithNewline });
      sourceIndex += 1;
    }

    if (filePatch.kind === 'removed') {
      result.set(filePatch.path, null);
      continue;
    }
    const last = output[output.length - 1];
    const endsWithNewline = last === undefined ? true : !last.noNewline;
    result.set(filePatch.path, joinLines(output.map((entry) => entry.text), endsWithNewline));
  }
  return { files: result, changedPaths: [...result.keys()] };
}

export function countPatchLines(patchText: string): { added: number; removed: number } {
  let added = 0;
  let removed = 0;
  for (const line of patchText.split('\n')) {
    if (line.startsWith('+++') || line.startsWith('---')) continue;
    if (line.startsWith('+')) added += 1;
    else if (line.startsWith('-')) removed += 1;
  }
  return { added, removed };
}
