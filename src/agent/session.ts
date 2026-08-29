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

export const MAX_READ_BYTES = 32 * 1024;
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

export interface ProposedFile {
  readonly path: string;
  readonly content: string;
}

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

  async readFile(relativePath: string): Promise<ToolOutput> {
    const callId = this.nextCallId('read_file');
    await this.options.trajectory.append({
      type: 'tool.call',
      callId,
      tool: 'read_file',
      argsJson: JSON.stringify({ path: relativePath }),
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
      const buffer = await readFile(target);
      const text = buffer.subarray(0, MAX_READ_BYTES).toString('utf8');
      const suffix = buffer.length > MAX_READ_BYTES ? `\n[truncated at ${MAX_READ_BYTES} bytes]` : '';
      return await this.finish(callId, 'read_file', true, null, startedAt, text + suffix);
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
   * Writes a set of files as one patch attempt. Whole-file contents are used
   * rather than a model-authored diff: models are unreliable at hunk offsets,
   * and the run's own differ produces the patch artifact afterwards.
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
        if (file.content.length > MAX_WRITE_BYTES) {
          throw new ReproDoctorError('patch-invalid', `file exceeds ${MAX_WRITE_BYTES} bytes: ${file.path}`);
        }
        const normalized = file.path.split(path.sep).join('/');
        if (FORBIDDEN_WRITE_PREFIXES.some((prefix) => normalized.startsWith(prefix))) {
          throw new ReproDoctorError('unsafe-path', `writing here is not allowed: ${file.path}`);
        }
        const target = resolveWithin(this.workspacePath, file.path);
        await assertRealPathInside(this.workspacePath, path.dirname(target));
        await mkdir(path.dirname(target), { recursive: true });
        await assertRealPathInside(this.workspacePath, target);
        await writeFile(target, file.content, 'utf8');
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
