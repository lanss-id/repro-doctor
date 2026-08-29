// Smoke check: load the built package and format a known date.
const module = await import(new URL('../dist/index.js', import.meta.url).href);
const value = module.describeDate(new Date(0));
if (value !== 'day 1970-01-01') {
  console.error(`describeDate returned ${value}`);
  process.exit(1);
}
console.log('ok');
