// Hidden semantic oracle for env-contract.
import { execFileSync } from 'node:child_process';
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

let loadConfig = null;
await check('the entry point exports loadConfig', async () => {
  const loaded = await import(pathToFileURL(path.join(repo, 'dist/index.js')).href);
  if (typeof loaded.loadConfig !== 'function') {
    throw new Error('loadConfig is not exported');
  }
  loadConfig = loaded.loadConfig;
});

await check('PORT is read from the documented variable', () => {
  const config = loadConfig({ PORT: '8080' });
  if (config.port !== 8080) {
    throw new Error(`expected port 8080, received ${JSON.stringify(config.port)}`);
  }
});

await check('REPORT_PREFIX defaults to "report" and is honoured when set', () => {
  if (loadConfig({ PORT: '8080' }).prefix !== 'report') {
    throw new Error('the default prefix is wrong');
  }
  if (loadConfig({ PORT: '8080', REPORT_PREFIX: 'daily' }).prefix !== 'daily') {
    throw new Error('REPORT_PREFIX is ignored');
  }
});

await check('a missing PORT is rejected with an error naming the variable', () => {
  let message = null;
  try {
    loadConfig({});
  } catch (error) {
    message = String(error.message);
  }
  if (message === null) {
    throw new Error('loadConfig accepted an environment with no PORT');
  }
  if (!message.includes('PORT')) {
    throw new Error(`the error does not name PORT: ${message}`);
  }
});

await check('a non-numeric PORT is rejected', () => {
  let threw = false;
  try {
    loadConfig({ PORT: 'not-a-number' });
  } catch {
    threw = true;
  }
  if (!threw) {
    throw new Error('loadConfig accepted a PORT that is not a number');
  }
});

let failed = 0;
for (const [ok, name] of results) {
  if (!ok) failed += 1;
  console.log(`[oracle] ${ok ? 'PASS' : 'FAIL'} ${name}`);
}
console.log(`[oracle] RESULT ${failed === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failed === 0 ? 0 : 1);
