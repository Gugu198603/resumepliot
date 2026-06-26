import test from 'node:test';
import assert from 'node:assert/strict';

delete process.env.OPENAI_API_KEY;
const { matchJobDescription, splitRequirements, extractKeywords, buildKeywordDiff, buildHeuristicSummary } = await import('../server/agents/jdMatcher.js');

test('splitRequirements strips bullet markers and drops short lines', () => {
  const reqs = splitRequirements('1. 熟悉向量检索\n- 精通 Python\n。\n有分布式经验');
  assert.deepEqual(reqs, ['熟悉向量检索', '精通 Python', '有分布式经验']);
});

test('extractKeywords lowercases, dedupes and drops stopwords', () => {
  const kw = extractKeywords('We need strong Python and Python with Kubernetes experience');
  assert.ok(kw.includes('python'));
  assert.ok(kw.includes('kubernetes'));
  assert.equal(kw.filter((k) => k === 'python').length, 1);
  assert.ok(!kw.includes('with'));
  assert.ok(!kw.includes('experience'));
});

test('buildKeywordDiff separates matched and missing JD keywords', () => {
  const diff = buildKeywordDiff('Built systems with Python and React', 'Looking for Python, Kubernetes and Golang');
  assert.ok(diff.matchedKeywords.includes('python'));
  assert.ok(diff.missingKeywords.includes('kubernetes'));
  assert.ok(diff.missingKeywords.includes('golang'));
  assert.ok(!diff.matchedKeywords.includes('kubernetes'));
});

test('buildHeuristicSummary reflects score level and missing keywords', () => {
  const summary = buildHeuristicSummary({ matchScore: 80, matched: ['a', 'b'], gaps: ['c'], missingKeywords: ['kubernetes'] });
  assert.match(summary, /80\/100/);
  assert.match(summary, /高度匹配/);
  assert.match(summary, /kubernetes/);
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
  assert.ok(result.gapReport && typeof result.gapReport.summary === 'string' && result.gapReport.summary.length > 0);
  assert.ok(Array.isArray(result.gapReport.matchedKeywords));
  assert.ok(Array.isArray(result.gapReport.missingKeywords));
});

test('matchJobDescription handles empty input gracefully', async () => {
  const result = await matchJobDescription({ resumeText: '', jdText: '' });
  assert.equal(result.matchScore, 0);
  assert.equal(result.mode, 'fallback');
  assert.ok(result.gapReport && Array.isArray(result.gapReport.matchedKeywords));
});
