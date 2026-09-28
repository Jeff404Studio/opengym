import test from 'node:test';
import assert from 'node:assert/strict';
import {
  coachCircuitAllow, coachCircuitFailure, coachCircuitSuccess, coachCircuitReset, coachCircuitStatus
} from '../coach/health.js';

test('circuit opens after repeated failures and closes after success', () => {
  coachCircuitReset('t');
  assert.equal(coachCircuitAllow('t'), true);
  coachCircuitFailure('t', 'down');
  coachCircuitFailure('t', 'down');
  const st = coachCircuitFailure('t', 'down');
  assert.equal(st.open, true);
  assert.equal(coachCircuitAllow('t'), false);
  coachCircuitSuccess('t');
  assert.equal(coachCircuitAllow('t'), true);
  assert.equal(coachCircuitStatus('t').failures, 0);
});
