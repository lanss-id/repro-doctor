// Smoke check: import the package the way a consumer would, through the
// entry point declared in package.json.
import { readFile } from 'node:fs/promises';

const packageUrl = new URL('../package.json', import.meta.url);
const manifest = JSON.parse(await readFile(packageUrl, 'utf8'));
const entry = new URL(`../${manifest.main}`, import.meta.url);

const module = await import(entry.href);
if (typeof module.greet !== 'function') {
  console.error('the entry point does not export greet');
  process.exit(1);
}
console.log(module.greet('world'));
