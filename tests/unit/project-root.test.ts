import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import {
  artifactsRoot,
  fixturesRoot,
  projectRoot,
  resolveArtifactsRoot,
  runsRoot,
} from '../../src/infra/project-root.js';

const ManifestSchema = z.object({ name: z.string() }).loose();

test('the project root is the directory holding this project\'s own manifest', async () => {
  const root = projectRoot();
  const manifest = ManifestSchema.parse(
    JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8')),
  );
  assert.equal(manifest.name, 'repro-doctor', 'the walk stopped at some other package.json');
});

test('artifact locations hang off the root and honour the override', () => {
  const root = projectRoot();
  const previous = process.env['REPRO_DOCTOR_ARTIFACTS_DIR'];
  delete process.env['REPRO_DOCTOR_ARTIFACTS_DIR'];
  try {
    assert.equal(artifactsRoot(), path.join(root, 'artifacts'));
    assert.equal(runsRoot(), path.join(root, 'artifacts', 'runs'));
    assert.equal(fixturesRoot(), path.join(root, 'fixtures'));
    process.env['REPRO_DOCTOR_ARTIFACTS_DIR'] = '/tmp/somewhere-else';
    assert.equal(artifactsRoot(), '/tmp/somewhere-else');
    assert.equal(runsRoot(), path.join('/tmp/somewhere-else', 'runs'));
  } finally {
    if (previous === undefined) {
      delete process.env['REPRO_DOCTOR_ARTIFACTS_DIR'];
    } else {
      process.env['REPRO_DOCTOR_ARTIFACTS_DIR'] = previous;
    }
  }
});

test('a checkout writes artifacts beside its own source', () => {
  assert.equal(
    resolveArtifactsRoot('/home/dev/repro-doctor', '/anywhere', undefined),
    path.join('/home/dev/repro-doctor', 'artifacts'),
  );
});

test('an installed copy writes beside the repository, not into its own cache', () => {
  // Through npx the project root is a cache directory that may be cleared
  // between two commands, which would break `apply <run-id>` the moment
  // `diagnose` returned.
  const cached = path.join('/home/dev/.npm/_npx/abc123/node_modules/repro-doctor');
  assert.equal(
    resolveArtifactsRoot(cached, '/home/dev/work/service', undefined),
    path.join('/home/dev/work/service', '.repro-doctor'),
  );
});

test('the environment override wins over both, and an empty one does not', () => {
  assert.equal(resolveArtifactsRoot('/checkout', '/cwd', '/tmp/elsewhere'), '/tmp/elsewhere');
  assert.equal(
    resolveArtifactsRoot('/checkout', '/cwd', ''),
    path.join('/checkout', 'artifacts'),
    'an empty variable is not a location; treating it as one writes runs to the filesystem root',
  );
});
