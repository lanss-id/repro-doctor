// Hidden semantic oracle for esm-cjs-mismatch.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
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

await check('the project compiles', () => {
  execFileSync('tsc', ['-p', 'tsconfig.json'], { cwd: repo, stdio: 'pipe' });
});

await check('the package is still declared as ESM', () => {
  const manifest = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
  if (manifest.type !== 'module') {
    throw new Error('package.json no longer declares "type": "module"');
  }
});

await check('the build output loads as an ES module', async () => {
  const entry = path.join(repo, 'dist/index.js');
  if (!existsSync(entry)) {
    throw new Error('dist/index.js was not emitted');
  }
  await import(pathToFileURL(entry).href);
});

await check('describeTotal(12.5) returns "total $12.50"', async () => {
  const loaded = await import(pathToFileURL(path.join(repo, 'dist/index.js')).href);
  const value = loaded.describeTotal(12.5);
  if (value !== 'total $12.50') {
    throw new Error(`expected "total $12.50", received ${JSON.stringify(value)}`);
  }
});

await check('the helper module is still a separate module', () => {
  if (!existsSync(path.join(repo, 'src/format.ts'))) {
    throw new Error('src/format.ts is gone');
  }
});

let failed = 0;
for (const [ok, name] of results) {
  if (!ok) failed += 1;
  console.log(`[oracle] ${ok ? 'PASS' : 'FAIL'} ${name}`);
}
console.log(`[oracle] RESULT ${failed === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failed === 0 ? 0 : 1);
