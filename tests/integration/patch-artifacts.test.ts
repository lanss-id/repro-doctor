import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import { useTemporaryArtifacts, removeDirectory, temporaryDirectory } from '../helpers/workspace.js';

const artifacts = await useTemporaryArtifacts('patch-artifacts');

const { diagnose } = await import('../../src/agent/diagnose.js');
const { commitApply, prepareApply } = await import('../../src/apply/apply.js');
const { loadFixture } = await import('../../src/fixtures/registry.js');
const { copyRepositoryToWorkspace } = await import('../../src/infra/fs/copy.js');
const { sha256 } = await import('../../src/infra/fs/checksum.js');
const { scriptedDriver } = await import('../helpers/scripted-driver.js');
const { silentLogger } = await import('../../src/infra/log.js');

const fixture = await loadFixture('entrypoint-mismatch');

// A string that looks exactly like a live credential. It must survive into
// repair.patch byte for byte, and must not appear anywhere else.
const SECRET = 'sk-proj-abcdefghijklmnopqrstuvwxyz0123456789';
const FILE_WITH_SECRET = `# Local notes\n\nOPENAI_API_KEY=${SECRET}\n`;

test('repair.patch stays exact while every publishable artifact is redacted', async () => {
  const root = await temporaryDirectory('patch-secret');
  try {
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
        await session.proposePatch(
          [
            { path: 'package.json', content: fixed },
            { path: 'NOTES.md', content: FILE_WITH_SECRET },
          ],
          'fix the entry point and leave a note behind',
        );
        return { text: 'done' };
      }),
    });

    assert.equal(result.patch.kind, 'present');
    if (result.patch.kind !== 'present') return;
    assert.equal(result.patch.sensitive, true, 'the patch must be labelled sensitive');

    // Exact bytes: the checksum in result.json is over the file as stored.
    const patchOnDisk = await readFile(result.artifacts.patchPath, 'utf8');
    assert.ok(patchOnDisk.includes(SECRET), 'the stored patch must be exact, not redacted');
    assert.equal(sha256(patchOnDisk), result.patch.sha256);

    // Publishable artifacts carry the redacted view instead.
    const report = await readFile(result.artifacts.reportPath, 'utf8');
    assert.equal(report.includes(SECRET), false, 'the HTML report leaked the secret');
    assert.match(report, /\[redacted:/u, 'the report shows a redaction marker where the secret was');
    assert.match(report, /exact, unredacted repository content/u);

    const trajectory = await readFile(result.artifacts.trajectoryPath, 'utf8');
    assert.equal(trajectory.includes(SECRET), false, 'the trajectory leaked the secret');

    const resultJson = await readFile(result.artifacts.resultPath, 'utf8');
    assert.equal(resultJson.includes(SECRET), false, 'result.json leaked the secret');

    // And the exact patch still applies, which is the reason it is stored exact.
    const applyTarget = path.join(root, 'apply-target');
    await copyRepositoryToWorkspace(fixture.repoDir, applyTarget);
    const preview = await prepareApply(result.runId, applyTarget);
    const outcome = await commitApply(preview);
    assert.deepEqual([...outcome.writtenFiles].sort(), ['NOTES.md', 'package.json']);
    assert.equal(await readFile(path.join(applyTarget, 'NOTES.md'), 'utf8'), FILE_WITH_SECRET);
  } finally {
    await removeDirectory(root);
  }
});

after(async () => {
  await artifacts.cleanup();
});
