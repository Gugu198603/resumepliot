import test from 'node:test';
import assert from 'node:assert/strict';

import {
  AgentRecoveryHardStopError,
  createErrorFingerprint,
  createFingerprintCache,
  createRecoveryRuntime,
  ruleRepairJson
} from '../server/services/agentRecovery.js';

test('ruleRepairJson extracts fenced JSON and removes trailing commas', () => {
  const repaired = ruleRepairJson('```json\n{ "ok": true, "items": [1, 2,], }\n```');
  assert.equal(repaired.ok, true);
  assert.deepEqual(repaired.object, { ok: true, items: [1, 2] });
  assert.match(repaired.rule, /remove_trailing_commas/);
});

test('error fingerprint is stable for the same error code, step, tool, and args', () => {
  const first = createErrorFingerprint({
    error: new Error('timeout while calling model'),
    stepName: 'planner',
    toolName: 'llm',
    args: { goal: 'prepare interview', topK: 3 }
  });
  const second = createErrorFingerprint({
    error: new Error('timeout while calling model'),
    stepName: 'planner',
    toolName: 'llm',
    args: { topK: 3, goal: 'prepare interview' }
  });

  assert.equal(first.code, 'LLM_TIMEOUT');
  assert.equal(first.fingerprint, second.fingerprint);
});

test('fingerprint cache counts repeated errors and keeps last outcome', () => {
  const cache = createFingerprintCache();
  const entry = {
    fingerprint: 'abc',
    code: 'LLM_TIMEOUT',
    stepName: 'planner',
    toolName: 'llm',
    argsHash: 'args',
    message: 'timeout'
  };

  cache.record(entry);
  cache.record(entry);
  cache.markOutcome('abc', 'failed');

  const [stored] = cache.toJSON();
  assert.equal(stored.attempts, 2);
  assert.equal(stored.lastOutcome, 'failed');
});

test('recovery runtime retries transient errors within budget', async () => {
  const runtime = createRecoveryRuntime({
    policy: {
      maxAttemptsPerStep: 1,
      maxAttemptsPerRun: 1,
      maxRecoveryTokens: 1000,
      maxRecoveryCostUsd: 1,
      retryBaseDelayMs: 0
    }
  });
  let calls = 0;

  const result = await runtime.runStep({
    stepName: 'planner',
    args: { goal: 'g' },
    operation: async () => {
      calls += 1;
      if (calls === 1) throw new Error('timeout');
      return { ok: true };
    }
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(calls, 2);
  assert.equal(runtime.snapshot().events.some((event) => event.type === 'recovery_retry'), true);
});

test('recovery runtime hard stops when token budget is exceeded', async () => {
  const runtime = createRecoveryRuntime({
    policy: {
      maxAttemptsPerStep: 1,
      maxAttemptsPerRun: 1,
      maxRecoveryTokens: 1,
      maxRecoveryCostUsd: 1,
      retryBaseDelayMs: 0
    }
  });

  await assert.rejects(
    runtime.runStep({
      stepName: 'planner',
      args: { goal: 'this payload is intentionally longer than one token' },
      operation: async () => {
        throw new Error('timeout');
      }
    }),
    (error) => {
      assert.equal(error instanceof AgentRecoveryHardStopError, true);
      assert.equal(error.code, 'RECOVERY_TOKEN_BUDGET_EXCEEDED');
      return true;
    }
  );
});
