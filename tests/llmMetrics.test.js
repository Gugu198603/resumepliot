import test from 'node:test';
import assert from 'node:assert/strict';
import { computeLlmMetrics } from '../server/services/llmMetrics.js';

const runs = [
  {
    createdAt: '2026-06-25T10:00:00.000Z',
    llmTrace: [
      { agent: 'planner', mode: 'live', model: 'deepseek-chat', latencyMs: 800, usage: { promptTokens: 1000, completionTokens: 500, totalTokens: 1500 } },
      { agent: 'interviewer', mode: 'live', model: 'deepseek-chat', latencyMs: 1200, usage: { promptTokens: 2000, completionTokens: 1000, totalTokens: 3000 } }
    ]
  },
  {
    createdAt: '2026-06-26T10:00:00.000Z',
    llmTrace: [
      { agent: 'planner', mode: 'fallback', model: null, latencyMs: 0, usage: null, error: 'no api key' }
    ]
  },
  { createdAt: '2026-06-24T10:00:00.000Z' } // run with no llmTrace
];

test('computeLlmMetrics aggregates calls, tokens, latency across runs', () => {
  const m = computeLlmMetrics(runs);
  assert.equal(m.overview.runs, 3);
  assert.equal(m.overview.runsWithLlm, 2);
  assert.equal(m.overview.calls, 3);
  assert.equal(m.overview.liveCalls, 2);
  assert.equal(m.overview.fallbackCalls, 1);
  assert.equal(m.overview.errorCalls, 1);
  assert.equal(m.overview.totalTokens, 4500);
  assert.equal(m.overview.totalLatencyMs, 2000);
  assert.equal(m.overview.avgLatencyMs, Math.round(2000 / 3));
  assert.equal(m.overview.latestRunAt, '2026-06-26T10:00:00.000Z');
});

test('computeLlmMetrics estimates cost from default pricing', () => {
  const m = computeLlmMetrics(runs);
  // deepseek-chat: prompt 0.27/1M, completion 1.1/1M
  // prompt 3000 -> 3000/1e6*0.27 = 0.00081 ; completion 1500 -> 1500/1e6*1.1 = 0.00165
  const expected = Number((0.00081 + 0.00165).toFixed(6));
  assert.equal(m.overview.costUsd, expected);
  assert.equal(m.pricing.source, 'default');
});

test('computeLlmMetrics groups by model and agent', () => {
  const m = computeLlmMetrics(runs);
  const ds = m.byModel.find((x) => x.model === 'deepseek-chat');
  assert.ok(ds);
  assert.equal(ds.calls, 2);
  assert.equal(ds.totalTokens, 4500);

  const planner = m.byAgent.find((x) => x.agent === 'planner');
  assert.equal(planner.calls, 2, 'planner appears in both live and fallback runs');
  assert.equal(planner.fallbackCalls, 1);
});

test('computeLlmMetrics handles empty input', () => {
  const m = computeLlmMetrics([]);
  assert.equal(m.overview.runs, 0);
  assert.equal(m.overview.calls, 0);
  assert.equal(m.overview.costUsd, 0);
  assert.deepEqual(m.byModel, []);
  assert.deepEqual(m.byAgent, []);
});
