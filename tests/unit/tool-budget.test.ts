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

const workspace = await temporaryDirectory('tool-budget-workspace');
const scratch = await temporaryDirectory('tool-budget-scratch');

after(async () => {
  await removeDirectory(workspace);
  await removeDirectory(scratch);
});

await writeFile(path.join(workspace, 'package.json'), '{"name":"x"}\n', 'utf8');

function newSession(): RepairSession {
  return new RepairSession({
    executor: new LocalTestAdapter({ workspacePath: workspace, commandTimeoutSeconds: 5 }),
    budget: new BudgetTracker(DEFAULT_BUDGET),
    trajectory: new TrajectoryWriter(path.join(scratch, `${Math.random()}.jsonl`)),
    logger: silentLogger,
  });
}

async function callTool(session: RepairSession, name: string, args: unknown): Promise<string> {
  const found = buildTools(session).find((candidate) => candidate.name === name);
  assert.ok(found, `tool not built: ${name}`);
  const output = await found.invoke(new RunContext(), JSON.stringify(args));
  return String(output);
}

// The agent is told its total budget once, in the instructions. Without a live
// count it plans against a number that stopped being true after the first call,
// which is how a correct diagnosis arrives one call after the budget ends.
test('every tool result tells the model how much budget is left', async () => {
  const session = newSession();

  const first = await callTool(session, 'list_files', { directory: '.' });
  assert.match(first, /\[budget\] tool calls left: 11, patch attempts left: 2$/);

  const second = await callTool(session, 'read_file', { path: 'package.json', start_line: null, max_lines: null });
  assert.match(second, /\[budget\] tool calls left: 10, patch attempts left: 2$/);

  const third = await callTool(session, 'propose_patch', {
    rationale: 'name the package',
    files: [{ path: 'package.json', how: 'whole', content: '{"name":"y"}\n', find: '', replacement: '' }],
  });
  assert.match(third, /\[budget\] tool calls left: 9, patch attempts left: 1$/);
});

test('a failed tool call still reports the budget it consumed', async () => {
  const session = newSession();
  const missing = await callTool(session, 'read_file', { path: 'does-not-exist.ts', start_line: null, max_lines: null });
  assert.match(missing, /^error: /);
  assert.match(missing, /\[budget\] tool calls left: 11, patch attempts left: 2$/);
});
