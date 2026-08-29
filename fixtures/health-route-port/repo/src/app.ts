export type Environment = Readonly<Record<string, string | undefined>>;

export interface Response {
  readonly status: number;
  readonly body: string;
}

export const HEALTH_PATH = '/healthz';

export const DEFAULT_PORT = 3000;

export function resolvePort(_env: Environment): number {
  return DEFAULT_PORT;
}

export function handle(pathname: string): Response {
  if (pathname === HEALTH_PATH) {
    return { status: 200, body: JSON.stringify({ status: 'ok' }) };
  }
  return { status: 404, body: JSON.stringify({ error: 'not found' }) };
}
