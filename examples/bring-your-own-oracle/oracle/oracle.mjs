// Hidden semantic oracle for duration-kit.
//
// This file is what a user of Repro Doctor writes for their own repository. It
// lives outside repo/, is mounted read-only at /oracle, and runs only after the
// repair agent's session has ended, against a fresh copy of the repaired tree.
//
// It encodes the contract the repository's README promises, not the shape of a
// diff. duration-kit's own test suite passes while the contract is broken, which
// is exactly the situation an independent check exists for.
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

await check('the project compiles', () => {
  execFileSync('tsc', ['-p', 'tsconfig.json'], { cwd: repo, stdio: 'pipe' });
});

let parseDuration;
let formatDuration;

await check('the entry point exports parseDuration and formatDuration', async () => {
  const entry = pathToFileURL(path.join(repo, 'dist/index.js')).href;
  const loaded = await import(entry);
  if (typeof loaded.parseDuration !== 'function' || typeof loaded.formatDuration !== 'function') {
    throw new Error('dist/index.js does not export both functions');
  }
  parseDuration = loaded.parseDuration;
  formatDuration = loaded.formatDuration;
});

const CASES = [
  ['90s', 90_000],
  ['30m', 1_800_000],
  ['2h', 7_200_000],
];

await check('single unit durations are still parsed', () => {
  for (const [input, expected] of CASES) {
    const actual = parseDuration(input);
    if (actual !== expected) {
      throw new Error(`${input} returned ${actual}, the README says ${expected}`);
    }
  }
});

await check('every unit in a compound duration is added up', () => {
  const compound = [
    ['1h30m', 5_400_000],
    ['2h15m30s', 8_130_000],
    ['5m30s', 330_000],
  ];
  for (const [input, expected] of compound) {
    const actual = parseDuration(input);
    if (actual !== expected) {
      throw new Error(`${input} returned ${actual}, the README says ${expected}`);
    }
  }
});

await check('a string that is not a whole sequence of pairs is rejected', () => {
  for (const bad of ['', '1h30', 'h', '1d', 'about an hour']) {
    let threw = false;
    try {
      parseDuration(bad);
    } catch {
      threw = true;
    }
    if (!threw) {
      throw new Error(`${JSON.stringify(bad)} was parsed instead of rejected`);
    }
  }
});

await check('formatDuration is still the inverse for whole units', () => {
  for (const input of ['1h30m', '2h15m30s', '45s']) {
    const round = formatDuration(parseDuration(input));
    if (round !== input) {
      throw new Error(`${input} rendered back as ${round}`);
    }
  }
});

await check('the repository still has its own test suite', () => {
  if (!existsSync(path.join(repo, 'tests/duration.test.mjs'))) {
    throw new Error('tests/duration.test.mjs is gone');
  }
  execFileSync('node', ['--test', 'tests/duration.test.mjs'], { cwd: repo, stdio: 'pipe' });
});

let failed = 0;
for (const [ok, name] of results) {
  if (!ok) failed += 1;
  console.log(`[oracle] ${ok ? 'PASS' : 'FAIL'} ${name}`);
}
console.log(`[oracle] RESULT ${failed === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failed === 0 ? 0 : 1);
