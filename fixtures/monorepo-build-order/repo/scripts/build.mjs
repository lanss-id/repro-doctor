// Builds every package in the order declared by build.order.json.
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const { order } = JSON.parse(readFileSync(path.join(root, 'build.order.json'), 'utf8'));

for (const name of order) {
  const packageDir = path.join(root, 'packages', name);
  console.log(`building ${name}`);
  execFileSync('tsc', ['-p', 'tsconfig.json'], { cwd: packageDir, stdio: 'inherit' });
}
