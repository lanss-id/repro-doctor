import type { ExecutorKind, SandboxProfile } from '../../domain/result.js';

export interface ReadOnlyMount {
  readonly hostPath: string;
  readonly containerPath: string;
}

export interface ExecRequest {
  readonly command: string;
  readonly args: readonly string[];
  readonly timeoutMs: number;
  /** Relative to the workspace root. */
  readonly workdir?: string;
  readonly env?: Readonly<Record<string, string>>;
  /**
   * Only the verification executor may use this. The repair executor rejects
   * any mount, which is what keeps the hidden oracle out of the agent's reach.
   */
  readonly readOnlyMounts?: readonly ReadOnlyMount[];
}

export type ExecOutcome =
  | {
      readonly kind: 'exited';
      readonly exitCode: number;
      readonly stdout: string;
      readonly stderr: string;
      readonly durationMs: number;
    }
  | {
      readonly kind: 'timed-out';
      readonly timeoutMs: number;
      readonly stdout: string;
      readonly stderr: string;
    }
  | { readonly kind: 'spawn-failed'; readonly message: string };

export interface SandboxExecutor {
  readonly kind: ExecutorKind;
  readonly profile: SandboxProfile;
  /** Absolute host path of the directory the sandbox can write to. */
  readonly workspacePath: string;
  run(request: ExecRequest): Promise<ExecOutcome>;
}

export function summarizeOutcome(outcome: ExecOutcome): string {
  switch (outcome.kind) {
    case 'exited':
      return `exit ${outcome.exitCode}`;
    case 'timed-out':
      return `timed out after ${outcome.timeoutMs} ms`;
    case 'spawn-failed':
      return `could not start: ${outcome.message}`;
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

export function outcomeExitCode(outcome: ExecOutcome): number | null {
  return outcome.kind === 'exited' ? outcome.exitCode : null;
}
