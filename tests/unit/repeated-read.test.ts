import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import { RunContext } from '@openai/agents';
import { BudgetTracker } from '../../src/agent/budget-tracker.js';
import { RepairSession } from '../../src/agent/session.js';
import { buildTools } from '../../src/agent/tools.js';
import { DEFAULT_BUDGET } from '../../src/domain/budget.js';
import { TrajectoryWriter } from '../../src/infra/artifacts.js';
import { LocalTestAdapter } from '../../src/infra/exec/local.js';
import { silentLogger } from '../../src/infra/log.js';
import { removeDirectory, temporaryDirectory } from '../helpers/workspace.js';

const workspace = await temporaryDirectory('repeated-read-workspace');
const scratch = await temporaryDirectory('repeated-read-scratch');

after(async () => {
  await removeDirectory(workspace);
  await removeDirectory(scratch);
});

const sixtyLines = `${Array.from({ length: 60 }, (_, index) => `line ${index + 1}`).join('\n')}\n`;

function newSession(): RepairSession {
  return new RepairSession({
    executor: new LocalTestAdapter({ workspacePath: workspace, commandTimeoutSeconds: 5 }),
    budget: new BudgetTracker({ ...DEFAULT_BUDGET, maxToolCalls: 20 }),
    trajectory: new TrajectoryWriter(path.join(scratch, `${Math.random()}.jsonl`)),
    logger: silentLogger,
  });
}

async function read(session: RepairSession, file: string, start: number, count: number): Promise<string> {
  const found = buildTools(session).find((candidate) => candidate.name === 'read_file');
  assert.ok(found);
  return String(
    await found.invoke(new RunContext(), JSON.stringify({ path: file, start_line: start, max_lines: count })),
  );
}

// The AgentInspect follow-up spent 12 of its 38 calls on lines it already had,
// paging a 64-line file in windows of ten after reading it whole. Two earlier
// windows together covering the third is the shape that went unnoticed.
test('a window made entirely of lines already returned says so, and is still charged', async () => {
  await writeFile(path.join(workspace, 'serve.ts'), sixtyLines, 'utf8');
  const session = newSession();

  const first = await read(session, 'serve.ts', 1, 40);
  const second = await read(session, 'serve.ts', 41, 40);
  assert.doesNotMatch(first, /\[seen\]/);
  assert.doesNotMatch(second, /\[seen\]/);

  const repeat = await read(session, './serve.ts', 30, 20);
  assert.match(repeat, /serve\.ts: lines 30-49 of 60/);
  assert.match(repeat, /line 30\n/, 'the lines are still served');
  assert.match(repeat, /\[seen\] lines 30-49 were all returned by earlier reads/);
  assert.match(repeat, /tool calls left: 17,/);
});

test('one line not yet returned makes the window new', async () => {
  await writeFile(path.join(workspace, 'open.ts'), sixtyLines, 'utf8');
  const session = newSession();

  await read(session, 'open.ts', 1, 10);
  const extended = await read(session, 'open.ts', 5, 7);

  assert.match(extended, /lines 5-11 of 60/);
  assert.doesNotMatch(extended, /\[seen\]/);
});

test('after the file changes, the same lines are new again', async () => {
  await writeFile(path.join(workspace, 'studio.ts'), sixtyLines, 'utf8');
  const session = newSession();

  await read(session, 'studio.ts', 1, 10);
  await session.proposePatch(
    [{ path: 'studio.ts', how: 'replace', find: 'line 5\n', replacement: 'line five\n' }],
    'rename one line',
  );
  const reread = await read(session, 'studio.ts', 1, 10);

  assert.match(reread, /line five/);
  assert.doesNotMatch(reread, /\[seen\]/);
});
