import assert from 'node:assert/strict';
import test from 'node:test';
import { checkCommandFor, parseCheckCommand } from '../../src/agent/check-command.js';

test('the manifest decides the check command when nobody says otherwise', () => {
  assert.equal(checkCommandFor({ scripts: { check: 'tsc', test: 'node --test' } }).source, 'script:check');
  assert.equal(checkCommandFor({ scripts: { build: 'tsc', test: 'node --test' } }).source, 'script:build');
  assert.equal(checkCommandFor({ scripts: { test: 'node --test' } }).source, 'script:test');
  assert.equal(checkCommandFor({ scripts: {} }).source, 'fallback');
  assert.equal(checkCommandFor(null).source, 'fallback');
});

test('an explicit command wins over every script in the manifest', () => {
  const explicit = parseCheckCommand('node --test');
  assert.notEqual(explicit, null);
  if (explicit === null) return;

  // commander is the case this exists for: its own check script runs lint and
  // formatting, which report on whether its devDependencies are installed
  // rather than on whether the library works.
  const resolved = checkCommandFor({ scripts: { check: 'eslint . && prettier --check .' } }, explicit);
  assert.equal(resolved.source, 'explicit');
  assert.equal(resolved.command, 'node');
  assert.deepEqual(resolved.args, ['--test']);
  assert.equal(resolved.label, 'node --test');
});

test('an explicit command is an argv, not a shell line', () => {
  const parsed = parseCheckCommand('  npm   run   check   --silent  ');
  assert.notEqual(parsed, null);
  if (parsed === null) return;
  assert.equal(parsed.command, 'npm');
  assert.deepEqual(parsed.args, ['run', 'check', '--silent']);

  // No shell means no pipes, no redirection and no chaining smuggled in: the
  // words are passed through as arguments and the command either exists or
  // does not.
  const chained = parseCheckCommand('node --test && rm -rf /');
  assert.deepEqual(chained?.args, ['--test', '&&', 'rm', '-rf', '/']);
});

test('an empty check command is refused rather than silently ignored', () => {
  assert.equal(parseCheckCommand(''), null);
  assert.equal(parseCheckCommand('   '), null);
});
