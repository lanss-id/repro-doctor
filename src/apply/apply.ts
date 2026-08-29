import { mkdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { ReproDoctorError } from '../domain/failure.js';
import type { RunId } from '../domain/ids.js';
import type { RunResult } from '../domain/result.js';
import { readRunResult } from '../infra/artifacts.js';
import { applyUnifiedDiff, parseUnifiedDiff } from '../infra/diff/unified.js';
import { sha256, treeChecksum } from '../infra/fs/checksum.js';
import {
  PathSafetyError,
  assertRealPathInside,
  isEscapingSymlink,
  resolveWithin,
} from '../infra/fs/paths.js';
import { readFileMap } from '../infra/fs/snapshot.js';

export interface ApplyPreview {
  readonly result: RunResult;
  readonly patchText: string;
  readonly targetPath: string;
  readonly targetChecksum: string;
  readonly changedFiles: readonly string[];
}

export interface ApplyOutcome {
  readonly preview: ApplyPreview;
  readonly writtenFiles: readonly string[];
  readonly deletedFiles: readonly string[];
  readonly checksumAfter: string;
}

/**
 * Loads everything needed to show the operator what would change, and refuses
 * early if the target is not the tree the patch was built against.
 */
export async function prepareApply(runId: RunId, targetRepo: string): Promise<ApplyPreview> {
  const result = await readRunResult(runId);
  if (result.patch.kind === 'empty') {
    throw new ReproDoctorError('patch-empty', `run ${runId} produced no patch, so there is nothing to apply`);
  }
  const patchText = await readFile(result.artifacts.patchPath, 'utf8').catch(() => null);
  if (patchText === null || patchText.trim().length === 0) {
    throw new ReproDoctorError('patch-empty', `patch file is missing or empty: ${result.artifacts.patchPath}`);
  }
  const actualPatchHash = sha256(patchText);
  if (actualPatchHash !== result.patch.sha256) {
    throw new ReproDoctorError(
      'patch-invalid',
      'the patch file does not match the checksum recorded in result.json',
      `recorded=${result.patch.sha256} actual=${actualPatchHash}`,
    );
  }

  const targetPath = path.resolve(targetRepo);
  const stats = await stat(targetPath).catch(() => null);
  if (stats === null || !stats.isDirectory()) {
    throw new ReproDoctorError('unsafe-path', `target repository not found: ${targetPath}`);
  }
  const targetChecksum = await treeChecksum(targetPath);
  if (targetChecksum !== result.repo.treeChecksumBefore) {
    throw new ReproDoctorError(
      'patch-invalid',
      'the target repository is not in the state this patch was built against',
      `expected=${result.repo.treeChecksumBefore} actual=${targetChecksum}. Restore the tree, or re-run diagnose against its current state.`,
    );
  }

  const parsed = parseUnifiedDiff(patchText);
  return {
    result,
    patchText,
    targetPath,
    targetChecksum,
    changedFiles: parsed.files.map((file) => file.path),
  };
}

/**
 * Applies the patch. Callers must obtain human approval before calling this;
 * the CLI does that through an interactive prompt or an explicitly named flag.
 */
export async function commitApply(preview: ApplyPreview): Promise<ApplyOutcome> {
  // Time passes between the preview and the confirmation, and a human is in
  // that gap. Re-check the target before the first write, so a tree that moved
  // while the operator was reading does not get a patch built for an older one.
  const checksumNow = await treeChecksum(preview.targetPath);
  if (checksumNow !== preview.targetChecksum) {
    throw new ReproDoctorError(
      'patch-invalid',
      'the target repository changed while the patch was being reviewed',
      `reviewed=${preview.targetChecksum} now=${checksumNow}. Nothing was written. Re-run apply to see a fresh preview.`,
    );
  }

  const current = await readFileMap(preview.targetPath);
  const applied = applyUnifiedDiff(current, parseUnifiedDiff(preview.patchText));

  // Validate every destination before creating anything. A single mkdir on a
  // path that turns out to escape would already have made a directory outside
  // the target, and there is no undo for that.
  const plan: Array<{ relativePath: string; absolute: string; contents: string | null }> = [];
  for (const [relativePath, contents] of applied.files) {
    const absolute = resolveWithin(preview.targetPath, relativePath);
    await assertSafeDestination(preview.targetPath, absolute);
    plan.push({ relativePath, absolute, contents });
  }

  const written: string[] = [];
  const deleted: string[] = [];
  for (const entry of plan) {
    if (entry.contents === null) {
      await assertSafeDestination(preview.targetPath, entry.absolute);
      await rm(entry.absolute, { force: true });
      deleted.push(entry.relativePath);
      continue;
    }
    await mkdir(path.dirname(entry.absolute), { recursive: true });
    // Re-check after mkdir: the directory that now exists must still be the one
    // inside the target, and the file itself must not be a symlink out.
    await assertSafeDestination(preview.targetPath, entry.absolute);
    await writeFile(entry.absolute, entry.contents, 'utf8');
    written.push(entry.relativePath);
  }

  return {
    preview,
    writtenFiles: written,
    deletedFiles: deleted,
    checksumAfter: await treeChecksum(preview.targetPath),
  };
}

/**
 * Refuses a destination that leaves the target, before anything is created.
 *
 * The nearest existing ancestor is resolved through symlinks, so a target
 * containing `a -> /outside` cannot turn `a/new/file` into `/outside/new/file`.
 * Every path component between the root and the file is checked, which catches
 * a symlink in the middle of the path as well as at its end.
 */
async function assertSafeDestination(root: string, absolute: string): Promise<void> {
  const relative = path.relative(root, absolute);
  const segments = relative.split(path.sep).filter((segment) => segment.length > 0);
  let cursor = root;
  for (const segment of segments) {
    cursor = path.join(cursor, segment);
    if (await isEscapingSymlink(root, cursor)) {
      throw new PathSafetyError(
        `refusing to write through a symlink that leaves the repository: ${relative}`,
        `component=${path.relative(root, cursor)}`,
      );
    }
  }
  await assertRealPathInside(root, absolute);
}
