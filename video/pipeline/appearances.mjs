#!/usr/bin/env node
/**
 * Prints when each phrase the edit boxes first appears in its recording.
 *
 * A helper for cutting, not part of the build: `showAt` in build.mjs has to
 * land after the text is on screen, and this is how that number is found rather
 * than guessed.
 */
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const RECORDINGS = path.resolve(HERE, '../recordings');

const stripAnsi = (text) =>
  text.replace(/\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\][^]*/g, '');

const [name, ...phrases] = process.argv.slice(2);
if (name === undefined) {
  console.error('usage: appearances.mjs <cast-name> [phrase ...]');
  process.exit(1);
}

const source = await readFile(path.join(RECORDINGS, `${name}.trimmed.cast`), 'utf8');
const events = source
  .split('\n')
  .slice(1)
  .filter((line) => line.trim().length > 0)
  .map((line) => JSON.parse(line));

console.log(`${name}: ${events[events.length - 1][0].toFixed(2)}s`);

if (phrases.length === 0) {
  console.log(stripAnsi(events.map((event) => event[2]).join('')));
  process.exit(0);
}

for (const phrase of phrases) {
  let accumulated = '';
  let at = null;
  for (const [time, , data] of events) {
    accumulated += stripAnsi(data);
    if (accumulated.includes(phrase)) {
      at = time;
      break;
    }
  }
  console.log(`  ${at === null ? 'MISSING' : `${at.toFixed(2)}s`}  ${JSON.stringify(phrase)}`);
}
