import { ReproDoctorError } from '../domain/failure.js';

export interface ParsedArgs {
  readonly positionals: readonly string[];
  readonly flags: ReadonlyMap<string, string | true>;
}

/**
 * Small argv parser. Supports `--flag`, `--flag value` and `--flag=value`.
 * Everything after `--` is treated as a positional, which is what makes
 * `npm run doctor -- diagnose ...` behave the same as calling the bin directly.
 */
export function parseArgv(argv: readonly string[]): ParsedArgs {
  const positionals: string[] = [];
  const flags = new Map<string, string | true>();
  let index = 0;
  while (index < argv.length) {
    const token = argv[index];
    if (token === undefined) break;
    if (!token.startsWith('--')) {
      positionals.push(token);
      index += 1;
      continue;
    }
    const body = token.slice(2);
    if (body.length === 0) {
      index += 1;
      continue;
    }
    const equals = body.indexOf('=');
    if (equals >= 0) {
      flags.set(body.slice(0, equals), body.slice(equals + 1));
      index += 1;
      continue;
    }
    const next = argv[index + 1];
    if (next === undefined || next.startsWith('--')) {
      flags.set(body, true);
      index += 1;
      continue;
    }
    flags.set(body, next);
    index += 2;
  }
  return { positionals, flags };
}

export function assertKnownFlags(args: ParsedArgs, known: readonly string[]): void {
  const unknown = [...args.flags.keys()].filter((flag) => !known.includes(flag));
  if (unknown.length > 0) {
    throw new ReproDoctorError(
      'internal-error',
      `unknown option(s): ${unknown.map((flag) => `--${flag}`).join(', ')}`,
      `known options: ${known.map((flag) => `--${flag}`).join(', ')}`,
    );
  }
}

export function stringFlag(args: ParsedArgs, name: string): string | null {
  const value = args.flags.get(name);
  if (value === undefined) return null;
  if (value === true) {
    throw new ReproDoctorError('internal-error', `--${name} needs a value`);
  }
  return value;
}

export function requiredStringFlag(args: ParsedArgs, name: string): string {
  const value = stringFlag(args, name);
  if (value === null) {
    throw new ReproDoctorError('internal-error', `--${name} is required`);
  }
  return value;
}

export function numberFlag(args: ParsedArgs, name: string): number | null {
  const value = stringFlag(args, name);
  if (value === null) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new ReproDoctorError('internal-error', `--${name} must be a number, got ${value}`);
  }
  return parsed;
}

export function booleanFlag(args: ParsedArgs, name: string): boolean {
  const value = args.flags.get(name);
  if (value === undefined) return false;
  if (value === true) return true;
  return value === 'true' || value === '1' || value === 'yes';
}
