// Reference repair for chained-two-faults: fix both the entry point and the
// environment variable name.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repo = process.env.REPO_DIR ?? process.cwd();

const manifestPath = path.join(repo, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.main = 'dist/index.js';
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

const configPath = path.join(repo, 'src/config.ts');
const config = readFileSync(configPath, 'utf8');
writeFileSync(configPath, config.replace("env['APP_GREETING']", "env['GREETING']"), 'utf8');
