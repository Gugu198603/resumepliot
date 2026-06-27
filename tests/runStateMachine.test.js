import test from 'node:test';
import assert from 'node:assert/strict';

import {
  RUN_STATUS,
  InvalidRunStateTransitionError,
  createRunStateMachine,
  deriveFailureStatus,
  isTerminalRunStatus
} from '../server/services/runStateMachine.js';
import { AgentRecoveryHardStopError } from '../server/services/agentRecovery.js';

test('run state machine allows normal pending-running-succeeded flow', () => {
  const transitions = [];
  const machine = createRunStateMachine({ onTransition: (event) => transitions.push(event) });

  machine.transition(RUN_STATUS.RUNNING, { reason: 'start' });
  machine.transition(RUN_STATUS.SUCCEEDED, { reason: 'done' });

  assert.equal(machine.status, RUN_STATUS.SUCCEEDED);
  assert.equal(machine.isTerminal(), true);
  assert.equal(transitions.length, 2);
  assert.deepEqual(transitions.map((item) => `${item.from}->${item.to}`), ['pending->running', 'running->succeeded']);
});

test('run state machine rejects transitions after terminal status', () => {
  const machine = createRunStateMachine();
  machine.transition(RUN_STATUS.RUNNING);
  machine.transition(RUN_STATUS.FAILED);

  assert.throws(
    () => machine.transition(RUN_STATUS.SUCCEEDED),
    (error) => error instanceof InvalidRunStateTransitionError && error.code === 'INVALID_RUN_STATE_TRANSITION'
  );
});

test('deriveFailureStatus separates timeout, hard stop, and generic failure', () => {
  assert.equal(deriveFailureStatus({ code: 'AGENT_TIMEOUT' }), RUN_STATUS.TIMEOUT);
  assert.equal(deriveFailureStatus(new AgentRecoveryHardStopError('stopped', { code: 'AGENT_MAX_STEPS_EXCEEDED' })), RUN_STATUS.HARD_STOPPED);
  assert.equal(deriveFailureStatus(new Error('boom')), RUN_STATUS.FAILED);
  assert.equal(isTerminalRunStatus(RUN_STATUS.CANCELLED), true);
});
