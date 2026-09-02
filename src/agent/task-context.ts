import { readFile, stat } from 'node:fs/promises';
import { ReproDoctorError } from '../domain/failure.js';
import { assertRealPathInside, resolveWithin, toPosixRelative } from '../infra/fs/paths.js';
import { redactText } from '../infra/redact.js';

export interface TaskContext {
  readonly relativePath: string;
  readonly content: string;
}

const MAX_TASK_FILE_BYTES = 16 * 1024;

/** Load an explicit repository-local task without exposing paths or secrets outside the target. */
export async function loadTaskContext(
  workspaceRoot: string,
  relativePath: string,
): Promise<TaskContext> {
  const target = resolveWithin(workspaceRoot, relativePath);
  await assertRealPathInside(workspaceRoot, target);
  const stats = await stat(target).catch(() => null);
  if (stats === null || !stats.isFile()) {
    throw new ReproDoctorError('unsafe-path', `task file is not a regular file: ${relativePath}`);
  }
  if (stats.size > MAX_TASK_FILE_BYTES) {
    throw new ReproDoctorError(
      'unsafe-path',
      `task file exceeds ${MAX_TASK_FILE_BYTES} bytes: ${relativePath}`,
    );
  }
  return {
    relativePath: toPosixRelative(workspaceRoot, target),
    content: redactText(await readFile(target, 'utf8')),
  };
}
