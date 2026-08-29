// Hidden semantic oracle for health-route-port.
// Boots the service the way the platform does and probes it over HTTP.
import { execFileSync, spawn } from 'node:child_process';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const repo = process.env.REPO_DIR ?? process.cwd();
const results = [];
const port = 41000 + Math.floor(Math.random() * 4000);

async function check(name, fn) {
  try {
    await fn();
    results.push([true, name]);
  } catch (error) {
    results.push([false, `${name}: ${String(error.message).split('\n')[0]}`]);
  }
}

await check('the project compiles', () => {
  execFileSync('tsc', ['-p', 'tsconfig.json'], { cwd: repo, stdio: 'pipe' });
});

let child = null;
async function request(pathname) {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    await delay(100);
    try {
      return await fetch(`http://127.0.0.1:${port}${pathname}`);
    } catch {
      // The server may still be starting.
    }
  }
  throw new Error(`no answer on port ${port} after five seconds`);
}

try {
  child = spawn(process.execPath, [path.join(repo, 'bin/server.mjs')], {
    cwd: repo,
    env: { ...process.env, PORT: String(port) },
    stdio: 'ignore',
  });
  child.on('error', () => {
    // Reported by the checks below as "no answer on port ...".
  });

  await check('the service listens on the port given in PORT', async () => {
    await request('/health');
  });

  await check('GET /health returns 200 with {"status":"ok"}', async () => {
    const response = await request('/health');
    const body = await response.text();
    if (response.status !== 200) {
      throw new Error(`expected 200, received ${response.status}`);
    }
    if (JSON.parse(body).status !== 'ok') {
      throw new Error(`unexpected body ${body}`);
    }
  });

  await check('an unknown path returns 404', async () => {
    const response = await request('/nope');
    if (response.status !== 404) {
      throw new Error(`expected 404, received ${response.status}`);
    }
  });
} finally {
  child?.kill('SIGKILL');
}

let failed = 0;
for (const [ok, name] of results) {
  if (!ok) failed += 1;
  console.log(`[oracle] ${ok ? 'PASS' : 'FAIL'} ${name}`);
}
console.log(`[oracle] RESULT ${failed === 0 ? 'PASS' : 'FAIL'}`);
process.exit(failed === 0 ? 0 : 1);
