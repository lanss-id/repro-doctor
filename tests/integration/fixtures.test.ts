import assert from 'node:assert/strict';
import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import { useTemporaryArtifacts } from '../helpers/workspace.js';

const artifacts = await useTemporaryArtifacts('fixtures');

const { loadAllFixtures, findIsolationProblems } = await import('../../src/fixtures/registry.js');
const { checkFixture } = await import('../../src/fixtures/verify-fixtures.js');
const { copyRepositoryToWorkspace } = await import('../../src/infra/fs/copy.js');
const { temporaryDirectory, removeDirectory } = await import('../helpers/workspace.js');

const fixtures = await loadAllFixtures();

test('the benchmark has the ten documented cases', () => {
  assert.equal(fixtures.length, 10);
  assert.deepEqual(
    fixtures.map((fixture) => fixture.meta.id).sort(),
    [
      'broken-test-discovery',
      'case-sensitive-import',
      'chained-two-faults',
      'entrypoint-mismatch',
      'env-contract',
      'esm-cjs-mismatch',
      'health-route-port',
      'manifest-lockfile-mismatch',
      'monorepo-build-order',
      'tsconfig-include-scope',
    ],
  );
});

test('no fixture leaks its oracle, reference repair or metadata into the repository', async () => {
  assert.deepEqual(await findIsolationProblems(), []);
});

test('the copied workspace contains no hidden fixture material', async () => {
  for (const fixture of fixtures) {
    const workspace = await temporaryDirectory(`isolation-${fixture.meta.id}`);
    try {
      await copyRepositoryToWorkspace(fixture.repoDir, path.join(workspace, 'copy'));
      const entries = await readdir(path.join(workspace, 'copy'), { recursive: true });
      for (const entry of entries) {
        const normalized = String(entry).split(path.sep).join('/');
        assert.equal(normalized.startsWith('oracle/'), false, `${fixture.meta.id}: ${normalized}`);
        assert.equal(normalized.startsWith('reference/'), false, `${fixture.meta.id}: ${normalized}`);
        assert.notEqual(normalized, 'meta.json', `${fixture.meta.id} leaked meta.json`);
      }
    } finally {
      await removeDirectory(workspace);
    }
  }
});

test('every fixture ships a package-lock.json and a README', async () => {
  for (const fixture of fixtures) {
    const entries = await readdir(fixture.repoDir);
    assert.ok(entries.includes('package.json'), `${fixture.meta.id} has no package.json`);
    assert.ok(entries.includes('package-lock.json'), `${fixture.meta.id} has no package-lock.json`);
    assert.ok(entries.includes('README.md'), `${fixture.meta.id} has no README.md`);
  }
});

test('every fixture ships a reference patch that names the files it changes', async () => {
  for (const fixture of fixtures) {
    const patchPath = path.join(fixture.referenceDir, fixture.meta.reference.patch);
    const patch = await readFile(patchPath, 'utf8');
    assert.ok(patch.trim().length > 0, `${fixture.meta.id} has an empty reference patch`);
    assert.match(patch, /^--- /u, `${fixture.meta.id} reference patch is not a unified diff`);
  }
});

for (const fixture of fixtures) {
  test(`${fixture.meta.id} fails before its reference repair and passes after it`, async () => {
    const check = await checkFixture(fixture, {
      executorKind: 'local-test-adapter',
      allowLocalAdapter: true,
    });
    assert.equal(
      check.failsBeforeRepair,
      true,
      `${fixture.meta.id} did not fail before repair: ${check.beforeDetail}`,
    );
    assert.equal(
      check.passesAfterRepair,
      true,
      `${fixture.meta.id} did not pass after the reference repair: ${check.afterDetail}`,
    );
  });
}

after(async () => {
  await artifacts.cleanup();
});
