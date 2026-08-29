import assert from 'node:assert/strict';
import test from 'node:test';
import { containsSecret, redactJson, redactText } from '../../src/infra/redact.js';

const SAMPLES: ReadonlyArray<readonly [string, string]> = [
  ['openai key', 'OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'],
  ['bare openai key', 'the key is sk-abcdefghijklmnopqrstuvwxyz012345'],
  ['anthropic key', 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz0123456789'],
  ['github token', 'ghp_abcdefghijklmnopqrstuvwxyz0123456789'],
  ['npm token', 'npm_abcdefghijklmnopqrstuvwxyz0123456789abcd'],
  // Assembled rather than written out: a literal Slack token, even an invented
  // one, is close enough to the real format that GitHub's push protection
  // blocks the push. The redactor sees the same string either way.
  ['slack token', ['xoxb', '123456789012', 'abcdefghijklmnop'].join('-')],
  ['google key', 'AIzaSyA1234567890abcdefghijklmnopqrstuvw'],
  ['aws access key', 'AKIAIOSFODNN7EXAMPLE'],
  ['bearer token', 'Authorization: Bearer eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.abcdefg'],
  ['authorization header', 'authorization: 0123456789abcdef'],
  ['x-api-key header', 'x-api-key: 0123456789abcdef'],
  ['secret assignment', 'DATABASE_PASSWORD=hunter2hunter2'],
];

for (const [name, sample] of SAMPLES) {
  test(`redaction removes a ${name}`, () => {
    const redacted = redactText(sample);
    assert.match(redacted, /\[redacted:/u, `nothing was redacted in: ${sample}`);
    assert.equal(containsSecret(redacted), false, `a secret survived redaction: ${redacted}`);
  });
}

test('a private key block is removed entirely', () => {
  const pem = [
    '-----BEGIN RSA PRIVATE KEY-----',
    'MIIEowIBAAKCAQEAxyz',
    'abcdefghijklmnop',
    '-----END RSA PRIVATE KEY-----',
  ].join('\n');
  const redacted = redactText(`config:\n${pem}\ndone`);
  assert.equal(redacted.includes('MIIEowIBAAKCAQEAxyz'), false);
  assert.match(redacted, /\[redacted:pem-private-key\]/u);
});

test('ordinary text is left alone', () => {
  const text = 'tsc -p tsconfig.json failed: error TS2307: Cannot find module ./utils/format.js';
  assert.equal(redactText(text), text);
});

test('the variable name survives so the log still explains itself', () => {
  const redacted = redactText('OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz0123456789');
  assert.match(redacted, /OPENAI_API_KEY=/u);
  assert.equal(redacted.includes('sk-proj-abcdefghijklmnopqrstuvwxyz0123456789'), false);
});

test('redactJson scrubs values and whole keys that name a secret', () => {
  const redacted = redactJson({
    command: 'npm',
    env: { OPENAI_API_KEY: 'sk-abcdefghijklmnopqrstuvwxyz012345', PATH: '/usr/bin' },
    headers: { authorization: 'Bearer abcdefghijklmnopqrst' },
    nested: [{ token: 'abcdefghijklmnop' }],
  });
  const serialized = JSON.stringify(redacted);
  assert.equal(serialized.includes('sk-abcdefghijklmnopqrstuvwxyz012345'), false);
  assert.equal(serialized.includes('abcdefghijklmnopqrst'), false);
  assert.match(serialized, /"PATH":"\/usr\/bin"/u);
  assert.match(serialized, /redacted:key-name/u);
});

test('redaction is idempotent', () => {
  const once = redactText('token: ghp_abcdefghijklmnopqrstuvwxyz0123456789');
  assert.equal(redactText(once), once);
});
