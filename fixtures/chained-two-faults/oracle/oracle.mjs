// Hidden semantic oracle for chained-two-faults.
// Both faults have to be fixed. Repairing either one alone still fails here.
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

let manifest = {};
await check('fault one: the declared entry point exists after the build', () => {
  manifest = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
  if (typeof manifest.main !== 'string' || !existsSync(path.join(repo, manifest.main))) {
    throw new Error(`main is ${JSON.stringify(manifest.main)}, which the build does not produce`);
  }
});

let loaded = null;
await check('the entry point exports greet', async () => {
  loaded = await import(pathToFileURL(path.join(repo, manifest.main ?? 'dist/index.js')).href);
  if (typeof loaded.greet !== 'function') {
    throw new Error('greet is not exported');
  }
});

await check('fault two: GREETING is the variable that is read', () => {
  const value = loaded.greet({ GREETING: 'hi' }, 'world');
  if (value !== 'hi world') {
    throw new Error(`expected "hi world", received ${JSON.stringify(value)}`);
  }
});

await check('the greeting falls back to "hello" when nothing is set', () => {
  const value = loaded.greet({}, 'world');
  if (value !== 'hello world') {
    throw new Error(`expected "hello world", received ${JSON.stringify(value)}`);
  }
});

await check('the undocumented variable is no longer honoured', () => {
  const value = loaded.greet({ APP_GREETING: 'ignored' }, 'world');
  if (value !== 'hello world') {
    throw new Error(`APP_GREETING still changes the greeting: ${JSON.stringify(value)}`);
  }
});

let failed = 0;
for (const [ok, name] of results) {
  if (!ok) failed += 1;
  console.log(`[oracle] ${ok ? 'PASS' : 'FAIL'} ${name}`);
}
console.log(`[oracle] RESULT ${failed === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failed === 0 ? 0 : 1);
