import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import test, { after } from 'node:test';
import { RunContext } from '@openai/agents';
import { BudgetTracker } from '../../src/agent/budget-tracker.js';
import { MAX_WRITE_BYTES, RepairSession } from '../../src/agent/session.js';
import { buildTools } from '../../src/agent/tools.js';
import { DEFAULT_BUDGET } from '../../src/domain/budget.js';
import { TrajectoryWriter } from '../../src/infra/artifacts.js';
import { LocalTestAdapter } from '../../src/infra/exec/local.js';
import { silentLogger } from '../../src/infra/log.js';
import { removeDirectory, temporaryDirectory } from '../helpers/workspace.js';

/**
 * The shape of the commander run that failed: a fault a few hundred lines into
 * a file far larger than one patch may write whole.
 *
 * Before this, both halves were impossible. The read returned the first four
 * per cent of the file and the model could not see line 246; and even having
 * seen it, a whole-file write of 83KB is refused, so there was no way to
 * submit the one-token fix. examples/real-world-commander/RESULT.md is the run
 * this reconstructs.
 */
const FAULT_LINE = 246;
const FAULT = '  const wanted = args.length + 1;';
const REPAIRED = '  const wanted = args.length;';

const body = Array.from({ length: 2787 }, (_, index) =>
  index + 1 === FAULT_LINE ? FAULT : `  filler(${index + 1}); // padding to make this file realistically large`,
);

const workspace = await temporaryDirectory('large-file-workspace');
const scratch = await temporaryDirectory('large-file-scratch');

after(async () => {
  await removeDirectory(workspace);
  await removeDirectory(scratch);
});

await writeFile(path.join(workspace, 'command.js'), `${body.join('\n')}\n`, 'utf8');

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
  return String(await found.invoke(new RunContext(), JSON.stringify(args)));
}

test('the file under test is larger than one patch may write whole', async () => {
  const size = (await readFile(path.join(workspace, 'command.js'))).length;

  assert.ok(size > MAX_WRITE_BYTES, `expected a file over ${MAX_WRITE_BYTES} bytes, got ${size}`);
});

test('a fault past the first window can be reached by asking for it', async () => {
  const session = newSession();

  const first = await callTool(session, 'read_file', {
    path: 'command.js',
    start_line: null,
    max_lines: null,
  });
  assert.doesNotMatch(first, /wanted = args\.length/, 'the fault should not be in the first window');
  assert.match(first, /command\.js: lines 1-\d+ of 2787/);
  assert.match(first, /read them with start_line=/);

  const second = await callTool(session, 'read_file', {
    path: 'command.js',
    start_line: FAULT_LINE - 2,
    max_lines: 5,
  });
  assert.match(second, /command\.js: lines 244-248 of 2787/);
  assert.ok(second.includes(FAULT), 'the fault should be inside the requested window');
});

test('a file too large to write whole is repaired by replacing one block', async () => {
  const session = newSession();

  const refused = await callTool(session, 'propose_patch', {
    rationale: 'rewrite the file',
    files: [{ path: 'command.js', how: 'whole', content: 'x'.repeat(MAX_WRITE_BYTES + 1), find: '', replacement: '' }],
  });
  assert.match(refused, /exceeds 65536 bytes/);
  assert.match(refused, /Replace one block with find and replacement/);

  const accepted = await callTool(session, 'propose_patch', {
    rationale: 'the count is off by one',
    files: [{ path: 'command.js', how: 'replace', content: '', find: FAULT, replacement: REPAIRED }],
  });
  assert.match(accepted, /wrote 1 file\(s\): command\.js/);

  const onDisk = (await readFile(path.join(workspace, 'command.js'), 'utf8')).split('\n');
  assert.equal(onDisk[FAULT_LINE - 1], REPAIRED);
  assert.equal(onDisk.length, body.length + 1, 'the rest of the file should be untouched');
});

test('an anchor that is not unique costs the attempt and says what to add', async () => {
  const session = newSession();

  const output = await callTool(session, 'propose_patch', {
    rationale: 'change the padding',
    files: [{ path: 'command.js', how: 'replace', content: '', find: '  filler(', replacement: '  other(' }],
  });

  assert.match(output, /appears \d+ times/);
  assert.match(output, /Include more surrounding lines/);
});
