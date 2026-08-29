// Smoke check: load the built package and call it.
const module = await import(new URL('../dist/index.js', import.meta.url).href);
if (module.describeTotal(12.5) !== 'total $12.50') {
  console.error('describeTotal returned the wrong value');
  process.exit(1);
}
console.log('ok');
