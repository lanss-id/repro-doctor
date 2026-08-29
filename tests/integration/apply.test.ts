import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import { useTemporaryArtifacts, removeDirectory, temporaryDirectory } from '../helpers/workspace.js';

const artifacts = await useTemporaryArtifacts('apply');

const { diagnose } = await import('../../src/agent/diagnose.js');
const { commitApply, prepareApply } = await import('../../src/apply/apply.js');
const { applyCommand } = await import('../../src/cli/commands/apply.js');
const { parseArgv } = await import('../../src/cli/args.js');
const { createPresenter } = await import('../../src/cli/presenter.js');
const { loadFixture } = await import('../../src/fixtures/registry.js');
const { copyRepositoryToWorkspace } = await import('../../src/infra/fs/copy.js');
const { treeChecksum } = await import('../../src/infra/fs/checksum.js');
const { scriptedDriver } = await import('../helpers/scripted-driver.js');
const { silentLogger } = await import('../../src/infra/log.js');

const fixture = await loadFixture('entrypoint-mismatch');

/** Diagnoses a throwaway copy so the patch has a target it can be applied to. */
async function repairedRun(): Promise<{ runId: string; target: string; root: string }> {
  const root = await temporaryDirectory('apply-target');
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
      id: 'entrypoint-mismatch/oracle',
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

test('apply refuses a target that is not the tree the patch was built against', async () => {
  const { runId, target, root } = await repairedRun();
  try {
    await writeFile(path.join(target, 'README.md'), '# changed after diagnose\n', 'utf8');
    await assert.rejects(
      () => prepareApply(runId, target),
      /not in the state this patch was built against/u,
    );
  } finally {
    await removeDirectory(root);
  }
});

test('apply refuses a target directory that does not exist', async () => {
  const { runId, root } = await repairedRun();
  try {
    await assert.rejects(() => prepareApply(runId, path.join(root, 'nowhere')), /target repository not found/u);
  } finally {
    await removeDirectory(root);
  }
});

test('the preview describes the change before anything is written', async () => {
  const { runId, target, root } = await repairedRun();
  try {
    const before = await treeChecksum(target);
    const preview = await prepareApply(runId, target);
    assert.deepEqual(preview.changedFiles, ['package.json']);
    assert.match(preview.patchText, /-\s*"main": "dist\/main\.js"/u);
    assert.equal(await treeChecksum(target), before, 'preparing a preview must not touch the target');
  } finally {
    await removeDirectory(root);
  }
});

test('a declined confirmation writes nothing', async () => {
  const { runId, target, root } = await repairedRun();
  try {
    const before = await treeChecksum(target);
    const lines: string[] = [];
    const code = await applyCommand(
      parseArgv(['apply', runId, '--to', target]),
      createPresenter((text) => lines.push(text)),
      async () => 'no',
    );
    assert.equal(code, 1);
    assert.equal(await treeChecksum(target), before);
    assert.ok(lines.some((line) => line.includes('Cancelled')));
    assert.ok(lines.some((line) => line.includes('dist/index.js')), 'the patch must be shown before the prompt');
  } finally {
    await removeDirectory(root);
  }
});

test('a confirmed apply writes exactly the patched file', async () => {
  const { runId, target, root } = await repairedRun();
  try {
    const before = await treeChecksum(target);
    const code = await applyCommand(
      parseArgv(['apply', runId, '--to', target]),
      createPresenter(() => undefined),
      async () => 'apply',
    );
    assert.equal(code, 0);
    const manifest = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
    assert.equal(manifest.main, 'dist/index.js');
    assert.notEqual(await treeChecksum(target), before);
    assert.equal(
      await readFile(path.join(target, 'src/index.ts'), 'utf8'),
      await readFile(path.join(fixture.repoDir, 'src/index.ts'), 'utf8'),
      'untouched files must stay byte identical',
    );
  } finally {
    await removeDirectory(root);
  }
});

test('the documented approval flag skips the prompt and nothing else', async () => {
  const { runId, target, root } = await repairedRun();
  try {
    const lines: string[] = [];
    const code = await applyCommand(
      parseArgv(['apply', runId, '--to', target, '--yes-i-reviewed-the-patch']),
      createPresenter((text) => lines.push(text)),
      async () => {
        throw new Error('the prompt must not be reached when approval was given explicitly');
      },
    );
    assert.equal(code, 0);
    assert.ok(lines.some((line) => line.includes('--yes-i-reviewed-the-patch')));
    const manifest = JSON.parse(await readFile(path.join(target, 'package.json'), 'utf8'));
    assert.equal(manifest.main, 'dist/index.js');
  } finally {
    await removeDirectory(root);
  }
});

test('commitApply reports the checksum it produced', async () => {
  const { runId, target, root } = await repairedRun();
  try {
    const outcome = await commitApply(await prepareApply(runId, target));
    assert.deepEqual(outcome.writtenFiles, ['package.json']);
    assert.deepEqual(outcome.deletedFiles, []);
    assert.equal(outcome.checksumAfter, await treeChecksum(target));
  } finally {
    await removeDirectory(root);
  }
});

after(async () => {
  await artifacts.cleanup();
});
