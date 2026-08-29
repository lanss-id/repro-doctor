export interface ServiceConfig {
  readonly port: number;
  readonly prefix: string;
}

export type Environment = Readonly<Record<string, string | undefined>>;

export function loadConfig(env: Environment): ServiceConfig {
  const port = Number(env['SERVICE_PORT']);
  return {
    port,
    prefix: env['REPORT_PREFIX'] ?? 'report',
  };
}
