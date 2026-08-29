import assert from 'node:assert/strict';
import test from 'node:test';
import {
  assertKnownFlags,
  booleanFlag,
  numberFlag,
  parseArgv,
  requiredStringFlag,
  stringFlag,
} from '../../src/cli/args.js';
import { ReproDoctorError } from '../../src/domain/failure.js';

test('positionals and both flag spellings are parsed', () => {
  const args = parseArgv(['diagnose', 'fixtures/entrypoint-mismatch/repo', '--mode', 'advanced', '--repeats=3', '--json']);
  assert.deepEqual(args.positionals, ['diagnose', 'fixtures/entrypoint-mismatch/repo']);
  assert.equal(stringFlag(args, 'mode'), 'advanced');
  assert.equal(numberFlag(args, 'repeats'), 3);
  assert.equal(booleanFlag(args, 'json'), true);
  assert.equal(booleanFlag(args, 'missing'), false);
  assert.equal(stringFlag(args, 'missing'), null);
});

test('a flag with no value is a boolean, not a swallowed positional', () => {
  const args = parseArgv(['apply', 'run-id', '--yes-i-reviewed-the-patch', '--to', '/tmp/repo']);
  assert.equal(booleanFlag(args, 'yes-i-reviewed-the-patch'), true);
  assert.equal(stringFlag(args, 'to'), '/tmp/repo');
});

test('a missing required flag is a usage error', () => {
  assert.throws(() => requiredStringFlag(parseArgv(['apply', 'x']), 'to'), ReproDoctorError);
});

test('a flag used as a boolean where a value is required is a usage error', () => {
  assert.throws(() => stringFlag(parseArgv(['diagnose', '--mode']), 'mode'), ReproDoctorError);
});

test('a non-numeric value for a numeric flag is a usage error', () => {
  assert.throws(() => numberFlag(parseArgv(['eval', '--repeats', 'many']), 'repeats'), ReproDoctorError);
});

test('unknown flags are rejected instead of ignored', () => {
  const args = parseArgv(['diagnose', 'repo', '--moed', 'advanced']);
  assert.throws(() => assertKnownFlags(args, ['mode']), /unknown option/u);
  assert.doesNotThrow(() => assertKnownFlags(parseArgv(['diagnose', 'repo', '--mode', 'advanced']), ['mode']));
});
