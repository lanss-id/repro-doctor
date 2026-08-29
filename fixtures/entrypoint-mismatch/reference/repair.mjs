// Reference repair for entrypoint-mismatch: point main at the file the build
// actually emits. Deterministic, and hidden from the agent.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repo = process.env.REPO_DIR ?? process.cwd();
const manifestPath = path.join(repo, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.main = 'dist/index.js';
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
