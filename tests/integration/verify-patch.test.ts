import assert from 'node:assert/strict';
import { cp, mkdir, readFile, rm, stat, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import { PatchCheckResultSchema, parsePatchCheckResult } from '../../src/domain/patch-check.js';
import { loadFixture } from '../../src/fixtures/registry.js';
import { sha256, treeChecksum } from '../../src/infra/fs/checksum.js';
import { verifyExternalPatch } from '../../src/verify/external-patch.js';
import { temporaryDirectory, removeDirectory, useTemporaryArtifacts } from '../helpers/workspace.js';

// artifactsRoot() reads the environment on every call, so pointing it at a
// throwaway directory here is early enough.
const artifacts = await useTemporaryArtifacts('verify-patch');
const patches = await temporaryDirectory('verify-patch-inputs');

after(async () => {
  await artifacts.cleanup();
  await removeDirectory(patches);
});

async function request(caseId: string, patchText: string) {
  const fixture = await loadFixture(caseId);
  const patchPath = path.join(patches, `${caseId}-${Math.random()}.patch`);
  await writeFile(patchPath, patchText, 'utf8');
  return {
    fixture,
    options: {
      repoPath: fixture.repoDir,
      patchPath,
      oracle: {
        id: `${caseId}/oracle`,
        directory: fixture.oracleDir,
        entry: fixture.meta.oracle.entry,
        timeoutSeconds: fixture.meta.oracle.timeoutSeconds,
      },
      commandTimeoutSeconds: 60,
      executorKind: 'local-test-adapter' as const,
      allowLocalAdapter: true,
    },
  };
}

// What `git diff` prints, headers and all, for the fixture's own repair.
test('a correct patch in git diff format is verified, and the repository is untouched', async () => {
  const layout = await loadFixture('entrypoint-mismatch');
  const reference = await readFile(path.join(layout.referenceDir, 'reference.patch'), 'utf8');
  const gitStyle = `diff --git a/package.json b/package.json\nindex 1111111..2222222 100644\n${reference}`;
  const { fixture, options } = await request('entrypoint-mismatch', gitStyle);
  const before = await treeChecksum(fixture.repoDir);

  const result = await verifyExternalPatch(options);

  assert.equal(result.status, 'verified');
  assert.equal(result.verification.kind, 'passed');
  assert.equal(result.repo.mutated, false);
  assert.equal(await treeChecksum(fixture.repoDir), before);
  assert.equal(result.oracle.baseline?.kind, 'failed');
  assert.equal(result.oracle.discriminates, true);
  assert.equal(result.oracle.baselineBasis, 'reported-check');
  assert.equal(result.oracle.digest, await treeChecksum(fixture.oracleDir));
  assert.deepEqual(result.patch.changedFiles, ['package.json']);
  assert.equal(sha256(await readFile(result.artifacts.patchPath, 'utf8')), result.patch.sha256);
  PatchCheckResultSchema.parse(JSON.parse(await readFile(result.artifacts.resultPath, 'utf8')));
});

// The case the command exists for: the repository's own check exits zero, and
// a patch that changes nothing that matters would pass any gate built on it.
test('a patch that passes the visible check but not the oracle is rejected', async () => {
  const wrong = [
    '--- a/README.md',
    '+++ b/README.md',
    '@@ -1,3 +1,3 @@',
    ' # sum-kit',
    ' ',
    '-Summary statistics for a list of numbers.',
    '+Summary statistics for a list of numbers, now verified.',
    '',
  ].join('\n');
  const { options } = await request('broken-test-discovery', wrong);

  const result = await verifyExternalPatch(options);

  assert.equal(result.visibleCheck?.passed, true);
  assert.equal(result.status, 'rejected');
  assert.equal(result.verification.kind, 'failed');
});

test('a patch built against different content does not apply, and nothing is run', async () => {
  const stale = [
    '--- a/package.json',
    '+++ b/package.json',
    '@@ -1,1 +1,1 @@',
    '-{ "name": "not-this-package" }',
    '+{ "name": "anything" }',
    '',
  ].join('\n');
  const { options } = await request('entrypoint-mismatch', stale);

  const result = await verifyExternalPatch(options);

  assert.equal(result.status, 'does-not-apply');
  assert.match(result.detail, /context mismatch in package\.json at line 1/);
  assert.equal(result.visibleCheck, null);
  assert.deepEqual(result.verification, { kind: 'skipped', why: 'patch-did-not-apply' });
});

test('a patch that writes outside the repository is refused before anything is created', async () => {
  const escaping = ['--- /dev/null', '+++ b/../../escaped.txt', '@@ -0,0 +1,1 @@', '+owned', ''].join('\n');
  const { options } = await request('entrypoint-mismatch', escaping);

  const result = await verifyExternalPatch(options);

  assert.equal(result.status, 'does-not-apply');
  assert.match(result.detail, /path escapes its root/);
  const escapedFrom = path.join(result.artifacts.dir, 'workspace', '../../escaped.txt');
  assert.equal(await stat(escapedFrom).catch(() => null), null);
});

// An oracle that already passes on the broken repository cannot show a repair.
test('a pass from an oracle that also passes without the patch is inconclusive, not verified', async () => {
  const layout = await loadFixture('entrypoint-mismatch');
  const reference = await readFile(path.join(layout.referenceDir, 'reference.patch'), 'utf8');
  const { options } = await request('entrypoint-mismatch', reference);
  const lenient = await temporaryDirectory('lenient-oracle');
  await writeFile(path.join(lenient, 'oracle.mjs'), "console.log('[oracle] PASS anything');\n", 'utf8');

  try {
    const result = await verifyExternalPatch({
      ...options,
      oracle: { id: 'lenient', directory: lenient, entry: 'oracle.mjs', timeoutSeconds: 30 },
    });

    assert.equal(result.verification.kind, 'passed');
    assert.equal(result.oracle.baseline?.kind, 'passed');
    assert.equal(result.oracle.discriminates, false);
    assert.equal(result.status, 'inconclusive');
    assert.match(result.detail, /not shown to fail an assertion without it/);
    PatchCheckResultSchema.parse(JSON.parse(await readFile(result.artifacts.resultPath, 'utf8')));
  } finally {
    await removeDirectory(lenient);
  }
});

// A non-zero exit from a crashing oracle is not proof that the oracle can tell a fix from no fix.
test('an oracle that crashes without a failed check on the unpatched repo is inconclusive', async () => {
  const layout = await loadFixture('entrypoint-mismatch');
  const reference = await readFile(path.join(layout.referenceDir, 'reference.patch'), 'utf8');
  const { options } = await request('entrypoint-mismatch', reference);
  const flaky = await temporaryDirectory('crashy-oracle');
  // Passes when package.json carries the reference fix, otherwise dies like a setup error.
  await writeFile(
    path.join(flaky, 'oracle.mjs'),
    [
      "import { readFileSync } from 'node:fs';",
      "const pkg = readFileSync(process.env.REPO_DIR + '/package.json', 'utf8');",
      "if (!pkg.includes('dist/index.js')) { process.stderr.write('Error: cannot find module x\\n'); process.exit(1); }",
      "console.log('[oracle] PASS fixed');",
      '',
    ].join('\n'),
    'utf8',
  );

  try {
    const result = await verifyExternalPatch({
      ...options,
      oracle: { id: 'crashy', directory: flaky, entry: 'oracle.mjs', timeoutSeconds: 30 },
    });

    assert.equal(result.verification.kind, 'passed');
    assert.equal(result.oracle.baseline?.kind, 'failed');
    assert.equal(result.oracle.discriminates, null);
    assert.equal(result.status, 'inconclusive');
    assert.match(result.detail, /may be a crash or setup error/);
  } finally {
    await removeDirectory(flaky);
  }
});

test('the oracle digest changes when any file in the oracle directory changes, even under node_modules', async () => {
  const dir = await temporaryDirectory('digest-oracle');
  try {
    await writeFile(path.join(dir, 'oracle.mjs'), "console.log('[oracle] PASS a');\n", 'utf8');
    const first = await treeChecksum(dir, []);
    await mkdir(path.join(dir, 'node_modules'), { recursive: true });
    await writeFile(path.join(dir, 'node_modules', 'helper.js'), 'x', 'utf8');
    assert.notEqual(await treeChecksum(dir, []), first);
    // The default ignore list would have hidden that file, which is why the evidence digest does not use it.
    assert.equal(await treeChecksum(dir), await (async () => { await rm(path.join(dir, 'node_modules'), { recursive: true }); return treeChecksum(dir); })());
  } finally {
    await removeDirectory(dir);
  }
});

test('a declared exit-status contract lets a marker-less oracle reach verified, and records the weaker basis', async () => {
  const layout = await loadFixture('entrypoint-mismatch');
  const reference = await readFile(path.join(layout.referenceDir, 'reference.patch'), 'utf8');
  const { options } = await request('entrypoint-mismatch', reference);
  const plain = await temporaryDirectory('exit-status-oracle');
  await writeFile(
    path.join(plain, 'oracle.mjs'),
    [
      "import { readFileSync } from 'node:fs';",
      "const pkg = readFileSync(process.env.REPO_DIR + '/package.json', 'utf8');",
      "process.exit(pkg.includes('dist/index.js') ? 0 : 1);",
      '',
    ].join('\n'),
    'utf8',
  );
  const oracle = { id: 'plain', directory: plain, entry: 'oracle.mjs', timeoutSeconds: 30 };

  try {
    const undeclared = await verifyExternalPatch({ ...options, oracle });
    assert.equal(undeclared.status, 'inconclusive');
    assert.equal(undeclared.oracle.baselineBasis, null);

    const declared = await verifyExternalPatch({ ...options, oracle, oracleFailureContract: 'exit-status' });
    assert.equal(declared.status, 'verified');
    assert.equal(declared.oracle.discriminates, true);
    assert.equal(declared.oracle.baselineBasis, 'declared-exit-status');
  } finally {
    await removeDirectory(plain);
  }
});

test('a version 1 verification.json is still readable and is not upgraded', async () => {
  const layout = await loadFixture('entrypoint-mismatch');
  const reference = await readFile(path.join(layout.referenceDir, 'reference.patch'), 'utf8');
  const { options } = await request('entrypoint-mismatch', reference);
  const current = await verifyExternalPatch(options);
  const rest: Record<string, unknown> = JSON.parse(await readFile(current.artifacts.resultPath, 'utf8'));
  delete rest.oracle;

  const legacy = parsePatchCheckResult({ ...rest, schemaVersion: 1 });
  assert.equal(legacy.schemaVersion, 1);
  assert.equal('oracle' in legacy, false);
  assert.equal(parsePatchCheckResult(JSON.parse(await readFile(current.artifacts.resultPath, 'utf8'))).schemaVersion, 2);
});

test('an oracle directory with a symlink is inconclusive, since the digest cannot cover the target bytes', async () => {
  const layout = await loadFixture('entrypoint-mismatch');
  const reference = await readFile(path.join(layout.referenceDir, 'reference.patch'), 'utf8');
  const { options } = await request('entrypoint-mismatch', reference);
  const copy = await temporaryDirectory('symlink-oracle');
  try {
    await cp(layout.oracleDir, copy, { recursive: true });
    await symlink('/etc/hostname', path.join(copy, 'link.txt'));
    const result = await verifyExternalPatch({
      ...options,
      oracle: { ...options.oracle, directory: copy },
    });
    assert.equal(result.oracle.symlinkCount, 1);
    assert.equal(result.status, 'inconclusive');
    assert.match(result.detail, /symlink/);
  } finally {
    await removeDirectory(copy);
  }
});

test('an oracle that modifies its own directory makes the verdict oracle-mutated', async () => {
  const layout = await loadFixture('entrypoint-mismatch');
  const reference = await readFile(path.join(layout.referenceDir, 'reference.patch'), 'utf8');
  const { options } = await request('entrypoint-mismatch', reference);
  const copy = await temporaryDirectory('mutating-oracle');
  try {
    await writeFile(
      path.join(copy, 'oracle.mjs'),
      [
        "import { appendFileSync } from 'node:fs';",
        "import { fileURLToPath } from 'node:url';",
        "appendFileSync(fileURLToPath(import.meta.url), '\\n// touched');",
        "console.log('[oracle] PASS fixed');",
        '',
      ].join('\n'),
      'utf8',
    );
    const result = await verifyExternalPatch({
      ...options,
      oracle: { id: 'mutating', directory: copy, entry: 'oracle.mjs', timeoutSeconds: 30 },
    });
    assert.equal(result.oracle.digestStable, false);
    assert.equal(result.status, 'oracle-mutated');
  } finally {
    await removeDirectory(copy);
  }
});

test('an oracle that changes itself on the patched run and restores itself on the baseline run is still caught', async () => {
  const layout = await loadFixture('entrypoint-mismatch');
  const reference = await readFile(path.join(layout.referenceDir, 'reference.patch'), 'utf8');
  const { options } = await request('entrypoint-mismatch', reference);
  const copy = await temporaryDirectory('restoring-oracle');
  try {
    // Patched copy: append a line and pass. Unpatched copy: strip the line again and fail with a FAIL check.
    await writeFile(
      path.join(copy, 'oracle.mjs'),
      [
        "import { readFileSync, writeFileSync } from 'node:fs';",
        "import { fileURLToPath } from 'node:url';",
        "const self = fileURLToPath(import.meta.url);",
        "const fixed = readFileSync(process.env.REPO_DIR + '/package.json', 'utf8').includes('dist/index.js');",
        "const text = readFileSync(self, 'utf8');",
        "if (fixed) { writeFileSync(self, text + '\\n// x'); console.log('[oracle] PASS fixed'); }",
        "else { writeFileSync(self, text.replace(/\\n\\/\\/ x$/u, '')); console.log('[oracle] FAIL not fixed'); process.exit(1); }",
        '',
      ].join('\n'),
      'utf8',
    );
    const result = await verifyExternalPatch({
      ...options,
      oracle: { id: 'restoring', directory: copy, entry: 'oracle.mjs', timeoutSeconds: 30 },
    });
    assert.equal(result.oracle.digestStable, false);
    assert.equal(result.status, 'oracle-mutated');
  } finally {
    await removeDirectory(copy);
  }
});
