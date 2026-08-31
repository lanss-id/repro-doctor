import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdir, rm, symlink } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import { projectRoot } from '../../src/infra/project-root.js';
import { temporaryDirectory } from '../helpers/workspace.js';

/**
 * Installed as a package the command runs through the symlink npm puts in
 * `node_modules/.bin`, so `process.argv[1]` is that link while
 * `import.meta.url` is the file it points at. Comparing them raw made every
 * installed invocation exit zero and print nothing: no error, no output, no
 * signal that anything was wrong.
 *
 * The unit tests could not see it, because they import `main` directly. Only
 * running the built artifact the way a user runs it does.
 */
const linkRoot = await temporaryDirectory('cli-entrypoint');
const entry = path.join(projectRoot(), 'dist', 'src', 'cli', 'index.js');

test('the CLI runs when invoked through a bin symlink, as an install does', async () => {
  const binDir = path.join(linkRoot, 'bin');
  await mkdir(binDir, { recursive: true });
  const link = path.join(binDir, 'repro-doctor');
  await symlink(entry, link);

  const output = execFileSync(process.execPath, [link, 'help'], { encoding: 'utf8' });

  assert.match(output, /Repro Doctor: repair an unfamiliar TypeScript repository/u);
  assert.match(output, /repro-doctor replay <evidence-bundle>/u);
});

test('the CLI still runs when invoked by its real path', () => {
  const output = execFileSync(process.execPath, [entry, 'help'], { encoding: 'utf8' });
  assert.match(output, /Repro Doctor: repair an unfamiliar TypeScript repository/u);
});

test('importing the module does not run the program', async () => {
  // A test that imports main must not have the CLI execute underneath it.
  const script = `
    const m = await import(${JSON.stringify(entry)});
    process.stdout.write(typeof m.main);
  `;
  const output = execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    encoding: 'utf8',
  });
  assert.equal(output, 'function');
});

after(async () => {
  await rm(linkRoot, { recursive: true, force: true });
});

/**
 * A schema rejecting a flag value used to reach the top-level catch, which
 * reported it as `command.crashed` with the raw Zod issue list as JSON. A typo
 * is not a crash, and a stack-trace-shaped answer to one is the difference
 * between a tool someone keeps and one they close.
 */
test('a bad flag value is reported as a usage failure, not as a crash', () => {
  let stderr = '';
  let status = 0;
  try {
    execFileSync(process.execPath, [entry, 'diagnose', 'fixtures/entrypoint-mismatch/repo', '--mode', 'turbo'], {
      encoding: 'utf8',
      stdio: 'pipe',
    });
  } catch (error) {
    const failure = error as { status: number; stderr: string };
    status = failure.status;
    stderr = failure.stderr;
  }

  assert.equal(status, 2, 'a usage error exits 2, the same as a missing flag');
  assert.match(stderr, /command\.failed/u);
  assert.doesNotMatch(stderr, /command\.crashed/u);
  assert.match(stderr, /expected one of "baseline"\|"advanced"/u);
  assert.doesNotMatch(stderr, /"code":/u, 'the raw Zod issue list must not reach the user');
});
