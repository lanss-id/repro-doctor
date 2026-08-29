// Smoke check: import the package through its declared entry point.
import { readFile } from 'node:fs/promises';

const manifest = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const module = await import(new URL(`../${manifest.main}`, import.meta.url).href);
const value = module.describeCatalog([
  { sku: 'a', priceCents: 100 },
  { sku: 'b', priceCents: 250 },
]);
if (value !== '2 item(s), 350 cents') {
  console.error(`describeCatalog returned ${value}`);
  process.exit(1);
}
console.log('ok');
