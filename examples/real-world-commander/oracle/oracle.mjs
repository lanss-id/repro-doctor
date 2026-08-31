// Hidden semantic oracle for the commander example.
//
// Every assertion below is lifted verbatim from commander's own regression
// test, `tests/command.configureOutput.test.js`, the one upstream added in
// PR #2350 to close this bug. Nothing here was written for Repro Doctor. The
// only change is the shape around the assertions: they import the repaired
// tree directly instead of running under the project's test runner, so that
// the test can be held out of the tree the repair agent sees.
//
// It lives outside repo/, is mounted read-only at /oracle, and runs only after
// the agent's session has ended, against a fresh copy of the repaired tree.
//
// commander is MIT licensed, Copyright (c) 2011 TJ Holowaychuk
// <tj@vision-media.ca>. The assertions below are used under that licence:
// https://github.com/tj/commander.js/blob/master/LICENSE
import assert from 'node:assert/strict';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const repo = process.env.REPO_DIR ?? process.cwd();
const results = [];

async function check(name, fn) {
  try {
    await fn();
    results.push([true, name]);
  } catch (error) {
    results.push([false, `${name}: ${String(error.message).split('\n')[0]}`]);
  }
}

let commander;

await check('the package entry point still loads', async () => {
  commander = await import(pathToFileURL(path.join(repo, 'index.js')).href);
  if (typeof commander.Command !== 'function') {
    throw new Error('index.js does not export Command');
  }
});

// commander tests/command.configureOutput.test.js, upstream test:
// 'when configureOutput after copyInheritedSettings then original unchanged'
await check('configureOutput after copyInheritedSettings leaves the original unchanged', () => {
  const program = new commander.Command();
  program.configureOutput({ getOutHelpWidth: () => 80 });
  const copy = program.createCommand('copy');
  copy.copyInheritedSettings(program);
  assert.equal(copy.configureOutput().getOutHelpWidth(), 80);
  copy.configureOutput({ getOutHelpWidth: () => 40 });
  assert.equal(copy.configureOutput().getOutHelpWidth(), 40);
  assert.equal(program.configureOutput().getOutHelpWidth(), 80);
});

// The contract the bug actually breaks, stated once more without the helper
// that makes it convenient, so a repair that special-cases copyInheritedSettings
// does not pass.
await check('configuring one command never reaches through to another', () => {
  const program = new commander.Command();
  const original = { getOutHelpWidth: () => 80 };
  program.configureOutput(original);
  const before = program.configureOutput().getOutHelpWidth();
  const other = new commander.Command();
  other.copyInheritedSettings(program);
  other.configureOutput({ getOutHelpWidth: () => 40 });
  assert.equal(program.configureOutput().getOutHelpWidth(), before);
  assert.equal(original.getOutHelpWidth(), before);
});

for (const [passed, name] of results) {
  process.stdout.write(`[oracle] ${passed ? 'PASS' : 'FAIL'} ${name}\n`);
}
process.exit(results.every(([passed]) => passed) ? 0 : 1);
