import test from 'node:test';
import assert from 'node:assert/strict';

delete process.env.OPENAI_API_KEY;
const { matchJobDescription, splitRequirements } = await import('../server/agents/jdMatcher.js');

test('splitRequirements strips bullet markers and drops short lines', () => {
  const reqs = splitRequirements('1. 熟悉向量检索\n- 精通 Python\n。\n有分布式经验');
  assert.deepEqual(reqs, ['熟悉向量检索', '精通 Python', '有分布式经验']);
});

test('matchJobDescription returns scored coverage in fallback mode without an API key', async () => {
  const result = await matchJobDescription({
    resumeText: '项目经历\n用 RAG 构建简历检索系统，熟悉向量召回与 React 全栈开发。',
    jdText: '熟悉向量检索与 RAG 系统\n精通 Python 与机器学习\n熟悉前端 React 开发'
  });

  assert.equal(result.mode, 'fallback');
  assert.equal(typeof result.matchScore, 'number');
  assert.ok(result.matchScore >= 0 && result.matchScore <= 100);
  assert.equal(result.coverage.length, 3);
  assert.ok(Array.isArray(result.suggestions) && result.suggestions.length > 0);
});

test('matchJobDescription handles empty input gracefully', async () => {
  const result = await matchJobDescription({ resumeText: '', jdText: '' });
  assert.equal(result.matchScore, 0);
  assert.equal(result.mode, 'fallback');
});
