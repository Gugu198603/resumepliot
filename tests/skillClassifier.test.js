import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import {
  classifyWithRejection,
  evaluateSkillClassifier,
  predictNaiveBayes,
  tokenizeSkillText,
  trainNaiveBayes,
  validateSkillRouterDataset
} from '../server/services/skillClassifierCore.js';

test('skill classifier tokenizes English words and Chinese n-grams', () => {
  const tokens = tokenizeSkillText('优化 Resume bullet');
  assert.ok(tokens.includes('w:resume'));
  assert.ok(tokens.includes('c:优化'));
});

test('naive bayes predicts known intent and rejects out-of-domain intent', () => {
  const model = trainNaiveBayes([
    { text: '模拟面试并继续追问', label: 'interview-training' },
    { text: 'mock interview questions', label: 'interview-training' },
    { text: '查询天气和日历', label: 'unknown' },
    { text: 'weather calendar reminder', label: 'unknown' }
  ], { labels: ['interview-training', 'unknown'] });
  assert.equal(predictNaiveBayes(model, '继续面试追问').label, 'interview-training');
  assert.equal(classifyWithRejection(model, '查询日历天气', {
    minConfidence: 0.3,
    minMargin: 0
  }).label, 'unknown');
});

test('versioned classifier dataset has isolated train, validation and test splits', async () => {
  const dataset = JSON.parse(await fs.readFile(
    new URL('../datasets/skill-router.v1.json', import.meta.url),
    'utf8'
  ));
  const summary = validateSkillRouterDataset(dataset);
  assert.deepEqual(summary, {
    labels: 5,
    train: 64,
    validation: 15,
    test: 20
  });
});

test('classifier evaluation exposes macro metrics and confusion matrix', () => {
  const examples = [
    { text: '模拟面试', label: 'interview-training' },
    { text: '天气查询', label: 'unknown' }
  ];
  const model = trainNaiveBayes(examples, { labels: ['interview-training', 'unknown'] });
  const metrics = evaluateSkillClassifier(model, examples, { minConfidence: 0.3, minMargin: 0 });
  assert.equal(metrics.accuracy, 1);
  assert.equal(metrics.macroF1, 1);
  assert.equal(metrics.confusion.unknown.unknown, 1);
});
