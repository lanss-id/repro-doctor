// Reference repair for health-route-port: serve the documented route and honour
// the port the platform assigns.
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const repo = process.env.REPO_DIR ?? process.cwd();

const source = `export type Environment = Readonly<Record<string, string | undefined>>;

export interface Response {
  readonly status: number;
  readonly body: string;
}

export const HEALTH_PATH = '/health';

export const DEFAULT_PORT = 3000;

export function resolvePort(env: Environment): number {
  const raw = env['PORT'];
  if (raw === undefined || raw.trim() === '') {
    return DEFAULT_PORT;
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(\`PORT must be a positive integer, received \${raw}\`);
  }
  return port;
}

export function handle(pathname: string): Response {
  if (pathname === HEALTH_PATH) {
    return { status: 200, body: JSON.stringify({ status: 'ok' }) };
  }
  return { status: 404, body: JSON.stringify({ error: 'not found' }) };
}
`;

writeFileSync(path.join(repo, 'src/app.ts'), source, 'utf8');
