// Smoke check: use the app package the way the service does.
const module = await import(new URL('../packages/app/dist/index.js', import.meta.url).href);
const value = module.quote(1000);
if (value !== '900 cents') {
  console.error(`quote returned ${value}`);
  process.exit(1);
}
console.log('ok');
