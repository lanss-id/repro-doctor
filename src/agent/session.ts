import { mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ReproDoctorError } from '../domain/failure.js';
import type { TrajectoryWriter } from '../infra/artifacts.js';
import { assertRealPathInside, resolveWithin, toPosixRelative } from '../infra/fs/paths.js';
import type { ExecOutcome, SandboxExecutor } from '../infra/exec/types.js';
import { outcomeExitCode, summarizeOutcome } from '../infra/exec/types.js';
import { redactText } from '../infra/redact.js';
import type { Logger } from '../infra/log.js';
import type { BudgetTracker } from './budget-tracker.js';

/**
 * Largest file read_file will open. Files are served in line windows, so this
 * is a memory guard rather than a limit on what the agent can reach.
 */
export const MAX_FILE_BYTES = 1024 * 1024;
/** Lines one read returns when the caller does not ask for a window. */
export const DEFAULT_READ_LINES = 400;
/**
 * Characters of file content one window may carry. Held under
 * MAX_TOOL_OUTPUT_CHARS so the clamp below never fires on a read: a clamped
 * read drops the middle of the window without saying which lines went, which
 * is the failure this windowing exists to remove.
 */
export const MAX_READ_WINDOW_CHARS = 4600;
/** Largest anchor or replacement text one edit may carry. */
export const MAX_ANCHOR_BYTES = 8 * 1024;
export const MAX_WRITE_BYTES = 64 * 1024;
export const MAX_FILES_PER_PATCH = 20;
export const MAX_TOOL_OUTPUT_CHARS = 6000;

const FORBIDDEN_WRITE_PREFIXES: readonly string[] = ['node_modules/', '.git/'];

export interface ToolOutput {
  readonly ok: boolean;
  readonly text: string;
  /** The command's exit code for run_command; null for tools that run no process. */
  readonly exitCode: number | null;
}

/**
 * One entry of a patch attempt, as the model writes it.
 *
 * Two shapes share one schema because the tool contract the model sees has to
 * be flat: `content` writes the file whole, `find` and `replacement` swap one
 * exact block inside it. Whole-file writes are capped at MAX_WRITE_BYTES, so
 * without the second shape any fault in a file larger than that is visible and
 * unfixable. Normalisation and validation happen in normalizeProposedFile.
 */
export interface ProposedFile {
  readonly path: string;
  /** Complete new contents, or null when this entry is an anchored edit. */
  readonly content?: string | null;
  /** Exact text to replace, or null when this entry writes the file whole. */
  readonly find?: string | null;
  /** What to put in its place. Only meaningful alongside `find`. */
  readonly replacement?: string | null;
  /**
   * Which of the two shapes this entry is.
   *
   * The model has to say, because a strict tool schema makes every field
   * required and a model handed three of them fills in all three. Inferring
   * intent from which fields look populated is the harness guessing; asking is
   * one enum. Absent only for callers inside this repository, where the shape
   * is unambiguous from the fields themselves.
   */
  readonly how?: PatchShape | null;
}

export type PatchShape = 'whole' | 'replace';

export type PatchEdit =
  | { readonly kind: 'content'; readonly path: string; readonly content: string }
  | { readonly kind: 'replace'; readonly path: string; readonly find: string; readonly replacement: string };

export interface SessionOptions {
  readonly executor: SandboxExecutor;
  readonly budget: BudgetTracker;
  readonly trajectory: TrajectoryWriter;
  readonly logger: Logger;
}

type AgentToolState =
  | { readonly kind: 'unrestricted' }
  | { readonly kind: 'repairing' }
  | { readonly kind: 'awaiting-evidence' };

/**
 * The four capabilities the repair agent has, in both modes. Every entry point
 * validates paths, charges the budget, and writes a trajectory record, so no
 * action can happen off the record.
 */
export class RepairSession {
  private callCounter = 0;
  private agentToolState: AgentToolState = { kind: 'unrestricted' };

  constructor(private readonly options: SessionOptions) {}

  get workspacePath(): string {
    return this.options.executor.workspacePath;
  }

  /**
   * Advanced mode opens one bounded repair phase at a time. A successful patch
   * closes the model's tools until the harness has collected independent
   * evidence, preventing self-verification from consuming the retry budget.
   * Baseline never enters this state machine and remains unrestricted.
   */
  beginCheckpointedRepairTurn(): void {
    this.agentToolState = { kind: 'repairing' };
  }

  get agentToolsEnabled(): boolean {
    return this.agentToolState.kind !== 'awaiting-evidence';
  }

  /**
   * Appended to every model-facing tool result. The agent is told the total it
   * starts with, but only a live count lets it plan backwards from the last
   * call it can still spend on a patch. Identical in both modes: the trajectory
   * stores the raw tool output, and this line is derived from the same tracker.
   */
  budgetFooter(): string {
    return `[budget] tool calls left: ${this.options.budget.remainingToolCalls}, patch attempts left: ${this.options.budget.remainingPatchAttempts}`;
  }

  private nextCallId(tool: string): string {
    this.callCounter += 1;
    return `${tool}-${this.callCounter}`;
  }

  async listFiles(directory: string): Promise<ToolOutput> {
    const callId = this.nextCallId('list_files');
    await this.options.trajectory.append({
      type: 'tool.call',
      callId,
      tool: 'list_files',
      argsJson: JSON.stringify({ directory }),
    });
    const startedAt = Date.now();
    try {
      this.options.budget.chargeToolCall();
      const target =
        directory === '.' || directory === ''
          ? this.workspacePath
          : resolveWithin(this.workspacePath, directory);
      await assertRealPathInside(this.workspacePath, target);
      const entries = await readdir(target, { withFileTypes: true });
      const rendered = entries
        .filter((entry) => entry.name !== 'node_modules' && entry.name !== '.git')
        .map((entry) => `${entry.isDirectory() ? 'dir  ' : 'file '}${toPosixRelative(this.workspacePath, path.join(target, entry.name))}`)
        .sort()
        .join('\n');
      return await this.finish(callId, 'list_files', true, null, startedAt, rendered || '(empty directory)');
    } catch (error) {
      return await this.fail(callId, 'list_files', startedAt, error);
    }
  }

  /**
   * Reads a window of lines, and says which window it was.
   *
   * The earlier version returned the first 32KB and let the output clamp cut
   * that to a head and a tail, so a fault in the middle of a large file could
   * not be reached at all: on commander's 87,607 byte lib/command.js the agent
   * read the same opening four per cent three times and then invented a fault
   * inside the part it could see. A window the caller can move fixes that, and
   * the header says what was withheld so the model can ask for the rest.
   */
  async readFile(
    relativePath: string,
    startLine: number = 1,
    maxLines: number = DEFAULT_READ_LINES,
  ): Promise<ToolOutput> {
    const callId = this.nextCallId('read_file');
    await this.options.trajectory.append({
      type: 'tool.call',
      callId,
      tool: 'read_file',
      argsJson: JSON.stringify({ path: relativePath, startLine, maxLines }),
    });
    const startedAt = Date.now();
    try {
      this.options.budget.chargeToolCall();
      const target = resolveWithin(this.workspacePath, relativePath);
      await assertRealPathInside(this.workspacePath, target);
      const stats = await stat(target);
      if (!stats.isFile()) {
        throw new ReproDoctorError('tool-error', `not a file: ${relativePath}`);
      }
      if (stats.size > MAX_FILE_BYTES) {
        throw new ReproDoctorError(
          'tool-error',
          `file is larger than ${MAX_FILE_BYTES} bytes: ${relativePath}`,
        );
      }
      const raw = await readFile(target, 'utf8');
      // A trailing newline terminates the last line, it does not begin another
      // one. Counting the empty string after it would report every file in the
      // repository as one line longer than any editor says it is.
      const lines = raw === '' ? [] : (raw.endsWith('\n') ? raw.slice(0, -1) : raw).split('\n');
      const window = windowOf(lines, startLine, maxLines);
      return await this.finish(
        callId,
        'read_file',
        true,
        null,
        startedAt,
        renderWindow(relativePath, window),
      );
    } catch (error) {
      return await this.fail(callId, 'read_file', startedAt, error);
    }
  }

  async runCommand(command: string, args: readonly string[]): Promise<ToolOutput> {
    const callId = this.nextCallId('run_command');
    await this.options.trajectory.append({
      type: 'tool.call',
      callId,
      tool: 'run_command',
      argsJson: JSON.stringify({ command, args }),
    });
    const startedAt = Date.now();
    try {
      this.options.budget.chargeToolCall();
      const outcome = await this.options.executor.run({
        command,
        args,
        timeoutMs: this.options.budget.commandTimeoutMs(),
      });
      return await this.finish(
        callId,
        'run_command',
        outcome.kind === 'exited' && outcome.exitCode === 0,
        outcomeExitCode(outcome),
        startedAt,
        renderExecOutcome(outcome),
      );
    } catch (error) {
      return await this.fail(callId, 'run_command', startedAt, error);
    }
  }

  /**
   * Writes a set of files as one patch attempt.
   *
   * Neither shape asks the model for a hunk offset, because models are
   * unreliable at those and the run's own differ produces the patch artifact
   * afterwards. A whole-file write states the result; an anchored edit states
   * the exact text to swap, and is rejected unless that text occurs once. The
   * second shape exists because a whole-file write is capped, which left every
   * fault in a file over that cap visible and unfixable.
   */
  async proposePatch(files: readonly ProposedFile[], rationale: string): Promise<ToolOutput> {
    const callId = this.nextCallId('propose_patch');
    await this.options.trajectory.append({
      type: 'tool.call',
      callId,
      tool: 'propose_patch',
      argsJson: JSON.stringify({ files: files.map((file) => file.path), rationale }),
    });
    const startedAt = Date.now();
    try {
      this.options.budget.chargeToolCall();
      this.options.budget.chargePatchAttempt();
      if (files.length === 0) {
        throw new ReproDoctorError('patch-empty', 'a patch attempt must contain at least one file');
      }
      if (files.length > MAX_FILES_PER_PATCH) {
        throw new ReproDoctorError(
          'patch-invalid',
          `a patch attempt may touch at most ${MAX_FILES_PER_PATCH} files`,
        );
      }
      const written: string[] = [];
      for (const file of files) {
        const edit = normalizeProposedFile(file);
        const normalized = edit.path.split(path.sep).join('/');
        if (FORBIDDEN_WRITE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
          throw new ReproDoctorError('unsafe-path', `writing here is not allowed: ${edit.path}`);
        }
        const target = resolveWithin(this.workspacePath, edit.path);
        await assertRealPathInside(this.workspacePath, path.dirname(target));
        switch (edit.kind) {
          case 'content': {
            if (edit.content.length > MAX_WRITE_BYTES) {
              throw new ReproDoctorError(
                'patch-invalid',
                `file exceeds ${MAX_WRITE_BYTES} bytes: ${edit.path}. Replace one block with find and replacement instead of writing the file whole.`,
              );
            }
            await mkdir(path.dirname(target), { recursive: true });
            await assertRealPathInside(this.workspacePath, target);
            await writeFile(target, edit.content, 'utf8');
            break;
          }
          case 'replace': {
            await assertRealPathInside(this.workspacePath, target);
            const stats = await stat(target).catch(() => null);
            if (stats === null || !stats.isFile()) {
              throw new ReproDoctorError(
                'patch-invalid',
                `cannot replace text in a file that does not exist: ${edit.path}`,
              );
            }
            const current = await readFile(target, 'utf8');
            await writeFile(target, applyAnchoredEdit(current, edit), 'utf8');
            break;
          }
          default: {
            const unreachable: never = edit;
            throw new ReproDoctorError('patch-invalid', `unknown patch shape: ${JSON.stringify(unreachable)}`);
          }
        }
        written.push(toPosixRelative(this.workspacePath, target));
      }
      await this.options.trajectory.append({
        type: 'patch.attempt',
        attempt: this.options.budget.patchAttemptsUsed,
        files: written,
        accepted: true,
        note: rationale.slice(0, 500),
      });
      const checkpointed = this.agentToolState.kind === 'repairing';
      if (checkpointed) {
        this.agentToolState = { kind: 'awaiting-evidence' };
      }
      return await this.finish(
        callId,
        'propose_patch',
        true,
        null,
        startedAt,
        [
          `wrote ${written.length} file(s): ${written.join(', ')}`,
          ...(checkpointed
            ? ['checkpoint reached: stop calling tools and return the structured hypothesis ledger; the harness now runs independent evidence']
            : []),
        ].join('\n'),
      );
    } catch (error) {
      await this.options.trajectory.append({
        type: 'patch.attempt',
        attempt: Math.max(1, this.options.budget.patchAttemptsUsed),
        files: files.map((file) => file.path),
        accepted: false,
        note: error instanceof Error ? error.message : String(error),
      });
      return await this.fail(callId, 'propose_patch', startedAt, error);
    }
  }

  private async finish(
    callId: string,
    tool: string,
    ok: boolean,
    exitCode: number | null,
    startedAt: number,
    output: string,
  ): Promise<ToolOutput> {
    const text = clamp(redactText(output));
    await this.options.trajectory.append({
      type: 'tool.result',
      callId,
      tool,
      ok,
      exitCode,
      durationMs: Date.now() - startedAt,
      output: text,
    });
    this.options.logger.debug('tool.result', { tool, ok, exitCode });
    return { ok, text, exitCode };
  }

  private async fail(
    callId: string,
    tool: string,
    startedAt: number,
    error: unknown,
  ): Promise<ToolOutput> {
    if (error instanceof ReproDoctorError && error.reason === 'budget-exhausted') {
      // Budget errors stop the run; they are not fed back to the model.
      throw error;
    }
    const message = error instanceof Error ? error.message : String(error);
    return await this.finish(callId, tool, false, null, startedAt, `error: ${message}`);
  }
}

export function renderExecOutcome(outcome: ExecOutcome): string {
  if (outcome.kind === 'spawn-failed') {
    return `error: ${summarizeOutcome(outcome)}`;
  }
  const parts = [`status: ${summarizeOutcome(outcome)}`];
  if (outcome.stdout.trim().length > 0) {
    parts.push(`stdout:\n${outcome.stdout.trim()}`);
  }
  if (outcome.stderr.trim().length > 0) {
    parts.push(`stderr:\n${outcome.stderr.trim()}`);
  }
  return parts.join('\n');
}

export function clamp(text: string, limit: number = MAX_TOOL_OUTPUT_CHARS): string {
  if (text.length <= limit) {
    return text;
  }
  const head = text.slice(0, Math.floor(limit * 0.6));
  const tail = text.slice(text.length - Math.floor(limit * 0.3));
  return `${head}\n[... ${text.length - head.length - tail.length} characters omitted ...]\n${tail}`;
}

export interface FileWindow {
  readonly firstLine: number;
  /** The last line actually returned, which is not always the one asked for. */
  readonly lastLine: number;
  readonly totalLines: number;
  readonly text: string;
}

/**
 * The slice of a file one read returns.
 *
 * The window is shortened rather than the text being cut, so `lastLine` is
 * always true: whatever the character budget forces out is reported as lines
 * still below, and asking for them is one more call rather than a guess.
 */
export function windowOf(
  lines: readonly string[],
  startLine: number,
  maxLines: number,
): FileWindow {
  const totalLines = lines.length;
  if (totalLines === 0) {
    return { firstLine: 1, lastLine: 0, totalLines: 0, text: '' };
  }
  const first = Math.min(Math.max(1, Math.trunc(startLine)), totalLines);
  const requestedLast = Math.min(totalLines, first + Math.max(1, Math.trunc(maxLines)) - 1);

  const kept: string[] = [];
  let characters = 0;
  let last = first - 1;
  for (let line = first; line <= requestedLast; line += 1) {
    const text = lines[line - 1] ?? '';
    if (kept.length > 0 && characters + text.length + 1 > MAX_READ_WINDOW_CHARS) {
      break;
    }
    // One line longer than the whole budget still has to return something, or
    // a minified file would answer every window with nothing.
    kept.push(
      text.length > MAX_READ_WINDOW_CHARS
        ? `${text.slice(0, MAX_READ_WINDOW_CHARS)}[... rest of line ${line} omitted ...]`
        : text,
    );
    characters += text.length + 1;
    last = line;
  }
  return { firstLine: first, lastLine: last, totalLines, text: kept.join('\n') };
}

export function renderWindow(relativePath: string, window: FileWindow): string {
  const header = `${relativePath}: lines ${window.firstLine}-${window.lastLine} of ${window.totalLines}`;
  const parts = [header, window.text];
  if (window.lastLine < window.totalLines) {
    parts.push(
      `[more] ${window.totalLines - window.lastLine} line(s) below this window; read them with start_line=${window.lastLine + 1}`,
    );
  }
  return parts.join('\n');
}

/**
 * Decides which of the two patch shapes an entry is, and rejects the ones that
 * are neither or both.
 *
 * The model sees one flat schema and names the shape it wants, because a tool
 * schema it has to satisfy exactly is worth more than an elegant union. What is
 * missing for the named shape is rejected here, on the record, where the
 * rejection becomes a tool result the model can read and correct.
 */
export function normalizeProposedFile(file: ProposedFile): PatchEdit {
  const content = file.content ?? null;
  const find = file.find ?? null;
  const replacement = file.replacement ?? null;
  const how: PatchShape = file.how ?? (find !== null && content === null ? 'replace' : 'whole');

  switch (how) {
    case 'whole': {
      // An empty whole-file write is almost always a "replace" the model
      // described in the wrong shape, and it would delete the file's contents.
      if (content === null || content.length === 0) {
        throw new ReproDoctorError(
          'patch-invalid',
          `${file.path}: how is "whole", so content must be the complete new file`,
        );
      }
      return { kind: 'content', path: file.path, content };
    }
    case 'replace': {
      if (find === null || find.length === 0) {
        throw new ReproDoctorError(
          'patch-invalid',
          `${file.path}: how is "replace", so find must be the exact text to replace`,
        );
      }
      const swap = replacement ?? '';
      if (find.length > MAX_ANCHOR_BYTES || swap.length > MAX_ANCHOR_BYTES) {
        throw new ReproDoctorError(
          'patch-invalid',
          `${file.path}: find and replacement are limited to ${MAX_ANCHOR_BYTES} bytes each`,
        );
      }
      return { kind: 'replace', path: file.path, find, replacement: swap };
    }
    default: {
      const unreachable: never = how;
      throw new ReproDoctorError('patch-invalid', `unknown patch shape: ${String(unreachable)}`);
    }
  }
}

/**
 * Swaps one block of text, and only if there is exactly one of it.
 *
 * An anchor matching twice means the model is describing a place it has not
 * pinned down, and picking either occurrence would be the harness guessing at
 * intent. Refusing costs a patch attempt and tells it what to add.
 */
export function applyAnchoredEdit(
  current: string,
  edit: Extract<PatchEdit, { kind: 'replace' }>,
): string {
  let occurrences = 0;
  let at = current.indexOf(edit.find);
  const firstAt = at;
  while (at !== -1) {
    occurrences += 1;
    at = current.indexOf(edit.find, at + edit.find.length);
  }
  if (occurrences === 0) {
    throw new ReproDoctorError(
      'patch-invalid',
      `${edit.path}: the text to replace is not in the file. Read the lines you mean and copy them exactly`,
    );
  }
  if (occurrences > 1) {
    throw new ReproDoctorError(
      'patch-invalid',
      `${edit.path}: the text to replace appears ${occurrences} times. Include more surrounding lines so it matches once`,
    );
  }
  // Spliced by index rather than String.replace, which would read $& and $1 in
  // the replacement as backreferences into whatever the model happened to send.
  return current.slice(0, firstAt) + edit.replacement + current.slice(firstAt + edit.find.length);
}
