import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import {
  PathSafetyError,
  assertInside,
  assertRealPathInside,
  isEscapingSymlink,
  isInside,
  resolveWithin,
  toPosixRelative,
} from '../../src/infra/fs/paths.js';
import { removeDirectory, temporaryDirectory } from '../helpers/workspace.js';

test('resolveWithin accepts an ordinary relative path', () => {
  const resolved = resolveWithin('/srv/work', 'src/index.ts');
  assert.equal(resolved, path.resolve('/srv/work/src/index.ts'));
});

test('resolveWithin rejects traversal out of the root', () => {
  for (const candidate of ['../secrets', 'src/../../secrets', 'a/b/../../../c']) {
    assert.throws(() => resolveWithin('/srv/work', candidate), PathSafetyError, candidate);
  }
});

test('resolveWithin keeps traversal that stays inside the root', () => {
  assert.equal(resolveWithin('/srv/work', 'src/../package.json'), path.resolve('/srv/work/package.json'));
});

test('resolveWithin rejects absolute, drive-qualified and NUL paths', () => {
  assert.throws(() => resolveWithin('/srv/work', '/etc/passwd'), PathSafetyError);
  assert.throws(() => resolveWithin('/srv/work', 'C:/Windows'), PathSafetyError);
  assert.throws(() => resolveWithin('/srv/work', 'src/index\0.ts'), PathSafetyError);
  assert.throws(() => resolveWithin('/srv/work', ''), PathSafetyError);
});

test('assertInside treats the root itself as inside and a sibling as outside', () => {
  assert.doesNotThrow(() => assertInside('/srv/work', '/srv/work'));
  assert.throws(() => assertInside('/srv/work', '/srv/work-other/file'), PathSafetyError);
  assert.equal(isInside('/srv/work', '/srv/work/sub/file'), true);
  assert.equal(isInside('/srv/work', '/srv/workother'), false);
});

test('assertRealPathInside follows a symlink to its real destination', async () => {
  const root = await temporaryDirectory('paths');
  try {
    const workspace = path.join(root, 'workspace');
    const outside = path.join(root, 'outside');
    await mkdir(workspace, { recursive: true });
    await mkdir(outside, { recursive: true });
    await writeFile(path.join(outside, 'secret.txt'), 'top secret', 'utf8');
    await symlink(path.join(outside, 'secret.txt'), path.join(workspace, 'link.txt'));

    await assert.rejects(
      () => assertRealPathInside(workspace, path.join(workspace, 'link.txt')),
      PathSafetyError,
    );
    assert.equal(await isEscapingSymlink(workspace, path.join(workspace, 'link.txt')), true);

    await writeFile(path.join(workspace, 'real.txt'), 'fine', 'utf8');
    await assertRealPathInside(workspace, path.join(workspace, 'real.txt'));
    assert.equal(await isEscapingSymlink(workspace, path.join(workspace, 'real.txt')), false);
  } finally {
    await removeDirectory(root);
  }
});

test('assertRealPathInside allows a file that does not exist yet', async () => {
  const root = await temporaryDirectory('paths-new');
  try {
    await assertRealPathInside(root, path.join(root, 'not-created-yet.txt'));
    await assert.rejects(
      () => assertRealPathInside(root, path.join(root, '..', 'escape.txt')),
      PathSafetyError,
    );
  } finally {
    await removeDirectory(root);
  }
});

test('assertRealPathInside rejects a directory symlink that escapes', async () => {
  const root = await temporaryDirectory('paths-dir');
  try {
    const workspace = path.join(root, 'workspace');
    const outside = path.join(root, 'outside');
    await mkdir(workspace, { recursive: true });
    await mkdir(outside, { recursive: true });
    await symlink(outside, path.join(workspace, 'escape'));
    await assert.rejects(
      () => assertRealPathInside(workspace, path.join(workspace, 'escape', 'new-file.txt')),
      PathSafetyError,
    );
  } finally {
    await removeDirectory(root);
  }
});

test('toPosixRelative always uses forward slashes', () => {
  assert.equal(toPosixRelative('/srv/work', '/srv/work/src/a/b.ts'), 'src/a/b.ts');
});
