import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';
import {
  evaluateEmbeddingClassifier,
  predictLinear,
  predictPrototype
} from '../server/experiments/embeddingSkillClassifier.js';
import {
  evaluateSkillClassifier,
  predictNaiveBayes
} from '../server/services/skillClassifierCore.js';
import { embedBatch } from '../server/services/vectorStore.shared.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datasetFile = process.env.SKILL_ROUTER_DATASET || path.join(root, 'datasets/skill-router.v1.json');
const naiveBayesFile = process.env.SKILL_ROUTER_MODEL || path.join(root, 'models/skill-router/naive-bayes-v1.json');
const embeddingFile = process.env.SKILL_ROUTER_EMBEDDING_MODEL ||
  path.join(root, 'models/skill-router/embedding-comparison-v1.json');
const datasetRaw = await fs.readFile(datasetFile, 'utf8');
const dataset = JSON.parse(datasetRaw);
const naiveBayes = JSON.parse(await fs.readFile(naiveBayesFile, 'utf8'));
const embedding = JSON.parse(await fs.readFile(embeddingFile, 'utf8'));
const datasetHash = createHash('sha256').update(datasetRaw).digest('hex');
if (naiveBayes.dataset.sha256 !== datasetHash || embedding.dataset.sha256 !== datasetHash) {
  throw new Error('Classifier artifact is stale. Retrain classifiers before comparison.');
}

function timePredict(examples, predict) {
  const startedAt = performance.now();
  for (const example of examples) predict(example);
  return (performance.now() - startedAt) / examples.length;
}

const naiveMetrics = evaluateSkillClassifier(
  naiveBayes.model,
  dataset.test,
  naiveBayes.thresholds
);
const naiveHeadMs = timePredict(dataset.test, (item) => predictNaiveBayes(naiveBayes.model, item.text));

const encodeStartedAt = performance.now();
const testEmbeddings = await embedBatch(dataset.test.map((item) => item.text));
const encoderMsPerItem = (performance.now() - encodeStartedAt) / dataset.test.length;

const prototypeMetrics = evaluateEmbeddingClassifier(
  dataset.test,
  testEmbeddings,
  (vector) => predictPrototype(embedding.prototype.model, vector),
  embedding.prototype.thresholds
);
const prototypeHeadMs = timePredict(testEmbeddings, (vector) =>
  predictPrototype(embedding.prototype.model, vector)
);

const linearMetrics = evaluateEmbeddingClassifier(
  dataset.test,
  testEmbeddings,
  (vector) => predictLinear(embedding.fineTunedHead.model, vector),
  embedding.fineTunedHead.thresholds
);
const linearHeadMs = timePredict(testEmbeddings, (vector) =>
  predictLinear(embedding.fineTunedHead.model, vector)
);

const compact = (name, metrics, headMs, encoderMs = 0) => ({
  name,
  accuracy: metrics.accuracy,
  macroF1: metrics.macroF1,
  unknownRecall: metrics.unknownRecall,
  coverage: metrics.coverage,
  latency: {
    encoderMsPerItem: Number(encoderMs.toFixed(3)),
    classifierMsPerItem: Number(headMs.toFixed(3)),
    endToEndMsPerItem: Number((encoderMs + headMs).toFixed(3))
  }
});
const report = {
  experiment: 'skill-router-model-comparison',
  version: '1.0.0',
  dataset: {
    id: dataset.id,
    version: dataset.version,
    testExamples: dataset.test.length,
    sha256: datasetHash
  },
  encoder: embedding.encoder,
  models: [
    compact('naive-bayes-char-ngram', naiveMetrics, naiveHeadMs),
    compact('bge-m3-prototype', prototypeMetrics, prototypeHeadMs, encoderMsPerItem),
    compact('bge-m3-frozen-encoder-softmax-head', linearMetrics, linearHeadMs, encoderMsPerItem)
  ],
  notes: [
    'BGE latency includes text encoding plus classifier-head latency.',
    'The softmax experiment fine-tunes only the classification head; the BGE encoder remains frozen.'
  ]
};
const reportFile = process.env.SKILL_ROUTER_COMPARISON_REPORT ||
  path.join(root, 'reports/skill-router-model-comparison.v1.json');
await fs.mkdir(path.dirname(reportFile), { recursive: true });
await fs.writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
