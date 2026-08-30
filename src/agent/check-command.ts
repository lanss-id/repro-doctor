import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { z } from 'zod';

export const PackageManifestSchema = z
  .object({
    name: z.string().optional(),
    version: z.string().optional(),
    type: z.enum(['module', 'commonjs']).optional(),
    main: z.string().optional(),
    scripts: z.record(z.string(), z.string()).optional(),
    dependencies: z.record(z.string(), z.string()).optional(),
    devDependencies: z.record(z.string(), z.string()).optional(),
  })
  .loose();
export type PackageManifest = z.infer<typeof PackageManifestSchema>;

export interface CheckCommand {
  readonly command: string;
  readonly args: readonly string[];
  readonly label: string;
  readonly source: 'explicit' | 'script:check' | 'script:build' | 'script:test' | 'fallback';
}

/**
 * Splits an explicit check command on whitespace. Deliberately not a shell:
 * the sandbox runs an argv, so a command with pipes or redirection has to be
 * put in a script the repository owns rather than smuggled through here.
 */
export function parseCheckCommand(text: string): CheckCommand | null {
  const parts = text.trim().split(/\s+/u).filter((part) => part.length > 0);
  const [command, ...args] = parts;
  if (command === undefined) {
    return null;
  }
  return { command, args, label: parts.join(' '), source: 'explicit' };
}

/**
 * The repository's own way of saying whether it works. Used by the advanced
 * evidence gate, which re-runs it under harness control rather than trusting
 * the agent's summary of what happened.
 */
export function checkCommandFor(
  manifest: PackageManifest | null,
  explicit: CheckCommand | null = null,
): CheckCommand {
  // A repository's own `check` script is a good default and a bad assumption.
  // commander's runs lint and formatting, which say nothing about whether the
  // library works and everything about whether its devDependencies are
  // installed. The caller who knows the repository gets the last word.
  if (explicit !== null) {
    return explicit;
  }
  const scripts = manifest?.scripts ?? {};
  if (typeof scripts['check'] === 'string') {
    return { command: 'npm', args: ['run', 'check', '--silent'], label: 'npm run check', source: 'script:check' };
  }
  if (typeof scripts['build'] === 'string') {
    return { command: 'npm', args: ['run', 'build', '--silent'], label: 'npm run build', source: 'script:build' };
  }
  if (typeof scripts['test'] === 'string') {
    return { command: 'npm', args: ['test', '--silent'], label: 'npm test', source: 'script:test' };
  }
  return { command: 'npx', args: ['tsc', '--noEmit'], label: 'npx tsc --noEmit', source: 'fallback' };
}

export async function readManifest(workspacePath: string): Promise<PackageManifest | null> {
  const raw = await readFile(path.join(workspacePath, 'package.json'), 'utf8').catch(() => null);
  if (raw === null) {
    return null;
  }
  try {
    const parsed = PackageManifestSchema.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}
