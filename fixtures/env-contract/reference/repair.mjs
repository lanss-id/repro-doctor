// Reference repair for env-contract: read the documented variable and reject an
// environment that does not satisfy the contract.
import { writeFileSync } from 'node:fs';
import path from 'node:path';

const repo = process.env.REPO_DIR ?? process.cwd();

const source = `export interface ServiceConfig {
  readonly port: number;
  readonly prefix: string;
}

export type Environment = Readonly<Record<string, string | undefined>>;

export function loadConfig(env: Environment): ServiceConfig {
  const raw = env['PORT'];
  if (raw === undefined || raw.trim() === '') {
    throw new Error('PORT is required');
  }
  const port = Number(raw);
  if (!Number.isInteger(port) || port <= 0) {
    throw new Error(\`PORT must be a positive integer, received \${raw}\`);
  }
  return {
    port,
    prefix: env['REPORT_PREFIX'] ?? 'report',
  };
}
`;

writeFileSync(path.join(repo, 'src/config.ts'), source, 'utf8');
