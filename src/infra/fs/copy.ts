import { copyFile, lstat, mkdir, readdir, readlink, stat } from 'node:fs/promises';
import path from 'node:path';
import { ReproDoctorError } from '../../domain/failure.js';
import { DEFAULT_IGNORED_DIRECTORIES } from './checksum.js';
import { PathSafetyError, isInside, toPosixRelative } from './paths.js';

export interface CopyOptions {
  /** Directory names skipped anywhere in the tree. */
  readonly ignoredDirectories?: readonly string[];
  /** Refuse the copy when a file is larger than this. */
  readonly maxFileBytes?: number;
  /** Refuse the copy when the tree has more files than this. */
  readonly maxFiles?: number;
}

export interface CopyReport {
  readonly fileCount: number;
  readonly byteCount: number;
  readonly skippedSymlinks: readonly string[];
}

const DEFAULT_MAX_FILE_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_FILES = 5000;

/**
 * Copies a repository into an isolated workspace. The source is opened
 * read-only and never written to. Symlinks that resolve outside the source root
 * abort the copy; internal ones are dropped and reported, because the sandbox
 * has no use for them and they are a common escape trick.
 */
export async function copyRepositoryToWorkspace(
  source: string,
  destination: string,
  options: CopyOptions = {},
): Promise<CopyReport> {
  const ignored = options.ignoredDirectories ?? DEFAULT_IGNORED_DIRECTORIES;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;

  const sourceRoot = path.resolve(source);
  const destinationRoot = path.resolve(destination);
  const sourceStats = await stat(sourceRoot).catch(() => null);
  if (sourceStats === null || !sourceStats.isDirectory()) {
    throw new ReproDoctorError('unsafe-path', `repository path is not a directory: ${sourceRoot}`);
  }
  if (isInside(sourceRoot, destinationRoot)) {
    throw new PathSafetyError('workspace must not live inside the repository being copied');
  }

  await mkdir(destinationRoot, { recursive: true });
  const state = { fileCount: 0, byteCount: 0, skippedSymlinks: [] as string[] };
  await copyDirectory(sourceRoot, sourceRoot, destinationRoot, ignored, maxFileBytes, maxFiles, state);
  return {
    fileCount: state.fileCount,
    byteCount: state.byteCount,
    skippedSymlinks: state.skippedSymlinks,
  };
}

async function copyDirectory(
  sourceRoot: string,
  currentSource: string,
  currentDestination: string,
  ignored: readonly string[],
  maxFileBytes: number,
  maxFiles: number,
  state: { fileCount: number; byteCount: number; skippedSymlinks: string[] },
): Promise<void> {
  await mkdir(currentDestination, { recursive: true });
  const entries = await readdir(currentSource, { withFileTypes: true });
  for (const entry of entries) {
    const sourcePath = path.join(currentSource, entry.name);
    const destinationPath = path.join(currentDestination, entry.name);
    const stats = await lstat(sourcePath);

    if (stats.isSymbolicLink()) {
      const target = await readlink(sourcePath);
      const resolved = path.resolve(path.dirname(sourcePath), target);
      if (!isInside(sourceRoot, resolved)) {
        throw new PathSafetyError(
          `symlink escapes the repository root: ${toPosixRelative(sourceRoot, sourcePath)}`,
          `target=${target}`,
        );
      }
      state.skippedSymlinks.push(toPosixRelative(sourceRoot, sourcePath));
      continue;
    }

    if (stats.isDirectory()) {
      if (ignored.includes(entry.name)) {
        continue;
      }
      await copyDirectory(
        sourceRoot,
        sourcePath,
        destinationPath,
        ignored,
        maxFileBytes,
        maxFiles,
        state,
      );
      continue;
    }

    if (!stats.isFile()) {
      continue;
    }
    if (stats.size > maxFileBytes) {
      throw new ReproDoctorError(
        'unsafe-path',
        `file exceeds the copy limit of ${maxFileBytes} bytes: ${toPosixRelative(sourceRoot, sourcePath)}`,
      );
    }
    state.fileCount += 1;
    if (state.fileCount > maxFiles) {
      throw new ReproDoctorError('unsafe-path', `repository has more than ${maxFiles} files`);
    }
    state.byteCount += stats.size;
    await copyFile(sourcePath, destinationPath);
  }
}
