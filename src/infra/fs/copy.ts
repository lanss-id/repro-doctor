import { copyFile, lstat, mkdir, readdir, readlink, realpath, stat, symlink } from 'node:fs/promises';
import path from 'node:path';
import { ReproDoctorError } from '../../domain/failure.js';
import { PathSafetyError, isInside, toPosixRelative } from './paths.js';

export interface CopyOptions {
  /** Custom directory names skipped anywhere in the tree. Replaces the default policy. */
  readonly ignoredDirectories?: readonly string[];
  /** Refuse the copy when a file is larger than this. */
  readonly maxFileBytes?: number;
  /** Refuse the copy when the tree has more files than this. */
  readonly maxFiles?: number;
  /** Refuse the copy when the tree is larger than this in total. */
  readonly maxTotalBytes?: number;
}

export interface CopyReport {
  readonly fileCount: number;
  readonly byteCount: number;
  readonly skippedSymlinks: readonly string[];
}

/**
 * Root directories skipped by the default copy policy, which is deliberately
 * not what the checksum skips. Nested `.git` directories are also skipped.
 *
 * `node_modules` is absent from this list on purpose. The sandbox has no
 * network, so a repository whose dependencies were left behind cannot run its
 * own check, and the agent spends its budget on failed installs rather than on
 * the fault. commander's suite passes with its dependencies and fails without
 * them, which is the whole difference between a repaired run and a confused
 * one. Generated names such as `dist` are skipped only at the repository root:
 * the same names inside `node_modules` often contain executable package code.
 * The checksum still ignores dependencies and root generated output: neither
 * is part of what a repair may claim to have changed.
 */
export const COPY_IGNORED_DIRECTORIES: readonly string[] = ['.git', 'dist', '.cache', 'artifacts'];

const DEFAULT_MAX_FILE_BYTES = 16 * 1024 * 1024;
const DEFAULT_MAX_FILES = 20000;
/** A ceiling on the whole tree, which is the resource the per-file cap was standing in for. */
const DEFAULT_MAX_TOTAL_BYTES = 512 * 1024 * 1024;

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
  const ignored = options.ignoredDirectories ?? COPY_IGNORED_DIRECTORIES;
  const usesDefaultIgnorePolicy = options.ignoredDirectories === undefined;
  const maxFileBytes = options.maxFileBytes ?? DEFAULT_MAX_FILE_BYTES;
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_FILES;
  const maxTotalBytes = options.maxTotalBytes ?? DEFAULT_MAX_TOTAL_BYTES;

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
  await copyDirectory(
    sourceRoot,
    sourceRoot,
    destinationRoot,
    ignored,
    usesDefaultIgnorePolicy,
    maxFileBytes,
    maxFiles,
    state,
  );
  if (state.byteCount > maxTotalBytes) {
    throw new ReproDoctorError(
      'unsafe-path',
      `repository is larger than ${maxTotalBytes} bytes: ${sourceRoot}`,
    );
  }
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
  usesDefaultIgnorePolicy: boolean,
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
      // Lexical containment first, then the real one: a chain of links can end
      // up outside a root that each single hop appears to respect.
      const real = await realpath(sourcePath).catch(() => null);
      if (!isInside(sourceRoot, resolved) || (real !== null && !isInside(sourceRoot, real))) {
        throw new PathSafetyError(
          `symlink escapes the repository root: ${toPosixRelative(sourceRoot, sourcePath)}`,
          `target=${target}`,
        );
      }
      // A relative link that stays inside the tree is part of the repository:
      // commander's own suite has two tests that resolve an executable
      // subcommand through one, and they failed in the sandbox for no reason
      // but this. An absolute one is still dropped, because recreating it
      // verbatim would point the workspace back at the source repository.
      if (path.isAbsolute(target)) {
        state.skippedSymlinks.push(toPosixRelative(sourceRoot, sourcePath));
        continue;
      }
      await symlink(target, destinationPath);
      continue;
    }

    if (stats.isDirectory()) {
      const isIgnored = usesDefaultIgnorePolicy
        ? entry.name === '.git' || (currentSource === sourceRoot && ignored.includes(entry.name))
        : ignored.includes(entry.name);
      if (isIgnored) {
        continue;
      }
      await copyDirectory(
        sourceRoot,
        sourcePath,
        destinationPath,
        ignored,
        usesDefaultIgnorePolicy,
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
