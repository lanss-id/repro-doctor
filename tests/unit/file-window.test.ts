import assert from 'node:assert/strict';
import test from 'node:test';
import {
  applyAnchoredEdit,
  normalizeProposedFile,
  renderWindow,
  windowOf,
  MAX_READ_WINDOW_CHARS,
} from '../../src/agent/session.js';

const lines = (count: number, width = 10): string[] =>
  Array.from({ length: count }, (_, index) => `${index + 1}`.padEnd(width, '.'));

test('a file that fits comes back whole, and says so', () => {
  const window = windowOf(lines(12), 1, 400);

  assert.equal(window.firstLine, 1);
  assert.equal(window.lastLine, 12);
  assert.equal(window.totalLines, 12);
  assert.equal(window.text.split('\n').length, 12);
});

test('a window can start anywhere, which is the whole point', () => {
  const window = windowOf(lines(2787), 240, 20);

  assert.equal(window.firstLine, 240);
  assert.equal(window.lastLine, 259);
  assert.match(window.text, /^240/);
});

test('a start past the end lands on the last line rather than failing', () => {
  const window = windowOf(lines(30), 9000, 10);

  assert.equal(window.firstLine, 30);
  assert.equal(window.lastLine, 30);
});

// The old read returned bytes and let the output clamp cut the middle out of
// them, so the model could not tell what it had not been shown. The window is
// allowed to be short; it is not allowed to be short quietly.
test('the character budget shortens the window instead of cutting its middle', () => {
  const wide = Array.from({ length: 400 }, () => 'x'.repeat(500));

  const window = windowOf(wide, 1, 400);

  assert.ok(window.text.length <= MAX_READ_WINDOW_CHARS + 501);
  assert.ok(window.lastLine < 400, 'the window should stop early');
  assert.equal(window.text.split('\n').length, window.lastLine - window.firstLine + 1);
});

test('one line longer than the whole budget still returns something', () => {
  const window = windowOf(['y'.repeat(MAX_READ_WINDOW_CHARS * 3)], 1, 400);

  assert.equal(window.lastLine, 1);
  assert.match(window.text, /rest of line 1 omitted/);
});

test('the rendered window names the lines it withheld and how to get them', () => {
  const rendered = renderWindow('lib/command.js', windowOf(lines(2787), 1, 400));

  assert.match(rendered, /^lib\/command\.js: lines 1-400 of 2787/);
  assert.match(rendered, /2387 line\(s\) below this window; read them with start_line=401/);
});

test('a window that reaches the end has nothing more to offer', () => {
  const rendered = renderWindow('a.ts', windowOf(lines(5), 1, 400));

  assert.doesNotMatch(rendered, /\[more\]/);
});

test('a patch entry is whole contents or one replacement, and says which it is', () => {
  assert.deepEqual(normalizeProposedFile({ path: 'a.ts', content: 'x' }), {
    kind: 'content',
    path: 'a.ts',
    content: 'x',
  });

  assert.deepEqual(normalizeProposedFile({ path: 'a.ts', find: 'old', replacement: 'new' }), {
    kind: 'replace',
    path: 'a.ts',
    find: 'old',
    replacement: 'new',
  });

  assert.throws(() => normalizeProposedFile({ path: 'a.ts', how: 'whole' }), /content must be the complete new file/);
  assert.throws(() => normalizeProposedFile({ path: 'a.ts', how: 'replace' }), /find must be the exact text/);
});

// A strict tool schema makes every field required, so a model handed content,
// find and replacement fills in all three. The first version of this rejected
// that as ambiguous, which cost a live run both of its patch attempts. The
// declared shape decides, and the fields belonging to the other one are ignored.
test('the declared shape decides, even when the other shape is filled in too', () => {
  assert.deepEqual(
    normalizeProposedFile({ path: 'a.ts', how: 'replace', content: 'whole file', find: 'old', replacement: 'new' }),
    { kind: 'replace', path: 'a.ts', find: 'old', replacement: 'new' },
  );

  assert.deepEqual(
    normalizeProposedFile({ path: 'a.ts', how: 'whole', content: 'whole file', find: 'old', replacement: 'new' }),
    { kind: 'content', path: 'a.ts', content: 'whole file' },
  );
});

test('deleting a block is a replacement with an empty string, not a missing one', () => {
  const edit = normalizeProposedFile({ path: 'a.ts', find: 'old', replacement: '' });

  assert.equal(edit.kind, 'replace');
  assert.equal(applyAnchoredEdit('keep old keep', { ...edit, kind: 'replace', find: 'old', replacement: '' }), 'keep  keep');
});

test('an anchor that matches twice is refused rather than guessed at', () => {
  const edit = { kind: 'replace', path: 'a.ts', find: 'x = 1', replacement: 'x = 2' } as const;

  assert.equal(applyAnchoredEdit('let x = 1\n', edit), 'let x = 2\n');
  assert.throws(() => applyAnchoredEdit('let x = 1\nlet x = 1\n', edit), /appears 2 times/);
  assert.throws(() => applyAnchoredEdit('nothing here\n', edit), /is not in the file/);
});

// String.replace would read these as backreferences into the match.
test('dollar signs in a replacement are text, not backreferences', () => {
  const edit = { kind: 'replace', path: 'a.ts', find: 'PRICE', replacement: '$& $1 $$' } as const;

  assert.equal(applyAnchoredEdit('cost: PRICE\n', edit), 'cost: $& $1 $$\n');
});
