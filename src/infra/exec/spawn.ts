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
    let stdout = '';
    let stderr = '';
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
    }, request.timeoutMs);
    timer.unref();

    const settle = (outcome: ExecOutcome): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(outcome);
    };

    child.stdout?.on('data', (chunk: Buffer) => {
      if (stdout.length < MAX_CAPTURED_BYTES) {
        stdout += chunk.toString('utf8');
      }
    });
    child.stderr?.on('data', (chunk: Buffer) => {
      if (stderr.length < MAX_CAPTURED_BYTES) {
        stderr += chunk.toString('utf8');
      }
    });
    child.on('error', (error: Error) => {
      settle({ kind: 'spawn-failed', message: error.message });
    });
    child.on('close', (code, signal) => {
      if (timedOut) {
        settle({
          kind: 'timed-out',
          timeoutMs: request.timeoutMs,
          stdout: truncate(stdout),
          stderr: truncate(stderr),
        });
        return;
      }
      settle({
        kind: 'exited',
        exitCode: code ?? (signal === null ? 1 : 128),
        stdout: truncate(stdout),
        stderr: truncate(stderr),
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

function truncate(text: string): string {
  if (text.length <= MAX_CAPTURED_BYTES) {
    return text;
  }
  return `${text.slice(0, MAX_CAPTURED_BYTES)}\n[output truncated at ${MAX_CAPTURED_BYTES} bytes]`;
}
