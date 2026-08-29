// Hidden semantic oracle for case-sensitive-import.
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
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

await check('the project compiles on a case-sensitive filesystem', () => {
  execFileSync('tsc', ['-p', 'tsconfig.json'], { cwd: repo, stdio: 'pipe' });
});

await check('describeDate(new Date(0)) returns "day 1970-01-01"', async () => {
  const entry = path.join(repo, 'dist/index.js');
  if (!existsSync(entry)) {
    throw new Error('dist/index.js was not emitted');
  }
  const loaded = await import(pathToFileURL(entry).href);
  const value = loaded.describeDate(new Date(0));
  if (value !== 'day 1970-01-01') {
    throw new Error(`expected "day 1970-01-01", received ${JSON.stringify(value)}`);
  }
});

await check('the formatting helper still exists as its own module', () => {
  const emitted = path.join(repo, 'dist/utils/format.js');
  const alternative = path.join(repo, 'dist/Utils/Format.js');
  if (!existsSync(emitted) && !existsSync(alternative)) {
    throw new Error('the date formatting helper was folded away instead of being imported');
  }
});

let failed = 0;
for (const [ok, name] of results) {
  if (!ok) failed += 1;
  console.log(`[oracle] ${ok ? 'PASS' : 'FAIL'} ${name}`);
}
console.log(`[oracle] RESULT ${failed === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failed === 0 ? 0 : 1);
