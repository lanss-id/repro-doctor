// Reference repair for monorepo-build-order: build the dependency before the
// package that consumes it.
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repo = process.env.REPO_DIR ?? process.cwd();
const orderPath = path.join(repo, 'build.order.json');
const config = JSON.parse(readFileSync(orderPath, 'utf8'));
config.order = ['core', 'app'];
writeFileSync(orderPath, `${JSON.stringify(config, null, 2)}\n`, 'utf8');
