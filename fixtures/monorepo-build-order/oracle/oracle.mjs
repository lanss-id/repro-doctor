// Hidden semantic oracle for monorepo-build-order.
// A clean build has to succeed: the dist directories are removed first, so an
// already-built tree cannot hide a wrong order.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = process.env.REPO_DIR ?? process.cwd();
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push([true, name]);
  } catch (error) {
    results.push([false, `${name}: ${String(error.message).split('\n')[0]}`]);
  }
}

await check('a clean build of every package succeeds', () => {
  rmSync(path.join(repo, 'packages/core/dist'), { recursive: true, force: true });
  rmSync(path.join(repo, 'packages/app/dist'), { recursive: true, force: true });
  execFileSync('node', ['scripts/build.mjs'], { cwd: repo, stdio: 'pipe' });
});

await check('both packages are still part of the build', () => {
  const order = JSON.parse(readFileSync(path.join(repo, 'build.order.json'), 'utf8')).order;
  if (!Array.isArray(order) || !order.includes('core') || !order.includes('app')) {
    throw new Error(`build.order.json no longer builds both packages: ${JSON.stringify(order)}`);
  }
});

await check('quote(1000) returns "900 cents"', async () => {
  const entry = path.join(repo, 'packages/app/dist/index.js');
  if (!existsSync(entry)) {
    throw new Error('packages/app/dist/index.js was not emitted');
  }
  const loaded = await import(pathToFileURL(entry).href);
  const value = loaded.quote(1000);
  if (value !== '900 cents') {
    throw new Error(`expected "900 cents", received ${JSON.stringify(value)}`);
  }
});

await check('the app still uses the core package rather than a local copy', () => {
  const source = readFileSync(path.join(repo, 'packages/app/src/index.ts'), 'utf8');
  if (!source.includes('core/dist/index.js')) {
    throw new Error('packages/app no longer imports packages/core');
  }
});

let failed = 0;
for (const [ok, name] of results) {
  if (!ok) failed += 1;
  console.log(`[oracle] ${ok ? 'PASS' : 'FAIL'} ${name}`);
}
console.log(`[oracle] RESULT ${failed === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failed === 0 ? 0 : 1);
