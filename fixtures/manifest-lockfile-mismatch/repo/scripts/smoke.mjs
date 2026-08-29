// Smoke check: the built package uses the vendored dependency.
const module = await import(new URL('../dist/index.js', import.meta.url).href);
const value = module.label('hello world');
if (value !== 'Hello World') {
  console.error(`label returned ${value}`);
  process.exit(1);
}
console.log('ok');
