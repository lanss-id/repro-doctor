import path from 'node:path';
import type { FixtureLayout } from '../domain/fixture.js';
import type { HiddenOracle } from '../oracle/verify.js';
import { numberFlag, stringFlag, type ParsedArgs } from './args.js';

export const ORACLE_FLAGS = ['oracle-dir', 'oracle-entry', 'oracle-timeout'] as const;

/**
 * The hidden oracle a command should run: the one named on the command line,
 * else the one registered for a fixture repository, else none.
 */
export function resolveOracle(args: ParsedArgs, fixture: FixtureLayout | null): HiddenOracle | null {
  const oracleDir = stringFlag(args, 'oracle-dir');
  if (oracleDir !== null) {
    return {
      id: path.basename(oracleDir),
      directory: path.resolve(oracleDir),
      entry: stringFlag(args, 'oracle-entry') ?? 'oracle.mjs',
      timeoutSeconds: numberFlag(args, 'oracle-timeout') ?? 120,
    };
  }
  if (fixture !== null) {
    return {
      id: `${fixture.meta.id}/oracle`,
      directory: fixture.oracleDir,
      entry: fixture.meta.oracle.entry,
      timeoutSeconds: fixture.meta.oracle.timeoutSeconds,
    };
  }
  return null;
}
