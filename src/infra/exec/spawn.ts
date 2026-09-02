import { spawn } from 'node:child_process';
import type { ExecOutcome } from './types.js';

const MAX_CAPTURED_BYTES = 256 * 1024;

export interface SpawnRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly cwd: string;
  readonly env: Readonly<Record<string, string>>;
  readonly timeoutMs: number;
  /** Runs when the timeout fires, before the child is killed. */
  readonly onTimeout?: () => void;
}

/**
 * Shared process runner. Output is capped so a runaway build cannot fill memory,
 * and the timeout always resolves rather than leaving a dangling promise.
 */
export async function spawnCaptured(request: SpawnRequest): Promise<ExecOutcome> {
  const startedAt = Date.now();
  return await new Promise<ExecOutcome>((resolve) => {
    const stdout = new OutputCapture();
    const stderr = new OutputCapture();
    let settled = false;
    let timedOut = false;

    const child = spawn(request.command, [...request.args], {
      cwd: request.cwd,
      env: { ...request.env },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    const timer = setTimeout(() => {
      timedOut = true;
      request.onTimeout?.();
      child.kill('SIGKILL');
      // Do not wait for `close`: a descendant can inherit the pipes and keep
      // them open after the direct child is dead. The timeout is the contract,
      // so return the output captured at that boundary while cleanup continues
      // on a best-effort basis.
      settle({
        kind: 'timed-out',
        timeoutMs: request.timeoutMs,
        stdout: stdout.toString(),
        stderr: stderr.toString(),
      });
    }, request.timeoutMs);
    timer.unref();

    const settle = (outcome: ExecOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      stdout.add(chunk.toString('utf8'));
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      stderr.add(chunk.toString('utf8'));
    });
    child.on('error', (error: Error) => {
      settle({ kind: 'spawn-failed', message: error.message });
    });
    child.on('close', (code, signal) => {
      if (timedOut) {
        settle({
          kind: 'timed-out',
          timeoutMs: request.timeoutMs,
          stdout: stdout.toString(),
          stderr: stderr.toString(),
        });
        return;
      }
      settle({
        kind: 'exited',
        exitCode: code ?? (signal === null ? 1 : 128),
        stdout: stdout.toString(),
        stderr: stderr.toString(),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

/**
 * Collects a stream's output while keeping both of its ends.
 *
 * The earlier version stopped appending once it had 256KB, so for anything
 * verbose the end was never collected at all. For a test runner the end is the
 * only part that matters: commander's suite prints 262KB of TAP and names its
 * two failures in the last few lines, so the agent was handed a quarter
 * megabyte of passing tests and no verdict. A compiler puts its first error at
 * the top, so the head has to survive as well, which is why this keeps a fixed
 * head and a rolling tail rather than one or the other.
 */
export class OutputCapture {
  private head = '';
  private tail = '';
  private omitted = 0;

  constructor(
    private readonly headBytes = Math.floor(MAX_CAPTURED_BYTES * 0.55),
    private readonly tailBytes = MAX_CAPTURED_BYTES - Math.floor(MAX_CAPTURED_BYTES * 0.55),
  ) {}

  add(chunk: string): void {
    let rest = chunk;
    if (this.head.length < this.headBytes) {
      const room = this.headBytes - this.head.length;
      this.head += rest.slice(0, room);
      rest = rest.slice(room);
    }
    if (rest.length === 0) {
      return;
    }
    this.tail += rest;
    if (this.tail.length > this.tailBytes) {
      const dropped = this.tail.length - this.tailBytes;
      this.tail = this.tail.slice(dropped);
      this.omitted += dropped;
    }
  }

  toString(): string {
    if (this.omitted === 0) {
      return this.head + this.tail;
    }
    return `${this.head}\n[${this.omitted} bytes of output omitted here; the start and the end are kept]\n${this.tail}`;
  }
}
