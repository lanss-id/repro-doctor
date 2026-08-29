// Reference repair for esm-cjs-mismatch: compile to the module format the
// package declares, instead of emitting CommonJS into an ESM package.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repo = process.env.REPO_DIR ?? process.cwd();
const configPath = path.join(repo, 'tsconfig.json');
const config = JSON.parse(readFileSync(configPath, 'utf8'));
config.compilerOptions.module = 'NodeNext';
config.compilerOptions.moduleResolution = 'NodeNext';
writeFileSync(configPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
