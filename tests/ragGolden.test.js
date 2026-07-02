import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateGoldenDataset,
  loadGoldenDataset,
  scoreGoldenCase
} from '../server/services/ragEvaluation.js';

test('golden case scoring calculates recall and reciprocal rank', () => {
  const score = scoreGoldenCase([
    { content: 'unrelated chunk' },
    { content: 'RAG uses Qdrant and rerank' }
  ], ['rag', 'qdrant', 'missing']);
  assert.equal(score.hit, true);
  assert.equal(score.recallAtK, 2 / 3);
  assert.equal(score.reciprocalRank, 0.5);
});

test('versioned RAG golden dataset passes configured aggregate gates', async () => {
  const dataset = await loadGoldenDataset();
  const report = await evaluateGoldenDataset({
    dataset,
    retrieve: async (item) => [{ content: item.corpus, score: 1 }]
  });
  assert.equal(report.dataset.version, '1.0.0');
  assert.equal(report.total, 3);
  assert.equal(report.metrics.hitRate, 1);
  assert.equal(report.metrics.recallAtK, 1);
  assert.equal(report.metrics.mrrAtK, 1);
  assert.equal(report.passed, true);
});

test('RAG golden gate reports the metric that regressed', async () => {
  const report = await evaluateGoldenDataset({
    dataset: {
      id: 'regression',
      version: '1.0.0',
      thresholds: { hitRate: 1, recallAtK: 0.8 },
      cases: [{ id: 'missing', query: 'RAG', corpus: 'RAG', relevantTerms: ['rag', 'qdrant'] }]
    },
    retrieve: async () => [{ content: 'RAG only', score: 1 }]
  });
  assert.equal(report.passed, false);
  assert.deepEqual(report.failures.map((item) => item.metric), ['recallAtK']);
});
