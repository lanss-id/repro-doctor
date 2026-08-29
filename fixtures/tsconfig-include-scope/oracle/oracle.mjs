// Hidden semantic oracle for tsconfig-include-scope.
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

await check('the project compiles with both source directories in scope', () => {
  execFileSync('tsc', ['-p', 'tsconfig.json'], { cwd: repo, stdio: 'pipe' });
});

let manifest = {};
await check('package.json declares an entry point that exists', () => {
  manifest = JSON.parse(readFileSync(path.join(repo, 'package.json'), 'utf8'));
  if (typeof manifest.main !== 'string' || !existsSync(path.join(repo, manifest.main))) {
    throw new Error(`main is ${JSON.stringify(manifest.main)}, which is not on disk after the build`);
  }
});

await check('describeCatalog sums the catalog through the entry point', async () => {
  const loaded = await import(pathToFileURL(path.join(repo, manifest.main ?? 'dist/index.js')).href);
  const value = loaded.describeCatalog([
    { sku: 'a', priceCents: 100 },
    { sku: 'b', priceCents: 250 },
  ]);
  if (value !== '2 item(s), 350 cents') {
    throw new Error(`expected "2 item(s), 350 cents", received ${JSON.stringify(value)}`);
  }
});

await check('the shared library is still a separate module under src/lib', () => {
  if (!existsSync(path.join(repo, 'src/lib/catalog.ts'))) {
    throw new Error('src/lib/catalog.ts is gone; the library was inlined instead of included in the build');
  }
});

let failed = 0;
for (const [ok, name] of results) {
  if (!ok) failed += 1;
  console.log(`[oracle] ${ok ? 'PASS' : 'FAIL'} ${name}`);
}
console.log(`[oracle] RESULT ${failed === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failed === 0 ? 0 : 1);
