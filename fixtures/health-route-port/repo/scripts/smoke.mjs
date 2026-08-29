// Smoke check: start the service on the port the platform assigns and ask it
// for the documented health route.
import { spawn } from 'node:child_process';
import { setTimeout as delay } from 'node:timers/promises';

const port = 4599;
const child = spawn(process.execPath, [new URL('../bin/server.mjs', import.meta.url).pathname], {
  env: { ...process.env, PORT: String(port) },
  stdio: 'ignore',
});

try {
  let response = null;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    await delay(100);
    try {
      response = await fetch(`http://127.0.0.1:${port}/health`);
      break;
    } catch {
      response = null;
    }
  }
  if (response === null) {
    console.error(`the service never answered on port ${port}`);
    process.exit(1);
  }
  const body = await response.text();
  if (response.status !== 200 || JSON.parse(body).status !== 'ok') {
    console.error(`GET /health returned ${response.status} ${body}`);
    process.exit(1);
  }
  console.log('ok');
} finally {
  child.kill('SIGKILL');
}
