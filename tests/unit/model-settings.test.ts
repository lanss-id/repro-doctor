import assert from 'node:assert/strict';
import test from 'node:test';
import { BASELINE_MAX_TURNS, defaultModelSettings, fingerprintModelSettings } from '../../src/domain/config.js';
import { DEFAULT_BUDGET } from '../../src/domain/budget.js';

/**
 * The SDK's turn ceiling used to be fixed at 16 whatever the budget said, so a
 * run given 25 tool calls was told it had 25 and stopped at 19. Deriving the
 * ceiling from the budget fixes that, and the floor keeps every batch measured
 * at the published budget identical to the ones already published.
 */

test('the published budget produces exactly the settings every published result used', () => {
  const before = { model: 'm', temperature: 0, topP: 1, maxTurns: BASELINE_MAX_TURNS, parallelToolCalls: false };
  const now = defaultModelSettings('m', DEFAULT_BUDGET.maxToolCalls);

  assert.equal(now.maxTurns, BASELINE_MAX_TURNS);
  assert.equal(
    fingerprintModelSettings(now),
    fingerprintModelSettings(before),
    'the settings fingerprint is written into every result; changing it at the default budget would make every published run incomparable',
  );
});

test('a raised tool-call budget raises the turn ceiling with it', () => {
  assert.equal(defaultModelSettings('m', 25).maxTurns, 29);
  assert.equal(defaultModelSettings('m', 40).maxTurns, 44);
});

test('a budget smaller than the floor still gets the floor', () => {
  assert.equal(defaultModelSettings('m', 4).maxTurns, BASELINE_MAX_TURNS);
  assert.equal(defaultModelSettings('m').maxTurns, BASELINE_MAX_TURNS);
});
