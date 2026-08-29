import { readFile, readdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import { DEFAULT_IGNORED_DIRECTORIES } from './checksum.js';
import { toPosixRelative } from './paths.js';

/** Relative POSIX path to file contents. Only text files are captured. */
export type FileMap = ReadonlyMap<string, string>;

const MAX_SNAPSHOT_FILE_BYTES = 512 * 1024;

/**
 * Reads a tree into memory so two states can be diffed without shelling out to
 * git. Binary files are skipped: the repair patch format is text-only.
 */
export async function readFileMap(
  root: string,
  ignored: readonly string[] = DEFAULT_IGNORED_DIRECTORIES,
): Promise<FileMap> {
  const files = new Map<string, string>();
  await walk(root, root, ignored, files);
  return files;
}

export function isProbablyBinary(buffer: Buffer): boolean {
  const sample = buffer.subarray(0, 8000);
  return sample.includes(0);
}

async function walk(
  root: string,
  current: string,
  ignored: readonly string[],
  out: Map<string, string>,
): Promise<void> {
  const entries = await readdir(current, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      if (ignored.includes(entry.name)) {
        continue;
      }
      await walk(root, path.join(current, entry.name), ignored, out);
      continue;
    }
    const absolute = path.join(current, entry.name);
    const stats = await lstat(absolute);
    if (!stats.isFile() || stats.size > MAX_SNAPSHOT_FILE_BYTES) {
      continue;
    }
    const buffer = await readFile(absolute);
    if (isProbablyBinary(buffer)) {
      continue;
    }
    out.set(toPosixRelative(root, absolute), buffer.toString('utf8'));
  }
}
