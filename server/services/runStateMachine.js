export const RUN_STATUS = Object.freeze({
  PENDING: 'pending',
  RUNNING: 'running',
  SUCCEEDED: 'succeeded',
  FAILED: 'failed',
  TIMEOUT: 'timeout',
  HARD_STOPPED: 'hard_stopped',
  CANCELLED: 'cancelled'
});

const TERMINAL_STATUSES = new Set([
  RUN_STATUS.SUCCEEDED,
  RUN_STATUS.FAILED,
  RUN_STATUS.TIMEOUT,
  RUN_STATUS.HARD_STOPPED,
  RUN_STATUS.CANCELLED
]);

const ALLOWED_TRANSITIONS = {
  [RUN_STATUS.PENDING]: new Set([RUN_STATUS.RUNNING, RUN_STATUS.CANCELLED]),
  [RUN_STATUS.RUNNING]: new Set([
    RUN_STATUS.SUCCEEDED,
    RUN_STATUS.FAILED,
    RUN_STATUS.TIMEOUT,
    RUN_STATUS.HARD_STOPPED,
    RUN_STATUS.CANCELLED
  ]),
  [RUN_STATUS.SUCCEEDED]: new Set(),
  [RUN_STATUS.FAILED]: new Set(),
  [RUN_STATUS.TIMEOUT]: new Set(),
  [RUN_STATUS.HARD_STOPPED]: new Set(),
  [RUN_STATUS.CANCELLED]: new Set()
};

export class InvalidRunStateTransitionError extends Error {
  constructor(from, to) {
    super(`Invalid run state transition: ${from} -> ${to}`);
    this.name = 'InvalidRunStateTransitionError';
    this.code = 'INVALID_RUN_STATE_TRANSITION';
    this.from = from;
    this.to = to;
  }
}

export function isTerminalRunStatus(status) {
  return TERMINAL_STATUSES.has(status);
}

export function deriveFailureStatus(error) {
  const code = error?.code || error?.details?.code || '';
  if (code === 'AGENT_TIMEOUT') return RUN_STATUS.TIMEOUT;
  if (code === 'AGENT_MAX_STEPS_EXCEEDED') return RUN_STATUS.HARD_STOPPED;
  if (code === 'AGENT_MAX_TOOL_CALLS_EXCEEDED') return RUN_STATUS.HARD_STOPPED;
  if (code === 'AGENT_MAX_SAME_TOOL_CALLS_EXCEEDED') return RUN_STATUS.HARD_STOPPED;
  if (String(error?.name || '') === 'AgentRecoveryHardStopError') return RUN_STATUS.HARD_STOPPED;
  return RUN_STATUS.FAILED;
}

export function createRunStateMachine({ initialStatus = RUN_STATUS.PENDING, onTransition } = {}) {
  let status = initialStatus;
  const transitions = [];

  function transition(to, metadata = {}) {
    const allowed = ALLOWED_TRANSITIONS[status];
    if (!allowed || !allowed.has(to)) {
      throw new InvalidRunStateTransitionError(status, to);
    }

    const event = {
      from: status,
      to,
      at: new Date().toISOString(),
      ...metadata
    };
    status = to;
    transitions.push(event);
    if (onTransition) onTransition(event);
    return event;
  }

  return {
    get status() {
      return status;
    },
    get transitions() {
      return transitions.slice();
    },
    transition,
    isTerminal() {
      return isTerminalRunStatus(status);
    }
  };
}
