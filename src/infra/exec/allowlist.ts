import { ReproDoctorError } from '../../domain/failure.js';

/**
 * Commands the sandbox will start. The container is disposable and has no
 * network, but an allowlist still keeps a confused model from reaching for
 * package installs from the internet or for a shell it can hide work in.
 */
export const ALLOWED_COMMANDS: readonly string[] = [
  'node',
  'npm',
  'npx',
  'tsc',
  'ls',
  'cat',
  'head',
  'tail',
  'grep',
  'find',
  'wc',
  'diff',
  'pwd',
  'mkdir',
  'cp',
  'mv',
  'rm',
  'touch',
  'true',
  'false',
];

export function assertAllowedCommand(command: string): void {
  if (!ALLOWED_COMMANDS.includes(command)) {
    throw new ReproDoctorError(
      'tool-error',
      `command is not allowed in the sandbox: ${command}`,
      `allowed=${ALLOWED_COMMANDS.join(',')}`,
    );
  }
}

export function isAllowedCommand(command: string): boolean {
  return ALLOWED_COMMANDS.includes(command);
}
