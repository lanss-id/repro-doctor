import assert from 'node:assert/strict';
import { mkdir, symlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { ReproDoctorError } from '../../src/domain/failure.js';
import { LOCAL_ADAPTER_ENV, createExecutor } from '../../src/infra/exec/factory.js';
import { LocalTestAdapter } from '../../src/infra/exec/local.js';
import { removeDirectory, temporaryDirectory } from '../helpers/workspace.js';

async function adapter(): Promise<{ executor: LocalTestAdapter; workspace: string }> {
  const workspace = await temporaryDirectory('executor');
  await mkdir(path.join(workspace, 'sub'), { recursive: true });
  await writeFile(path.join(workspace, 'sub', 'hello.txt'), 'hello\n', 'utf8');
  return {
    executor: new LocalTestAdapter({ workspacePath: workspace, commandTimeoutSeconds: 10 }),
    workspace,
  };
}

test('the adapter runs a real process and reports its exit code', async () => {
  const { executor, workspace } = await adapter();
  try {
    const outcome = await executor.run({ command: 'node', args: ['--version'], timeoutMs: 20_000 });
    assert.equal(outcome.kind, 'exited');
    if (outcome.kind !== 'exited') return;
    assert.equal(outcome.exitCode, 0);
    assert.match(outcome.stdout.trim(), /^v\d+\./u);

    const failing = await executor.run({
      command: 'node',
      args: ['-e', 'process.exit(3)'],
      timeoutMs: 20_000,
    });
    assert.equal(failing.kind === 'exited' && failing.exitCode, 3);
  } finally {
    await removeDirectory(workspace);
  }
});

test('a command that outlives its timeout is killed and reported as timed out', async () => {
  const { executor, workspace } = await adapter();
  try {
    const started = Date.now();
    const outcome = await executor.run({
      command: 'node',
      args: ['-e', 'setTimeout(() => {}, 60000)'],
      timeoutMs: 1500,
    });
    const elapsed = Date.now() - started;
    assert.equal(outcome.kind, 'timed-out');
    assert.ok(elapsed < 20_000, `the timeout did not stop the process: ${elapsed}ms`);
  } finally {
    await removeDirectory(workspace);
  }
});

test('output produced before a timeout is still captured', async () => {
  const { executor, workspace } = await adapter();
  try {
    const outcome = await executor.run({
      command: 'node',
      args: ['-e', 'console.log("partial output"); setTimeout(() => {}, 60000)'],
      timeoutMs: 2000,
    });
    assert.equal(outcome.kind, 'timed-out');
    if (outcome.kind !== 'timed-out') return;
    assert.match(outcome.stdout, /partial output/u);
  } finally {
    await removeDirectory(workspace);
  }
});

test('commands outside the allowlist are refused', async () => {
  const { executor, workspace } = await adapter();
  try {
    await assert.rejects(
      () => executor.run({ command: 'curl', args: ['https://example.com'], timeoutMs: 1000 }),
      ReproDoctorError,
    );
    await assert.rejects(
      () => executor.run({ command: 'sh', args: ['-c', 'echo hi'], timeoutMs: 1000 }),
      ReproDoctorError,
    );
  } finally {
    await removeDirectory(workspace);
  }
});

test('no API key from the host reaches a sandboxed process', async () => {
  const { executor, workspace } = await adapter();
  const previous = process.env['OPENAI_API_KEY'];
  process.env['OPENAI_API_KEY'] = 'sk-test-value-that-must-not-leak-0123456789';
  try {
    const outcome = await executor.run({
      command: 'node',
      args: ['-e', 'console.log(process.env.OPENAI_API_KEY ?? "unset")'],
      timeoutMs: 20_000,
    });
    assert.equal(outcome.kind === 'exited' && outcome.stdout.trim(), 'unset');
  } finally {
    if (previous === undefined) {
      delete process.env['OPENAI_API_KEY'];
    } else {
      process.env['OPENAI_API_KEY'] = previous;
    }
    await removeDirectory(workspace);
  }
});

test('a working directory outside the workspace is refused', async () => {
  const { executor, workspace } = await adapter();
  try {
    await assert.rejects(
      () => executor.run({ command: 'node', args: ['--version'], workdir: '../..', timeoutMs: 1000 }),
      ReproDoctorError,
    );
    const ok = await executor.run({
      command: 'node',
      args: ['-e', 'console.log(process.cwd())'],
      workdir: 'sub',
      timeoutMs: 20_000,
    });
    assert.equal(ok.kind === 'exited' && ok.stdout.trim(), path.join(workspace, 'sub'));
  } finally {
    await removeDirectory(workspace);
  }
});

test('a sibling directory whose name merely starts with the workspace path is refused', async () => {
  const { executor, workspace } = await adapter();
  // /tmp/repro-doctor-executor-XYZ-escape starts with the workspace path as a
  // string, and is a different directory. A raw prefix check would accept it.
  const sibling = `${workspace}-escape`;
  await mkdir(path.join(sibling, 'inside'), { recursive: true });
  try {
    await assert.rejects(
      () =>
        executor.run({
          command: 'node',
          args: ['--version'],
          workdir: `../${path.basename(sibling)}/inside`,
          timeoutMs: 5000,
        }),
      ReproDoctorError,
    );
    await assert.rejects(
      () =>
        executor.run({
          command: 'node',
          args: ['--version'],
          workdir: sibling,
          timeoutMs: 5000,
        }),
      ReproDoctorError,
    );
  } finally {
    await removeDirectory(sibling);
    await removeDirectory(workspace);
  }
});

test('a workdir that is a symlink out of the workspace is refused', async () => {
  const { executor, workspace } = await adapter();
  const outside = await temporaryDirectory('executor-outside');
  try {
    await symlink(outside, path.join(workspace, 'link'));
    await assert.rejects(
      () => executor.run({ command: 'node', args: ['--version'], workdir: 'link', timeoutMs: 5000 }),
      ReproDoctorError,
    );
  } finally {
    await removeDirectory(outside);
    await removeDirectory(workspace);
  }
});

test('the local adapter is refused unless it is explicitly enabled', async () => {
  const workspace = await temporaryDirectory('executor-gate');
  const previous = process.env[LOCAL_ADAPTER_ENV];
  delete process.env[LOCAL_ADAPTER_ENV];
  try {
    await assert.rejects(
      () =>
        createExecutor({
          kind: 'local-test-adapter',
          workspacePath: workspace,
          commandTimeoutSeconds: 5,
          purpose: 'repair',
        }),
      (error: unknown) =>
        error instanceof ReproDoctorError && error.reason === 'sandbox-unavailable',
    );
    const enabled = await createExecutor({
      kind: 'local-test-adapter',
      workspacePath: workspace,
      commandTimeoutSeconds: 5,
      purpose: 'repair',
      allowLocalAdapter: true,
    });
    assert.equal(enabled.kind, 'local-test-adapter');
    assert.equal(enabled.profile.productionSafe, false);
  } finally {
    if (previous !== undefined) {
      process.env[LOCAL_ADAPTER_ENV] = previous;
    }
    await removeDirectory(workspace);
  }
});
