// Smoke check: the environment contract in README.md and .env.example.
const { loadConfig } = await import(new URL('../dist/index.js', import.meta.url).href);

const config = loadConfig({ PORT: '8080' });
if (config.port !== 8080) {
  console.error(`expected port 8080, received ${config.port}`);
  process.exit(1);
}

let rejected = false;
try {
  loadConfig({});
} catch {
  rejected = true;
}
if (!rejected) {
  console.error('loadConfig accepted an environment with no PORT');
  process.exit(1);
}

console.log('ok');
