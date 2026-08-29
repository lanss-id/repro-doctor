import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';
import { DEFAULT_BUDGET } from '../../src/domain/budget.js';
import { parseTrajectory, serializeEvent, TrajectoryEventSchema } from '../../src/domain/trajectory.js';
import { TrajectoryWriter } from '../../src/infra/artifacts.js';
import { removeDirectory, temporaryDirectory } from '../helpers/workspace.js';

test('a well-formed event serializes and parses back', () => {
  const line = serializeEvent({
    seq: 0,
    ts: '2026-08-29T10:00:00.000Z',
    type: 'run.started',
    mode: 'advanced',
    caseId: 'entrypoint-mismatch',
    model: 'gpt-4.1-mini',
    executor: 'docker',
    budget: DEFAULT_BUDGET,
  });
  const [event] = parseTrajectory(line);
  assert.equal(event?.type, 'run.started');
});

test('an event with an unknown type is rejected', () => {
  assert.equal(TrajectoryEventSchema.safeParse({ seq: 0, ts: 'now', type: 'nope' }).success, false);
});

test('an event missing a required field is rejected', () => {
  assert.equal(
    TrajectoryEventSchema.safeParse({ seq: 0, ts: 'now', type: 'verification.started' }).success,
    false,
  );
});

test('parsing rejects a file with a bad line rather than skipping it', () => {
  assert.throws(() => parseTrajectory('{"seq":0,"ts":"now","type":"unknown"}\n'), /not a valid event/u);
});

test('the writer numbers events, appends them and redacts secrets on the way out', async () => {
  const root = await temporaryDirectory('trajectory');
  try {
    const file = path.join(root, 'trajectory.jsonl');
    const writer = new TrajectoryWriter(file);
    await writer.append({
      type: 'model.message',
      role: 'assistant',
      text: 'I will use OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789 for this',
    });
    await writer.append({
      type: 'tool.call',
      callId: 'run_command-1',
      tool: 'run_command',
      argsJson: JSON.stringify({ command: 'npm', args: ['run', 'check'] }),
    });

    const contents = await readFile(file, 'utf8');
    const events = parseTrajectory(contents);
    assert.equal(events.length, 2);
    assert.deepEqual(events.map((event) => event.seq), [0, 1]);
    assert.equal(contents.includes('sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'), false);
    assert.match(contents, /redacted/u);
    assert.equal(writer.count, 2);
    for (const event of events) {
      assert.match(event.ts, /^\d{4}-\d{2}-\d{2}T/u);
    }
  } finally {
    await removeDirectory(root);
  }
});

test('the writer refuses an event that does not match the schema', async () => {
  const root = await temporaryDirectory('trajectory-invalid');
  try {
    const writer = new TrajectoryWriter(path.join(root, 'trajectory.jsonl'));
    await assert.rejects(() =>
      writer.append({
        type: 'patch.attempt',
        attempt: 0,
        files: [],
        accepted: true,
        note: '',
      }),
    );
  } finally {
    await removeDirectory(root);
  }
});
