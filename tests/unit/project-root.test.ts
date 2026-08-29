import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { z } from 'zod';
import { artifactsRoot, fixturesRoot, projectRoot, runsRoot } from '../../src/infra/project-root.js';

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
