import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import test from 'node:test';
import { DEFAULT_BUDGET } from '../../src/domain/budget.js';
import { advancedInstructions, baselineInstructions } from '../../src/agent/instructions.js';

/**
 * The instruction text is the experiment's independent variable. Every
 * published rate was measured against exactly this wording, so a change to it
 * silently makes the next batch incomparable with the last one, and no type
 * checker or linter can see that happen.
 *
 * This pins it. A failure here is not a bug: it means the wording moved, which
 * is allowed, and which requires a row in docs/IMPROVEMENT_CHANGELOG.md and a
 * re-run of anything still being compared against. Two batches have already
 * been discarded for exactly this reason. Update the digest deliberately,
 * never to make the suite green.
 */
const PUBLISHED_DIGEST = '580f40059e45c423659beddafae158895d2c3ade4a60732eb38649d4ab179444';

test('the published instruction text has not moved under the published results', () => {
  const text = `${baselineInstructions(DEFAULT_BUDGET)}\n=====\n${advancedInstructions(DEFAULT_BUDGET)}`;
  const digest = createHash('sha256').update(text).digest('hex');

  assert.equal(
    digest,
    PUBLISHED_DIGEST,
    'the agent instructions changed. Every published measurement was taken against the previous wording.',
  );
});
