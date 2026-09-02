import assert from 'node:assert/strict';
import { mkdir, readFile, readlink, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { ReproDoctorError } from '../../src/domain/failure.js';
import { copyRepositoryToWorkspace } from '../../src/infra/fs/copy.js';
import { PathSafetyError } from '../../src/infra/fs/paths.js';
import { removeDirectory, temporaryDirectory } from '../helpers/workspace.js';

async function buildRepository(root: string): Promise<string> {
  const repo = path.join(root, 'repo');
  await mkdir(path.join(repo, 'src'), { recursive: true });
  await mkdir(path.join(repo, 'dist'), { recursive: true });
  await mkdir(path.join(repo, 'node_modules', 'left-pad'), { recursive: true });
  await mkdir(path.join(repo, 'node_modules', 'left-pad', 'dist'), { recursive: true });
  await mkdir(path.join(repo, '.git'), { recursive: true });
  await writeFile(path.join(repo, '.git', 'HEAD'), 'ref: refs/heads/main\n', 'utf8');
  await writeFile(path.join(repo, 'package.json'), '{"name":"x"}\n', 'utf8');
  await writeFile(path.join(repo, 'src', 'index.ts'), 'export const a = 1;\n', 'utf8');
  await writeFile(path.join(repo, 'dist', 'index.js'), 'export const generated = true;\n', 'utf8');
  await writeFile(path.join(repo, 'node_modules', 'left-pad', 'index.js'), 'module.exports = 1;\n', 'utf8');
  await writeFile(
    path.join(repo, 'node_modules', 'left-pad', 'dist', 'index.js'),
    'module.exports = 2;\n',
    'utf8',
  );
  return repo;
}

// The dependencies used to be dropped here. In a sandbox with no network that
// leaves a repository that cannot run its own check, and the agent spends its
// budget on installs that can never succeed: three live runs against commander
// went that way before this changed. `.git` stays out, because the repository's
// history is not needed to run it and is a way to read the fix.
test('copying produces an independent workspace, dependencies included', async () => {
  const root = await temporaryDirectory('copy');
  try {
    const repo = await buildRepository(root);
    const workspace = path.join(root, 'workspace');
    const report = await copyRepositoryToWorkspace(repo, workspace);

    assert.equal(report.fileCount, 4);
    assert.equal(await readFile(path.join(workspace, 'src/index.ts'), 'utf8'), 'export const a = 1;\n');
    assert.ok(
      await readFile(path.join(workspace, 'node_modules/left-pad/index.js'), 'utf8'),
      'the sandbox has no network, so the dependencies have to arrive with the copy',
    );
    assert.equal(
      await readFile(path.join(workspace, 'node_modules/left-pad/dist/index.js'), 'utf8'),
      'module.exports = 2;\n',
      'package dist directories contain executable dependency code and must survive the copy',
    );
    await assert.rejects(() => readFile(path.join(workspace, 'dist/index.js'), 'utf8'));
    await assert.rejects(() => readFile(path.join(workspace, '.git/HEAD'), 'utf8'));

    await writeFile(path.join(workspace, 'src/index.ts'), 'export const a = 2;\n', 'utf8');
    assert.equal(
      await readFile(path.join(repo, 'src/index.ts'), 'utf8'),
      'export const a = 1;\n',
      'writing in the workspace must not reach the source repository',
    );
  } finally {
    await removeDirectory(root);
  }
});

test('a symlink pointing outside the repository aborts the copy', async () => {
  const root = await temporaryDirectory('copy-escape');
  try {
    const repo = await buildRepository(root);
    await writeFile(path.join(root, 'secret.txt'), 'top secret', 'utf8');
    await symlink(path.join(root, 'secret.txt'), path.join(repo, 'link.txt'));
    await assert.rejects(
      () => copyRepositoryToWorkspace(repo, path.join(root, 'workspace')),
      PathSafetyError,
    );
  } finally {
    await removeDirectory(root);
  }
});

test('a symlink inside the repository is reported and not copied', async () => {
  const root = await temporaryDirectory('copy-inner');
  try {
    const repo = await buildRepository(root);
    await symlink(path.join(repo, 'package.json'), path.join(repo, 'manifest-link.json'));
    const workspace = path.join(root, 'workspace');
    const report = await copyRepositoryToWorkspace(repo, workspace);
    assert.deepEqual(report.skippedSymlinks, ['manifest-link.json']);
    await assert.rejects(() => readFile(path.join(workspace, 'manifest-link.json'), 'utf8'));
  } finally {
    await removeDirectory(root);
  }
});

// commander has two tests that resolve an executable subcommand through a
// relative symlink. Dropping those links made its own suite fail inside the
// sandbox, so the agent saw a red baseline caused by the harness rather than by
// the repository, and spent its budget there.
test('a relative symlink that stays inside the repository is preserved', async () => {
  const root = await temporaryDirectory('copy-relative-link');
  try {
    const repo = await buildRepository(root);
    await symlink('package.json', path.join(repo, 'manifest-link.json'));
    const workspace = path.join(root, 'workspace');

    const report = await copyRepositoryToWorkspace(repo, workspace);

    assert.deepEqual(report.skippedSymlinks, []);
    assert.equal(await readFile(path.join(workspace, 'manifest-link.json'), 'utf8'), '{"name":"x"}\n');
    assert.equal(
      await readlink(path.join(workspace, 'manifest-link.json')),
      'package.json',
      'the link must point inside the workspace, never back at the source',
    );
  } finally {
    await removeDirectory(root);
  }
});

test('the workspace may not live inside the repository being copied', async () => {
  const root = await temporaryDirectory('copy-nested');
  try {
    const repo = await buildRepository(root);
    await assert.rejects(
      () => copyRepositoryToWorkspace(repo, path.join(repo, 'workspace')),
      PathSafetyError,
    );
  } finally {
    await removeDirectory(root);
  }
});

test('copy limits reject an oversized tree', async () => {
  const root = await temporaryDirectory('copy-limits');
  try {
    const repo = await buildRepository(root);
    await assert.rejects(
      () => copyRepositoryToWorkspace(repo, path.join(root, 'workspace'), { maxFiles: 1 }),
      ReproDoctorError,
    );
    await assert.rejects(
      () => copyRepositoryToWorkspace(repo, path.join(root, 'workspace2'), { maxFileBytes: 4 }),
      ReproDoctorError,
    );
  } finally {
    await removeDirectory(root);
  }
});
