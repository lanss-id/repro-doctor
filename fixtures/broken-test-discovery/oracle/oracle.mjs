// Hidden semantic oracle for broken-test-discovery.
// The repository's own check exits zero while running nothing, so this oracle
// counts the tests that actually ran instead of trusting the exit code.
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, existsSync } from 'node:fs';
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

let output = '';
await check('npm test exits zero', () => {
  try {
    output = execFileSync('npm', ['test', '--silent'], {
      cwd: repo,
      stdio: 'pipe',
      encoding: 'utf8',
      env: { ...process.env, NPM_CONFIG_UPDATE_NOTIFIER: 'false' },
    });
  } catch (error) {
    output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
    throw new Error(`npm test failed: ${output.split('\n').slice(-5).join(' ')}`);
  }
});

function countFrom(label) {
  const match = new RegExp(`(?:#|\\u2139)\\s*${label}\\s+(\\d+)`, 'u').exec(output);
  return match === null ? null : Number(match[1]);
}

await check('npm test runs at least two tests', () => {
  const passed = countFrom('pass');
  if (passed === null) {
    throw new Error('the test runner reported no pass count at all');
  }
  if (passed < 2) {
    throw new Error(`only ${passed} test(s) ran; the suite has two`);
  }
});

await check('no test failed', () => {
  const failedCount = countFrom('fail');
  if (failedCount !== 0) {
    throw new Error(`the runner reported ${failedCount} failing test(s)`);
  }
});

await check('the tests still exercise the library', () => {
  const testDir = path.join(repo, 'tests');
  if (!existsSync(testDir)) {
    throw new Error('the tests directory is gone');
  }
  const sources = readdirSync(testDir)
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => readFileSync(path.join(testDir, name), 'utf8'))
    .join('\n');
  if (!sources.includes('assert') || !sources.includes('dist/index.js')) {
    throw new Error('the test files no longer assert against the built library');
  }
});

await check('sum and mean still behave as documented', async () => {
  const loaded = await import(pathToFileURL(path.join(repo, 'dist/index.js')).href);
  if (loaded.sum([1, 2, 3]) !== 6) {
    throw new Error('sum is wrong');
  }
  if (loaded.mean([2, 4]) !== 3) {
    throw new Error('mean is wrong');
  }
});

let failed = 0;
for (const [ok, name] of results) {
  if (!ok) failed += 1;
  console.log(`[oracle] ${ok ? 'PASS' : 'FAIL'} ${name}`);
}
console.log(`[oracle] RESULT ${failed === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failed === 0 ? 0 : 1);
