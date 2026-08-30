const UNIT_MS: Readonly<Record<string, number>> = {
  h: 3_600_000,
  m: 60_000,
  s: 1_000,
};

const PAIR = /(\d+)(h|m|s)/u;

/**
 * Parses a duration written as number and unit pairs, for example "90s" or
 * "1h30m", and returns milliseconds.
 */
export function parseDuration(input: string): number {
  const match = PAIR.exec(input);
  if (match === null) {
    throw new Error(`not a duration: ${JSON.stringify(input)}`);
  }
  const amount = Number(match[1]);
  const unit = UNIT_MS[match[2] ?? ''];
  if (unit === undefined) {
    throw new Error(`not a duration: ${JSON.stringify(input)}`);
  }
  return amount * unit;
}

/** Renders whole hours, minutes and seconds. Used in log lines. */
export function formatDuration(milliseconds: number): string {
  const hours = Math.floor(milliseconds / UNIT_MS['h']!);
  const minutes = Math.floor((milliseconds % UNIT_MS['h']!) / UNIT_MS['m']!);
  const seconds = Math.floor((milliseconds % UNIT_MS['m']!) / UNIT_MS['s']!);
  return [
    hours > 0 ? `${hours}h` : '',
    minutes > 0 ? `${minutes}m` : '',
    seconds > 0 ? `${seconds}s` : '',
  ].join('') || '0s';
}
