import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { taskMessage } from '../../src/agent/instructions.js';
import { loadTaskContext } from '../../src/agent/task-context.js';
import { PathSafetyError } from '../../src/infra/fs/paths.js';
import { removeDirectory, temporaryDirectory } from '../helpers/workspace.js';

test('a repository-local task is redacted and included in the model task', async () => {
  const root = await temporaryDirectory('task-context');
  try {
    await writeFile(
      path.join(root, 'REPAIR_TASK.md'),
      'Fix browser opening with apiKey=sk-test-secret-value\n',
      'utf8',
    );

    const context = await loadTaskContext(root, 'REPAIR_TASK.md');
    const message = taskMessage('example', context);

    assert.equal(context.relativePath, 'REPAIR_TASK.md');
    assert.doesNotMatch(message, /sk-test-secret-value/u);
    assert.match(message, /Fix browser opening/u);
    assert.match(message, /Do not edit it/u);
  } finally {
    await removeDirectory(root);
  }
});

test('a task file may not escape the repository', async () => {
  const root = await temporaryDirectory('task-context-escape');
  try {
    const repo = path.join(root, 'repo');
    await mkdir(repo);
    await writeFile(path.join(root, 'outside.md'), 'outside\n', 'utf8');

    await assert.rejects(() => loadTaskContext(repo, '../outside.md'), PathSafetyError);
  } finally {
    await removeDirectory(root);
  }
});

test('an oversized task file is rejected before it reaches the model', async () => {
  const root = await temporaryDirectory('task-context-size');
  try {
    await writeFile(path.join(root, 'TASK.md'), 'x'.repeat(16 * 1024 + 1), 'utf8');

    await assert.rejects(
      () => loadTaskContext(root, 'TASK.md'),
      /task file exceeds 16384 bytes/u,
    );
  } finally {
    await removeDirectory(root);
  }
});
