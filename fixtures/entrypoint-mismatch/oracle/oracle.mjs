// Hidden semantic oracle for entrypoint-mismatch.
// Lives outside repo/, is mounted read-only, and only runs after the repair
// agent's session has ended. It judges behaviour, not the shape of the diff.
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
await check('package.json is still valid JSON', () => {
  manifest = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
  if (manifest.type !== 'module') {
    throw new Error('the package must stay ESM');
  }
});

await check('the declared entry point exists on disk', () => {
  if (typeof manifest.main !== 'string') {
    throw new Error('package.json has no main field');
  }
  if (!existsSync(path.join(repo, manifest.main))) {
    throw new Error(`main points at ${manifest.main}, which the build does not produce`);
  }
});

await check('greet("world") returns "hello world" through the entry point', async () => {
  const entry = pathToFileURL(path.join(repo, manifest.main ?? 'dist/index.js')).href;
  const loaded = await import(entry);
  if (typeof loaded.greet !== 'function') {
    throw new Error('the entry point does not export greet');
  }
  const value = loaded.greet('world');
  if (value !== 'hello world') {
    throw new Error(`expected "hello world", received ${JSON.stringify(value)}`);
  }
});

await check('the source of greet was not deleted', () => {
  if (!existsSync(path.join(repo, 'src/index.ts'))) {
    throw new Error('src/index.ts is gone');
  }
});

let failed = 0;
for (const [ok, name] of results) {
  if (!ok) failed += 1;
  console.log(`[oracle] ${ok ? 'PASS' : 'FAIL'} ${name}`);
}
console.log(`[oracle] RESULT ${failed === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failed === 0 ? 0 : 1);
