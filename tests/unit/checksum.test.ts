import assert from 'node:assert/strict';
import { chmod, mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { sha256, treeChecksum, treeSnapshot } from '../../src/infra/fs/checksum.js';
import { removeDirectory, temporaryDirectory } from '../helpers/workspace.js';

async function buildTree(root: string): Promise<void> {
  await mkdir(path.join(root, 'src'), { recursive: true });
  await mkdir(path.join(root, 'dist'), { recursive: true });
  await writeFile(path.join(root, 'package.json'), '{"name":"x"}\n', 'utf8');
  await writeFile(path.join(root, 'src', 'index.ts'), 'export const a = 1;\n', 'utf8');
  await writeFile(path.join(root, 'dist', 'index.js'), 'export const a = 1;\n', 'utf8');
}

test('sha256 is stable for identical input', () => {
  assert.equal(sha256('abc'), sha256(Buffer.from('abc')));
  assert.equal(sha256('abc').length, 64);
});

test('the tree checksum is deterministic and ignores build output', async () => {
  const root = await temporaryDirectory('checksum');
  try {
    await buildTree(root);
    const first = await treeChecksum(root);
    const second = await treeChecksum(root);
    assert.equal(first, second);

    await writeFile(path.join(root, 'dist', 'index.js'), 'export const a = 99;\n', 'utf8');
    assert.equal(await treeChecksum(root), first, 'dist is not part of repository state');
  } finally {
    await removeDirectory(root);
  }
});

test('the tree checksum changes when a tracked file changes', async () => {
  const root = await temporaryDirectory('checksum-change');
  try {
    await buildTree(root);
    const before = await treeChecksum(root);
    await writeFile(path.join(root, 'src', 'index.ts'), 'export const a = 2;\n', 'utf8');
    assert.notEqual(await treeChecksum(root), before);
  } finally {
    await removeDirectory(root);
  }
});

test('the tree checksum changes when a new file appears', async () => {
  const root = await temporaryDirectory('checksum-add');
  try {
    await buildTree(root);
    const before = await treeChecksum(root);
    await writeFile(path.join(root, 'src', 'extra.ts'), 'export const b = 1;\n', 'utf8');
    assert.notEqual(await treeChecksum(root), before);
  } finally {
    await removeDirectory(root);
  }
});

test('the tree checksum notices the executable bit', async () => {
  const root = await temporaryDirectory('checksum-mode');
  try {
    await buildTree(root);
    const before = await treeChecksum(root);
    await chmod(path.join(root, 'src', 'index.ts'), 0o755);
    assert.notEqual(await treeChecksum(root), before);
  } finally {
    await removeDirectory(root);
  }
});

test('the snapshot lists entries in sorted order', async () => {
  const root = await temporaryDirectory('checksum-snapshot');
  try {
    await buildTree(root);
    const snapshot = await treeSnapshot(root);
    const paths = snapshot.entries.map((entry) => entry.relativePath);
    assert.deepEqual(paths, [...paths].sort());
    assert.deepEqual(paths, ['package.json', 'src/index.ts']);
  } finally {
    await removeDirectory(root);
  }
});
