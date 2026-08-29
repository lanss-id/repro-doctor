import assert from 'node:assert/strict';
import { mkdir, readFile, readdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import type { ApplyPreview } from '../../src/apply/apply.js';
import { useTemporaryArtifacts, removeDirectory, temporaryDirectory } from '../helpers/workspace.js';

const artifacts = await useTemporaryArtifacts('apply-safety');

const { diagnose } = await import('../../src/agent/diagnose.js');
const { commitApply, prepareApply } = await import('../../src/apply/apply.js');
const { applyCommand } = await import('../../src/cli/commands/apply.js');
const { parseArgv } = await import('../../src/cli/args.js');
const { createPresenter } = await import('../../src/cli/presenter.js');
const { loadFixture } = await import('../../src/fixtures/registry.js');
const { copyRepositoryToWorkspace } = await import('../../src/infra/fs/copy.js');
const { treeChecksum } = await import('../../src/infra/fs/checksum.js');
const { PathSafetyError } = await import('../../src/infra/fs/paths.js');
const { scriptedDriver } = await import('../helpers/scripted-driver.js');
const { silentLogger } = await import('../../src/infra/log.js');

const fixture = await loadFixture('entrypoint-mismatch');

async function repairedRun(): Promise<{ runId: string; target: string; root: string }> {
  const root = await temporaryDirectory('apply-safety-target');
  const target = path.join(root, 'repo');
  await copyRepositoryToWorkspace(fixture.repoDir, target);
  const manifest = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
  manifest.main = 'dist/index.js';
  const fixed = `${JSON.stringify(manifest, null, 2)}\n`;

  const result = await diagnose({
    repoPath: target,
    mode: 'baseline',
    caseId: fixture.meta.id,
    oracle: {
      id: `${fixture.meta.id}/oracle`,
      directory: fixture.oracleDir,
      entry: fixture.meta.oracle.entry,
      timeoutSeconds: fixture.meta.oracle.timeoutSeconds,
    },
    executorKind: 'local-test-adapter',
    allowLocalAdapter: true,
    logger: silentLogger,
    env: {},
    modelOverride: 'scripted-test-driver',
    driverFactory: scriptedDriver(async (session) => {
      await session.proposePatch([{ path: 'package.json', content: fixed }], 'fix the entry point');
      return { text: 'fixed' };
    }),
  });
  assert.equal(result.outcome.status, 'repaired');
  return { runId: result.runId, target, root };
}

test('a patch that adds a file under an escaping symlink creates nothing outside the target', async () => {
  const { runId, target, root } = await repairedRun();
  const outside = path.join(root, 'outside');
  try {
    await mkdir(outside, { recursive: true });
    // The target now contains `escape -> ../outside`. A patch that adds
    // `escape/new/owned.txt` would resolve to outside/new/owned.txt.
    await symlink(outside, path.join(target, 'escape'));

    const base = await prepareApply(runId, target).catch(() => null);
    // The symlink changed the tree, so the ordinary path already refuses. Build
    // the preview by hand to test the writer itself rather than the guard in
    // front of it.
    assert.equal(base, null, 'a modified target is refused before anything else');

    const real = await prepareApply(runId, await freshTarget(root));
    const hostile: ApplyPreview = {
      ...real,
      targetPath: target,
      targetChecksum: await treeChecksum(target),
      patchText: [
        '--- /dev/null',
        '+++ b/escape/new/owned.txt',
        '@@ -0,0 +1,1 @@',
        '+owned',
        '',
      ].join('\n'),
      changedFiles: ['escape/new/owned.txt'],
    };

    await assert.rejects(() => commitApply(hostile), PathSafetyError);

    // Nothing was created outside the target, not even a directory.
    assert.deepEqual(await readdir(outside), [], 'a directory was created outside the target');
  } finally {
    await removeDirectory(root);
  }
});

async function freshTarget(root: string): Promise<string> {
  const target = path.join(root, `fresh-${Math.random().toString(16).slice(2)}`);
  await copyRepositoryToWorkspace(fixture.repoDir, target);
  return target;
}

test('a target that changes during confirmation is not written to', async () => {
  const { runId, target, root } = await repairedRun();
  try {
    const before = await treeChecksum(target);
    await assert.rejects(
      () =>
        applyCommand(
          parseArgv(['apply', runId, '--to', target]),
          createPresenter(() => undefined),
          async () => {
            // Somebody edits the repository while the operator reads the diff.
            await writeFile(path.join(target, 'README.md'), '# changed mid-review\n', 'utf8');
            return 'apply';
          },
        ),
      /changed while the patch was being reviewed/u,
    );

    const manifest = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
    assert.equal(manifest.main, 'dist/main.js', 'the patch must not have been applied');
    assert.notEqual(await treeChecksum(target), before, 'only the mid-review edit changed the tree');
  } finally {
    await removeDirectory(root);
  }
});

after(async () => {
  await artifacts.cleanup();
});
