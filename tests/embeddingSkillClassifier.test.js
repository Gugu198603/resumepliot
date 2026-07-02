import test from 'node:test';
import assert from 'node:assert/strict';
import {
  evaluateEmbeddingClassifier,
  predictLinear,
  predictPrototype,
  trainLinearClassifier,
  trainPrototypeClassifier
} from '../server/experiments/embeddingSkillClassifier.js';

const examples = [
  { text: 'interview one', label: 'interview-training' },
  { text: 'interview two', label: 'interview-training' },
  { text: 'unknown one', label: 'unknown' },
  { text: 'unknown two', label: 'unknown' }
];
const embeddings = [
  [1, 0],
  [0.9, 0.1],
  [0, 1],
  [0.1, 0.9]
];
const labels = ['interview-training', 'unknown'];

test('prototype classifier predicts the nearest label centroid', () => {
  const model = trainPrototypeClassifier(examples, embeddings, labels, { temperature: 0.1 });
  assert.equal(predictPrototype(model, [1, 0]).label, 'interview-training');
  assert.equal(predictPrototype(model, [0, 1]).label, 'unknown');
});

test('softmax classification head learns separable frozen embeddings', () => {
  const model = trainLinearClassifier(examples, embeddings, labels, {
    epochs: 120,
    learningRate: 0.5
  });
  assert.equal(predictLinear(model, [1, 0]).label, 'interview-training');
  assert.equal(predictLinear(model, [0, 1]).label, 'unknown');
});

test('embedding classifier evaluation preserves unknown rejection metrics', () => {
  const model = trainPrototypeClassifier(examples, embeddings, labels, { temperature: 0.1 });
  const metrics = evaluateEmbeddingClassifier(
    examples,
    embeddings,
    (vector) => predictPrototype(model, vector),
    { minConfidence: 0.25, minMargin: 0 }
  );
  assert.equal(metrics.accuracy, 1);
  assert.equal(metrics.unknownRecall, 1);
  assert.equal(metrics.confusion.unknown.unknown, 2);
});
