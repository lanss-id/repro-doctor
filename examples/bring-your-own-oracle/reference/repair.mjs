// The reference repair for duration-kit, kept so anyone can confirm the oracle
// is satisfiable rather than merely strict. Repro Doctor never sees this file.
//
// Usage: REPO_DIR=<path to a copy of repo/> node reference/repair.mjs
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const repo = process.env.REPO_DIR;
if (!repo) {
  console.error('set REPO_DIR to a copy of examples/bring-your-own-oracle/repo');
  process.exit(2);
}

const target = path.join(repo, 'src/duration.ts');
const source = readFileSync(target, 'utf8');

const fixed = source
  .replace('const PAIR = /(\\d+)(h|m|s)/u;', 'const PAIR = /(\\d+)(h|m|s)/gu;')
  .replace(
    `export function parseDuration(input: string): number {
  const match = PAIR.exec(input);
  if (match === null) {
    throw new Error(\`not a duration: \${JSON.stringify(input)}\`);
  }
  const amount = Number(match[1]);
  const unit = UNIT_MS[match[2] ?? ''];
  if (unit === undefined) {
    throw new Error(\`not a duration: \${JSON.stringify(input)}\`);
  }
  return amount * unit;
}`,
    `export function parseDuration(input: string): number {
  const pairs = [...input.matchAll(PAIR)];
  if (pairs.length === 0 || pairs.map((pair) => pair[0]).join('') !== input) {
    throw new Error(\`not a duration: \${JSON.stringify(input)}\`);
  }
  return pairs.reduce((total, pair) => {
    const unit = UNIT_MS[pair[2] ?? ''];
    if (unit === undefined) {
      throw new Error(\`not a duration: \${JSON.stringify(input)}\`);
    }
    return total + Number(pair[1]) * unit;
  }, 0);
}`,
  );

if (fixed === source) {
  console.error('the reference repair did not apply; src/duration.ts is not the shape it expects');
  process.exit(1);
}

writeFileSync(target, fixed, 'utf8');
console.log('applied the reference repair to src/duration.ts');
