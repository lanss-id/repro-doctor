import assert from 'node:assert/strict';
import test from 'node:test';
import { extractUsage, usageFromError } from '../../src/agent/driver.js';

test('usage is summed across every model response of a turn', () => {
  // Arrange
  const responses = [
    { usage: { inputTokens: 100, outputTokens: 10, totalTokens: 110 } },
    { usage: { inputTokens: 250, outputTokens: 40, totalTokens: 290 } },
  ];

  // Act
  const usage = extractUsage(responses);

  // Assert
  assert.deepEqual(usage, { inputTokens: 350, outputTokens: 50, totalTokens: 400, requests: 2 });
});

test('a provider that reports no usage produces null, not a plausible zero', () => {
  assert.equal(extractUsage([{}, {}]), null);
  assert.equal(extractUsage([]), null);
});

// A run that ends by hitting the turn limit still made every model call it was
// billed for. Reading the usage off the result object alone lost all of it, and
// the run then reported its cost as unknown, which the evaluator refuses to
// score. The tokens are on the state the error carries.
test('usage survives a turn that ended by throwing', () => {
  // Arrange
  const failure = Object.assign(new Error('max turns exceeded'), {
    state: { _modelResponses: [{ usage: { inputTokens: 900, outputTokens: 60, totalTokens: 960 } }] },
  });

  // Act
  const usage = usageFromError(failure);

  // Assert
  assert.deepEqual(usage, { inputTokens: 900, outputTokens: 60, totalTokens: 960, requests: 1 });
});

test('an error carrying no run state reports no usage rather than zero', () => {
  assert.equal(usageFromError(new Error('connection reset')), null);
  assert.equal(usageFromError('not an error at all'), null);
  assert.equal(usageFromError(null), null);
});
