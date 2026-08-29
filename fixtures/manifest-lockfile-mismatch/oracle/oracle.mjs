// Hidden semantic oracle for manifest-lockfile-mismatch.
// Installs from the lockfile the way CI does, offline, from a clean tree.
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

await check('npm ci installs from the lockfile with no network', () => {
  rmSync(path.join(repo, 'node_modules'), { recursive: true, force: true });
  try {
    execFileSync('npm', ['ci', '--offline', '--no-audit', '--no-fund'], {
      cwd: repo,
      stdio: 'pipe',
      encoding: 'utf8',
    });
  } catch (error) {
    const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    throw new Error(output.split('\n').filter((line) => line.includes('npm error')).slice(0, 3).join(' '));
  }
});

await check('the manifest still declares the vendored dependency', () => {
  const manifest = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
  if (manifest.dependencies?.['@fixture/strings'] !== 'file:vendor/strings') {
    throw new Error('the dependency was removed instead of being locked correctly');
  }
});

await check('the dependency is present in node_modules after the install', () => {
  if (!existsSync(path.join(repo, 'node_modules/@fixture/strings/index.js'))) {
    throw new Error('node_modules/@fixture/strings is missing');
  }
});

await check('the project compiles against the installed dependency', () => {
  execFileSync('tsc', ['-p', 'tsconfig.json'], { cwd: repo, stdio: 'pipe' });
});

await check('label("hello world") returns "Hello World"', async () => {
  const loaded = await import(pathToFileURL(path.join(repo, 'dist/index.js')).href);
  const value = loaded.label('hello world');
  if (value !== 'Hello World') {
    throw new Error(`expected "Hello World", received ${JSON.stringify(value)}`);
  }
});

let failed = 0;
for (const [ok, name] of results) {
  if (!ok) failed += 1;
  console.log(`[oracle] ${ok ? 'PASS' : 'FAIL'} ${name}`);
}
console.log(`[oracle] RESULT ${failed === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failed === 0 ? 0 : 1);
