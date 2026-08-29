import { redactText } from './redact.js';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export type LogFields = Readonly<Record<string, string | number | boolean | null>>;

export interface Logger {
  debug(event: string, fields?: LogFields): void;
  info(event: string, fields?: LogFields): void;
  warn(event: string, fields?: LogFields): void;
  error(event: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  readonly format: 'human' | 'json';
  readonly minLevel: LogLevel;
  readonly write: (line: string) => void;
}

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

function defaultWrite(line: string): void {
  process.stderr.write(`${line}\n`);
}

/**
 * The only logging path in the codebase. Events are named, fields are typed,
 * and every value passes through redaction before it reaches the stream.
 */
export function createLogger(options: Partial<LoggerOptions> = {}): Logger {
  const format = options.format ?? (process.env['REPRO_DOCTOR_LOG_FORMAT'] === 'json' ? 'json' : 'human');
  const minLevel = options.minLevel ?? (process.env['REPRO_DOCTOR_LOG_LEVEL'] === 'debug' ? 'debug' : 'info');
  const write = options.write ?? defaultWrite;

  function emit(level: LogLevel, bound: LogFields, event: string, fields: LogFields): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[minLevel]) {
      return;
    }
    const merged: Record<string, string | number | boolean | null> = { ...bound, ...fields };
    for (const [key, value] of Object.entries(merged)) {
      merged[key] = typeof value === 'string' ? redactText(value) : value;
    }
    if (format === 'json') {
      write(JSON.stringify({ ts: new Date().toISOString(), level, event, ...merged }));
      return;
    }
    const rendered = Object.entries(merged)
      .map(([key, value]) => `${key}=${typeof value === 'string' ? value : String(value)}`)
      .join(' ');
    write(`${level.padEnd(5)} ${event}${rendered.length > 0 ? ` ${rendered}` : ''}`);
  }

  function build(bound: LogFields): Logger {
    return {
      debug: (event, fields = {}) => emit('debug', bound, event, fields),
      info: (event, fields = {}) => emit('info', bound, event, fields),
      warn: (event, fields = {}) => emit('warn', bound, event, fields),
      error: (event, fields = {}) => emit('error', bound, event, fields),
      child: (fields) => build({ ...bound, ...fields }),
    };
  }

  return build({});
}

/** Logger that drops everything. Used by tests that assert on behaviour, not output. */
export const silentLogger: Logger = createLogger({ write: () => undefined, minLevel: 'error' });
