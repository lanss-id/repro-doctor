import { lstat, realpath } from 'node:fs/promises';
import path from 'node:path';
import { ReproDoctorError } from '../../domain/failure.js';

/** Thrown whenever a path would leave its allowed root. */
export class PathSafetyError extends ReproDoctorError {
  constructor(message: string, detail?: string) {
    super('unsafe-path', message, detail);
    this.name = 'PathSafetyError';
  }
}

const WINDOWS_DRIVE = /^[a-zA-Z]:/u;

/**
 * Resolves a caller-supplied relative path against a root and refuses anything
 * that escapes it. Absolute paths, `..` segments, NUL bytes and Windows drive
 * prefixes are all rejected before touching the filesystem.
 */
export function resolveWithin(root: string, relativePath: string): string {
  if (relativePath.includes('\0')) {
    throw new PathSafetyError('path contains a NUL byte');
  }
  if (relativePath.length === 0) {
    throw new PathSafetyError('path is empty');
  }
  if (path.isAbsolute(relativePath) || relativePath.startsWith('/') || relativePath.startsWith('\\')) {
    throw new PathSafetyError(`absolute paths are not allowed: ${relativePath}`);
  }
  if (WINDOWS_DRIVE.test(relativePath)) {
    throw new PathSafetyError(`drive-qualified paths are not allowed: ${relativePath}`);
  }
  const normalizedRoot = path.resolve(root);
  const candidate = path.resolve(normalizedRoot, relativePath);
  assertInside(normalizedRoot, candidate);
  return candidate;
}

/** Lexical containment check. Use together with {@link assertRealPathInside}. */
export function assertInside(root: string, candidate: string): void {
  const normalizedRoot = path.resolve(root);
  const normalizedCandidate = path.resolve(candidate);
  if (normalizedCandidate === normalizedRoot) {
    return;
  }
  const withSeparator = normalizedRoot.endsWith(path.sep) ? normalizedRoot : normalizedRoot + path.sep;
  if (!normalizedCandidate.startsWith(withSeparator)) {
    throw new PathSafetyError(
      `path escapes its root`,
      `root=${normalizedRoot} candidate=${normalizedCandidate}`,
    );
  }
}

export function isInside(root: string, candidate: string): boolean {
  try {
    assertInside(root, candidate);
    return true;
  } catch {
    return false;
  }
}

/**
 * Follows symlinks and checks the real destination is still inside the root.
 * Catches the `ln -s /etc/passwd inside-workspace` class of escape.
 */
export async function assertRealPathInside(root: string, candidate: string): Promise<void> {
  const realRoot = await realpath(path.resolve(root));
  let cursor = path.resolve(candidate);
  // Walk up to the nearest existing ancestor; a file about to be created has no
  // real path of its own yet.
  const missing: string[] = [];
  for (;;) {
    try {
      const real = await realpath(cursor);
      assertInside(realRoot, path.resolve(real, ...missing));
      return;
    } catch (error) {
      if (error instanceof PathSafetyError) {
        throw error;
      }
      const parent = path.dirname(cursor);
      if (parent === cursor) {
        throw new PathSafetyError(`path has no existing ancestor: ${candidate}`);
      }
      missing.unshift(path.basename(cursor));
      cursor = parent;
    }
  }
}

/** True when the entry itself is a symlink whose target leaves the root. */
export async function isEscapingSymlink(root: string, candidate: string): Promise<boolean> {
  const stats = await lstat(candidate).catch(() => null);
  if (stats === null || !stats.isSymbolicLink()) {
    return false;
  }
  try {
    const real = await realpath(candidate);
    return !isInside(await realpath(root), real);
  } catch {
    // A dangling symlink cannot be resolved, so treat it as an escape.
    return true;
  }
}

/** Normalizes a path for display and for use as a map key in reports. */
export function toPosixRelative(root: string, absolute: string): string {
  return path.relative(root, absolute).split(path.sep).join('/');
}
