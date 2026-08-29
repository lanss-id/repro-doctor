import path from 'node:path';
import { rm } from 'node:fs/promises';
import type { ExecutorKind } from '../domain/result.js';
import type { VerificationOutcome } from '../domain/verification.js';
import { copyRepositoryToWorkspace } from '../infra/fs/copy.js';
import { createExecutor } from '../infra/exec/factory.js';
import type { ExecOutcome } from '../infra/exec/types.js';

export const ORACLE_CONTAINER_PATH = '/oracle';

export interface HiddenOracle {
  readonly id: string;
  readonly directory: string;
  readonly entry: string;
  readonly timeoutSeconds: number;
}

export interface VerifyRequest {
  readonly oracle: HiddenOracle;
  /** The repaired workspace. It is copied again so the oracle cannot disturb it. */
  readonly repairedWorkspace: string;
  readonly scratchDirectory: string;
  readonly executorKind: ExecutorKind;
  readonly allowLocalAdapter?: boolean;
}

export interface VerifyResult {
  readonly outcome: VerificationOutcome;
  readonly log: string;
}

/**
 * Runs the hidden semantic oracle against the repaired workspace.
 *
 * Three things make this independent of the agent: the oracle directory is
 * mounted read-only and only now, after the agent session has ended; the
 * repaired tree is copied to a fresh location so nothing the agent left running
 * can interfere; and the pass/fail signal is the oracle's exit status, not
 * anything the model said.
 */
export async function runHiddenOracle(request: VerifyRequest): Promise<VerifyResult> {
  const verifyWorkspace = path.join(request.scratchDirectory, 'verification-workspace');
  await rm(verifyWorkspace, { recursive: true, force: true });
  await copyRepositoryToWorkspace(request.repairedWorkspace, verifyWorkspace);

  const executor = await createExecutor({
    kind: request.executorKind,
    workspacePath: verifyWorkspace,
    commandTimeoutSeconds: request.oracle.timeoutSeconds,
    purpose: 'verify',
    ...(request.allowLocalAdapter === undefined ? {} : { allowLocalAdapter: request.allowLocalAdapter }),
  });

  const isDocker = executor.kind === 'docker';
  const entryPath = isDocker
    ? path.posix.join(ORACLE_CONTAINER_PATH, request.oracle.entry)
    : path.join(request.oracle.directory, request.oracle.entry);

  const startedAt = Date.now();
  const outcome = await executor.run({
    command: 'node',
    args: [entryPath],
    timeoutMs: request.oracle.timeoutSeconds * 1000,
    env: { REPO_DIR: isDocker ? '/work' : verifyWorkspace },
    ...(isDocker
      ? {
          readOnlyMounts: [
            { hostPath: request.oracle.directory, containerPath: ORACLE_CONTAINER_PATH },
          ],
        }
      : {}),
  });
  const durationMs = Date.now() - startedAt;

  const log = renderLog(request, outcome, durationMs);
  return { outcome: toVerificationOutcome(outcome, durationMs, request), log };
}

const CHECK_LINE = /^\[oracle\]\s+(PASS|FAIL)\s+(.+)$/u;

export function parseChecks(output: string): string[] {
  const checks: string[] = [];
  for (const line of output.split('\n')) {
    const match = CHECK_LINE.exec(line.trim());
    if (match !== null) {
      checks.push(`${match[1]} ${match[2]}`);
    }
  }
  return checks;
}

function toVerificationOutcome(
  outcome: ExecOutcome,
  durationMs: number,
  request: VerifyRequest,
): VerificationOutcome {
  switch (outcome.kind) {
    case 'timed-out':
      return { kind: 'timed-out', timeoutMs: request.oracle.timeoutSeconds * 1000 };
    case 'spawn-failed':
      return { kind: 'oracle-error', message: outcome.message };
    case 'exited': {
      const checks = parseChecks(`${outcome.stdout}\n${outcome.stderr}`);
      if (outcome.exitCode === 0) {
        return { kind: 'passed', exitCode: 0, durationMs, checks };
      }
      return { kind: 'failed', exitCode: outcome.exitCode, durationMs, checks };
    }
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

function renderLog(request: VerifyRequest, outcome: ExecOutcome, durationMs: number): string {
  const header = [
    `oracle id: ${request.oracle.id}`,
    `oracle entry: ${request.oracle.entry}`,
    `executor: ${request.executorKind}`,
    `timeout: ${request.oracle.timeoutSeconds}s`,
    `duration: ${durationMs}ms`,
    `note: the oracle directory is never mounted while the repair agent is running`,
  ].join('\n');
  if (outcome.kind === 'spawn-failed') {
    return `${header}\nresult: could not start the oracle\n${outcome.message}\n`;
  }
  if (outcome.kind === 'timed-out') {
    return `${header}\nresult: timed out\n--- stdout ---\n${outcome.stdout}\n--- stderr ---\n${outcome.stderr}\n`;
  }
  return [
    header,
    `exit code: ${outcome.exitCode}`,
    '--- stdout ---',
    outcome.stdout,
    '--- stderr ---',
    outcome.stderr,
    '',
  ].join('\n');
}
