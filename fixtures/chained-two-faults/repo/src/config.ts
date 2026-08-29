export type Environment = Readonly<Record<string, string | undefined>>;

export const DEFAULT_GREETING = 'hello';

export function loadGreeting(env: Environment): string {
  return env['APP_GREETING'] ?? DEFAULT_GREETING;
}
