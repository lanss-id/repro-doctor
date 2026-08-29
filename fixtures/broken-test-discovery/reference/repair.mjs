// Reference repair for broken-test-discovery: name the test files so the
// runner's pattern actually matches them.
import { renameSync } from 'node:fs';
import path from 'node:path';

const repo = process.env.REPO_DIR ?? process.cwd();
renameSync(path.join(repo, 'tests/sum.spec.mjs'), path.join(repo, 'tests/sum.test.mjs'));
