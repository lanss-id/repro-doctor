import { mkdir, writeFile, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { ReproDoctorError } from '../domain/failure.js';
import { RunIdSchema, type RunId } from '../domain/ids.js';
import { RunResultSchema, type RunResult } from '../domain/result.js';
import {
  TrajectoryEventSchema,
  serializeEvent,
  type TrajectoryEvent,
  type TrajectoryEventInput,
} from '../domain/trajectory.js';
import { redactJson, redactText } from './redact.js';
import { runsRoot } from './project-root.js';

export interface RunPaths {
  readonly runId: RunId;
  readonly runDir: string;
  readonly workspaceDir: string;
  readonly resultPath: string;
  readonly trajectoryPath: string;
  readonly patchPath: string;
  readonly verificationLogPath: string;
  readonly reportPath: string;
}

export function runPaths(runId: RunId): RunPaths {
  const runDir = path.join(runsRoot(), RunIdSchema.parse(runId));
  return {
    runId,
    runDir,
    workspaceDir: path.join(runDir, 'workspace'),
    resultPath: path.join(runDir, 'result.json'),
    trajectoryPath: path.join(runDir, 'trajectory.jsonl'),
    patchPath: path.join(runDir, 'repair.patch'),
    verificationLogPath: path.join(runDir, 'verification.log'),
    reportPath: path.join(runDir, 'report.html'),
  };
}

export async function prepareRunDirectory(runId: RunId): Promise<RunPaths> {
  const paths = runPaths(runId);
  await mkdir(paths.runDir, { recursive: true });
  return paths;
}

/**
 * Append-only JSONL writer. Every event is schema-checked and redacted before
 * it touches the disk, so a trajectory file is safe to publish.
 */
export class TrajectoryWriter {
  private seq = 0;
  private buffer: string[] = [];

  constructor(private readonly filePath: string) {}

  async append(input: TrajectoryEventInput): Promise<TrajectoryEvent> {
    const redacted = redactJson(input);
    if (typeof redacted !== 'object' || redacted === null || Array.isArray(redacted)) {
      throw new ReproDoctorError('internal-error', 'a trajectory event must be an object');
    }
    const event = TrajectoryEventSchema.parse({
      ...redacted,
      seq: this.seq,
      ts: new Date().toISOString(),
    });
    this.seq += 1;
    const line = serializeEvent(event);
    this.buffer.push(line);
    await writeFile(this.filePath, `${this.buffer.join('\n')}\n`, 'utf8');
    return event;
  }

  get count(): number {
    return this.seq;
  }
}

export async function writeRunResult(paths: RunPaths, result: RunResult): Promise<void> {
  const parsed = RunResultSchema.parse(result);
  await writeFile(paths.resultPath, `${JSON.stringify(parsed, null, 2)}\n`, 'utf8');
}

export async function writeVerificationLog(paths: RunPaths, contents: string): Promise<void> {
  await writeFile(paths.verificationLogPath, redactText(contents), 'utf8');
}

/**
 * Writes repair.patch verbatim.
 *
 * This is the one artifact that is not redacted, and it cannot be: the
 * checksum in result.json and `apply` both depend on byte equality, and a
 * redacted patch would neither match nor apply. The file therefore contains
 * whatever the repository under repair contained. Treat it as sensitive: the
 * HTML report and any published copy are generated from
 * {@link redactedPatchView} instead, and the patch text never reaches a
 * trajectory or a log.
 */
export async function writePatch(paths: RunPaths, patchText: string): Promise<void> {
  await writeFile(paths.patchPath, patchText, 'utf8');
}

/** The publishable view of a patch. Never use it for checksums or for apply. */
export function redactedPatchView(patchText: string): string {
  return redactText(patchText);
}

export async function readRunResult(runId: RunId): Promise<RunResult> {
  const paths = runPaths(runId);
  const raw = await readFile(paths.resultPath, 'utf8').catch(() => null);
  if (raw === null) {
    throw new ReproDoctorError('internal-error', `no result.json for run ${runId}`, paths.resultPath);
  }
  const parsed = RunResultSchema.safeParse(JSON.parse(raw));
  if (!parsed.success) {
    throw new ReproDoctorError(
      'internal-error',
      `result.json for run ${runId} does not match the schema`,
      parsed.error.message,
    );
  }
  return parsed.data;
}

/** All runs on disk, newest first. Unreadable directories are skipped. */
export async function listRunResults(): Promise<RunResult[]> {
  const root = runsRoot();
  const entries = await readdir(root, { withFileTypes: true }).catch(() => []);
  const results: RunResult[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const parsedId = RunIdSchema.safeParse(entry.name);
    if (!parsedId.success) continue;
    const result = await readRunResult(parsedId.data).catch(() => null);
    if (result !== null) {
      results.push(result);
    }
  }
  results.sort((a, b) => (a.startedAt < b.startedAt ? 1 : -1));
  return results;
}
