import test from 'node:test';
import assert from 'node:assert/strict';
import {
  canTransitionApplication,
  normalizeApplicationStatus,
  validateApplicationTransition
} from '../server/services/applicationWorkflow.js';

test('application workflow accepts normal recruiting progress', () => {
  assert.equal(canTransitionApplication('saved', 'preparing'), true);
  assert.equal(canTransitionApplication('preparing', 'applied'), true);
  assert.equal(canTransitionApplication('applied', 'interviewing'), true);
  assert.equal(canTransitionApplication('interviewing', 'offer'), true);
});

test('application workflow rejects skipped and unknown states', () => {
  assert.equal(canTransitionApplication('saved', 'offer'), false);
  assert.equal(normalizeApplicationStatus('unknown'), 'saved');
  assert.deepEqual(validateApplicationTransition('saved', 'offer'), {
    ok: false,
    code: 'INVALID_APPLICATION_TRANSITION',
    message: '不能从 saved 直接切换到 offer。'
  });
  assert.equal(validateApplicationTransition('saved', 'unknown').code, 'INVALID_APPLICATION_STATUS');
});
