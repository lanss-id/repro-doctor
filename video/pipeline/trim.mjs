#!/usr/bin/env node
/**
 * Removes the dead air from a recording without touching what was recorded.
 *
 * The script's own note on this is "cut, do not speed up: sped-up terminal
 * output looks like a trick". So this only ever deletes whole idle stretches
 * and writes down how long each one was. Nothing is rescaled, no event is
 * dropped, and the cuts are carried in the cast header so the video can draw a
 * marker saying what was taken out.
 */
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '../..');
const RECORDINGS = path.join(ROOT, 'video/recordings');

/** An idle stretch longer than this is a wait the viewer does not need to sit through. */
const IDLE_THRESHOLD_SECONDS = 2.5;
/** What each cut stretch is replaced by, so the pause still reads as a pause. */
const CUT_TO_SECONDS = 0.7;

export function trimCast(source) {
  const lines = source.split('\n').filter((line) => line.trim().length > 0);
  const [headerLine, ...rest] = lines;
  const header = JSON.parse(headerLine);
  const events = rest.map((line) => JSON.parse(line));

  const cuts = [];
  const output = [];
  let previousTime = 0;
  let shift = 0;

  for (const event of events) {
    const [time, kind, data] = event;
    const gap = time - previousTime;
    if (gap > IDLE_THRESHOLD_SECONDS) {
      const removed = gap - CUT_TO_SECONDS;
      shift += removed;
      cuts.push({ at: Number((previousTime - (shift - removed)).toFixed(3)), seconds: Number(removed.toFixed(3)) });
    }
    previousTime = time;
    output.push([Number((time - shift).toFixed(6)), kind, data]);
  }

  const trimmedHeader = { ...header, cuts };
  const body = output.map((event) => JSON.stringify(event)).join('\n');
  return {
    text: `${JSON.stringify(trimmedHeader)}\n${body}\n`,
    cuts,
    duration: output.length === 0 ? 0 : output[output.length - 1][0],
    original: events.length === 0 ? 0 : events[events.length - 1][0],
  };
}

const names = process.argv.slice(2);
if (names.length === 0) {
  console.error('usage: trim.mjs <cast-name> [...]');
  process.exit(1);
}

for (const name of names) {
  const input = path.join(RECORDINGS, `${name}.cast`);
  const output = path.join(RECORDINGS, `${name}.trimmed.cast`);
  const result = trimCast(await readFile(input, 'utf8'));
  await writeFile(output, result.text, 'utf8');
  const removed = result.cuts.reduce((total, cut) => total + cut.seconds, 0);
  console.log(
    `${name}: ${result.original.toFixed(1)}s -> ${result.duration.toFixed(1)}s` +
      (result.cuts.length === 0
        ? ' (nothing to cut)'
        : `, ${result.cuts.length} cut(s) removing ${removed.toFixed(1)}s`),
  );
}
