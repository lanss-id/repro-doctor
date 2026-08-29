// Smoke check: import through the declared entry point and honour the
// documented environment variable.
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const module = await import(new URL(`../${manifest.main}`, import.meta.url).href);

const custom = module.greet({ GREETING: 'hi' }, 'world');
if (custom !== 'hi world') {
  console.error(`greet with GREETING set returned ${custom}`);
  process.exit(1);
}

const fallback = module.greet({}, 'world');
if (fallback !== 'hello world') {
  console.error(`greet without GREETING returned ${fallback}`);
  process.exit(1);
}

console.log('ok');
