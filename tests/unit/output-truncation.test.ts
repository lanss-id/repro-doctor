import assert from 'node:assert/strict';
import test from 'node:test';
import { OutputCapture } from '../../src/infra/exec/spawn.js';

test('output that fits is kept exactly as it arrived', () => {
  const capture = new OutputCapture(50, 50);
  capture.add('short output\n');

  assert.equal(capture.toString(), 'short output\n');
});

// The old capture stopped appending at its limit, so a verbose test runner's
// verdict was never collected at all. commander's suite prints 262KB of TAP and
// names its failures in the last few lines.
test('a long stream keeps its end, where a test runner puts its verdict', () => {
  const capture = new OutputCapture(300, 300);
  for (let index = 1; index <= 2000; index += 1) {
    capture.add(`ok ${index} - a passing test\n`);
  }
  capture.add('# fail 2\nnot ok - the one that matters\n');

  const kept = capture.toString();

  assert.ok(kept.includes('not ok - the one that matters'), 'the verdict must survive');
  assert.ok(kept.startsWith('ok 1 - a passing test'), 'the start must survive too');
  assert.match(kept, /bytes of output omitted here/);
  assert.ok(kept.length < 1000);
});

test('a chunk that straddles the head boundary is not lost', () => {
  const capture = new OutputCapture(10, 10);
  capture.add('0123456789ABCDE');

  assert.equal(capture.toString(), '0123456789ABCDE');
});
