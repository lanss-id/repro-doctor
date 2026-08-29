// Reference repair for tsconfig-include-scope: widen the compilation scope to
// the whole source tree, then follow the resulting output layout in package.json.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repo = process.env.REPO_DIR ?? process.cwd();

const configPath = path.join(repo, 'tsconfig.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
config.compilerOptions.rootDir = 'src';
config.include = ['src/**/*'];
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');

const manifestPath = path.join(repo, 'package.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
manifest.main = 'dist/app/index.js';
writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
