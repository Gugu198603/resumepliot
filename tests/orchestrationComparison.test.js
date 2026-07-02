import test from 'node:test';
import assert from 'node:assert/strict';
import {
  runNativeOrchestration,
  runOrchestrationComparison
} from '../server/experiments/orchestrationComparison.js';

test('native orchestration returns the shared experiment contract', async () => {
  const output = await runNativeOrchestration({
    text: '项目经历\n负责 RAG 与 Agent 系统。\n技能\nNode.js Qdrant',
    goal: 'RAG Agent'
  });
  assert.ok(output.result.sectionCount > 0);
  assert.ok(output.result.retrievedIds.length > 0);
});

test('native, LangChain and LangGraph orchestration keep output parity', async () => {
  const report = await runOrchestrationComparison({ iterations: 3 });
  assert.equal(report.outputParity, true);
  assert.deepEqual(
    report.results.map((item) => item.name),
    ['native', 'langchain-runnable-sequence', 'langgraph-state-graph']
  );
  assert.ok(report.results.every((item) => item.iterations === 3));
});
