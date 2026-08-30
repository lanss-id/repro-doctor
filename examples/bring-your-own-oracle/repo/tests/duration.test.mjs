import assert from 'node:assert/strict';
import test from 'node:test';
import { formatDuration, parseDuration } from '../dist/duration.js';

test('seconds are parsed', () => {
  assert.equal(parseDuration('90s'), 90_000);
});

test('minutes are parsed', () => {
  assert.equal(parseDuration('30m'), 1_800_000);
});

test('hours are parsed', () => {
  assert.equal(parseDuration('2h'), 7_200_000);
});

test('a duration renders back to a string', () => {
  assert.equal(formatDuration(5_400_000), '1h30m');
});
