import assert from 'node:assert/strict';
import test from 'node:test';
import {
  PatchFormatError,
  applyUnifiedDiff,
  countPatchLines,
  createUnifiedDiff,
  parseUnifiedDiff,
  splitLines,
} from '../../src/infra/diff/unified.js';
import type { FileMap } from '../../src/infra/fs/snapshot.js';

function fileMap(entries: Record<string, string>): FileMap {
  return new Map(Object.entries(entries));
}

function roundTrip(before: Record<string, string>, after: Record<string, string>): void {
  const patch = createUnifiedDiff(fileMap(before), fileMap(after));
  const applied = applyUnifiedDiff(fileMap(before), parseUnifiedDiff(patch));
  const result: Record<string, string> = { ...before };
  for (const [file, contents] of applied.files) {
    if (contents === null) {
      delete result[file];
    } else {
      result[file] = contents;
    }
  }
  assert.deepEqual(result, after);
}

test('splitLines round-trips with and without a trailing newline', () => {
  assert.deepEqual(splitLines('a\nb\n'), { lines: ['a', 'b'], endsWithNewline: true });
  assert.deepEqual(splitLines('a\nb'), { lines: ['a', 'b'], endsWithNewline: false });
  assert.deepEqual(splitLines(''), { lines: [], endsWithNewline: true });
});

test('identical trees produce an empty patch', () => {
  assert.equal(createUnifiedDiff(fileMap({ 'a.txt': 'x\n' }), fileMap({ 'a.txt': 'x\n' })), '');
});

test('a one-line edit round-trips', () => {
  roundTrip({ 'src/a.ts': 'const a = 1;\nconst b = 2;\nconst c = 3;\n' }, { 'src/a.ts': 'const a = 1;\nconst b = 9;\nconst c = 3;\n' });
});

test('adding and removing files round-trips', () => {
  roundTrip({ 'keep.txt': 'same\n', 'gone.txt': 'bye\n' }, { 'keep.txt': 'same\n', 'new.txt': 'hi\n' });
});

test('a file with no trailing newline round-trips', () => {
  roundTrip({ 'a.txt': 'one\ntwo' }, { 'a.txt': 'one\nthree' });
  roundTrip({ 'a.txt': 'one\ntwo\n' }, { 'a.txt': 'one\ntwo' });
  roundTrip({ 'a.txt': 'one\ntwo' }, { 'a.txt': 'one\ntwo\n' });
});

test('multiple distant edits become separate hunks and still round-trip', () => {
  const before = Array.from({ length: 40 }, (_, index) => `line ${index}`).join('\n') + '\n';
  const afterLines = before.split('\n');
  afterLines[2] = 'line two changed';
  afterLines[30] = 'line thirty changed';
  const after = afterLines.join('\n');
  const patch = createUnifiedDiff(fileMap({ 'a.txt': before }), fileMap({ 'a.txt': after }));
  assert.equal(patch.split('\n').filter((line) => line.startsWith('@@')).length, 2);
  roundTrip({ 'a.txt': before }, { 'a.txt': after });
});

test('the patch header uses a/ and b/ prefixes and /dev/null for creation', () => {
  const patch = createUnifiedDiff(fileMap({}), fileMap({ 'new.txt': 'hello\n' }));
  assert.match(patch, /^--- \/dev\/null\n\+\+\+ b\/new\.txt\n/u);
  const removal = createUnifiedDiff(fileMap({ 'old.txt': 'hello\n' }), fileMap({}));
  assert.match(removal, /^--- a\/old\.txt\n\+\+\+ \/dev\/null\n/u);
});

test('applying a patch to the wrong content is refused instead of guessed', () => {
  const patch = createUnifiedDiff(fileMap({ 'a.txt': 'one\ntwo\nthree\n' }), fileMap({ 'a.txt': 'one\nTWO\nthree\n' }));
  assert.throws(
    () => applyUnifiedDiff(fileMap({ 'a.txt': 'one\nDIFFERENT\nthree\n' }), parseUnifiedDiff(patch)),
    PatchFormatError,
  );
});

test('applying a patch for a missing file is refused', () => {
  const patch = createUnifiedDiff(fileMap({ 'a.txt': 'one\n' }), fileMap({ 'a.txt': 'two\n' }));
  assert.throws(() => applyUnifiedDiff(fileMap({}), parseUnifiedDiff(patch)), PatchFormatError);
});

test('an add patch for a file that already exists is refused', () => {
  const patch = createUnifiedDiff(fileMap({}), fileMap({ 'a.txt': 'one\n' }));
  assert.throws(
    () => applyUnifiedDiff(fileMap({ 'a.txt': 'existing\n' }), parseUnifiedDiff(patch)),
    PatchFormatError,
  );
});

test('malformed patches are rejected with a clear error', () => {
  assert.throws(() => parseUnifiedDiff('not a patch at all\n'), PatchFormatError);
  assert.throws(() => parseUnifiedDiff('--- a/x\n'), PatchFormatError);
  assert.throws(() => parseUnifiedDiff('--- a/x\n+++ b/x\n'), PatchFormatError);
  assert.throws(() => parseUnifiedDiff('--- a/x\n+++ b/x\n@@ nonsense @@\n'), PatchFormatError);
  assert.throws(() => parseUnifiedDiff('--- /dev/null\n+++ /dev/null\n@@ -1,1 +1,1 @@\n a\n'), PatchFormatError);
  assert.throws(
    () => parseUnifiedDiff('--- a/x\n+++ b/y\n@@ -1,1 +1,1 @@\n-a\n+b\n'),
    PatchFormatError,
    'renames are not supported',
  );
});

test('a hunk whose counts disagree with its header is rejected', () => {
  assert.throws(
    () => parseUnifiedDiff('--- a/x\n+++ b/x\n@@ -1,5 +1,5 @@\n a\n'),
    PatchFormatError,
  );
});

test('countPatchLines ignores the file headers', () => {
  const patch = createUnifiedDiff(fileMap({ 'a.txt': 'one\ntwo\n' }), fileMap({ 'a.txt': 'one\nTWO\nthree\n' }));
  const counts = countPatchLines(patch);
  assert.equal(counts.removed, 1);
  assert.equal(counts.added, 2);
});

test('a patch built from real fixture content applies cleanly', () => {
  const before = {
    'package.json': '{\n  "name": "greeting-kit",\n  "main": "dist/main.js"\n}\n',
    'src/index.ts': 'export function greet(name: string): string {\n  return `hello ${name}`;\n}\n',
  };
  const after = {
    ...before,
    'package.json': '{\n  "name": "greeting-kit",\n  "main": "dist/index.js"\n}\n',
  };
  roundTrip(before, after);
});
