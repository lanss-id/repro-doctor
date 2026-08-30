import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import { useTemporaryArtifacts } from '../helpers/workspace.js';

const artifacts = await useTemporaryArtifacts('byo-oracle-example');

const { runHiddenOracle } = await import('../../src/oracle/verify.js');
const { copyRepositoryToWorkspace } = await import('../../src/infra/fs/copy.js');
const { projectRoot } = await import('../../src/infra/project-root.js');
const { temporaryDirectory, removeDirectory } = await import('../helpers/workspace.js');

const exampleDir = path.join(projectRoot(), 'examples/bring-your-own-oracle');
const repoDir = path.join(exampleDir, 'repo');
const oracleDir = path.join(exampleDir, 'oracle');
const repairScript = path.join(exampleDir, 'reference/repair.mjs');

const oracle = {
  id: 'bring-your-own-oracle',
  directory: oracleDir,
  entry: 'oracle.mjs',
  timeoutSeconds: 120,
};

async function runOracleAgainst(workspace: string, scratch: string): Promise<string> {
  const result = await runHiddenOracle({
    oracle,
    repairedWorkspace: workspace,
    scratchDirectory: scratch,
    executorKind: 'local-test-adapter',
    allowLocalAdapter: true,
  });
  return result.outcome.kind;
}

after(async () => {
  await artifacts.cleanup();
});

// The guide in examples/bring-your-own-oracle tells a reader to check that their
// oracle fails before a known good repair and passes after it. The example has
// to pass its own advice, or the guide is worth nothing.
test('the documented example fails its oracle before the reference repair and passes after it', async () => {
  const scratch = await temporaryDirectory('byo-oracle-example');
  try {
    // Arrange: two copies of the same repository, one of which gets repaired.
    const broken = path.join(scratch, 'broken');
    const repaired = path.join(scratch, 'repaired');
    await copyRepositoryToWorkspace(repoDir, broken);
    await copyRepositoryToWorkspace(repoDir, repaired);

    // Act
    const before = await runOracleAgainst(broken, path.join(scratch, 'verify-before'));
    execFileSync(process.execPath, [repairScript], {
      env: { PATH: process.env['PATH'] ?? '/usr/bin:/bin', HOME: process.env['HOME'] ?? '/tmp', REPO_DIR: repaired },
      stdio: 'pipe',
    });
    const after = await runOracleAgainst(repaired, path.join(scratch, 'verify-after'));

    // Assert
    assert.equal(before, 'failed', 'the example repository must fail its own oracle');
    assert.equal(after, 'passed', 'the reference repair must satisfy the oracle');
  } finally {
    await removeDirectory(scratch);
  }
});

test('the example keeps its oracle and reference repair outside the repository', async () => {
  const workspace = await temporaryDirectory('byo-oracle-isolation');
  try {
    const copy = path.join(workspace, 'copy');
    await copyRepositoryToWorkspace(repoDir, copy);
    for (const entry of await readdir(copy, { recursive: true })) {
      const normalized = String(entry).split(path.sep).join('/');
      assert.equal(normalized.startsWith('oracle'), false, `leaked ${normalized}`);
      assert.equal(normalized.startsWith('reference'), false, `leaked ${normalized}`);
    }
  } finally {
    await removeDirectory(workspace);
  }
});
