import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { performance } from 'perf_hooks';
import { fileURLToPath } from 'url';
import {
  calibrateEmbeddingClassifier,
  evaluateEmbeddingClassifier,
  predictLinear,
  predictPrototype,
  trainLinearClassifier,
  trainPrototypeClassifier
} from '../server/experiments/embeddingSkillClassifier.js';
import { validateSkillRouterDataset } from '../server/services/skillClassifierCore.js';
import { embedBatch } from '../server/services/vectorStore.shared.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datasetFile = process.env.SKILL_ROUTER_DATASET || path.join(root, 'datasets/skill-router.v1.json');
const artifactFile = process.env.SKILL_ROUTER_EMBEDDING_MODEL ||
  path.join(root, 'models/skill-router/embedding-comparison-v1.json');
const datasetRaw = await fs.readFile(datasetFile, 'utf8');
const dataset = JSON.parse(datasetRaw);
validateSkillRouterDataset(dataset);

const examples = [...dataset.train, ...dataset.validation, ...dataset.test];
const encodeStartedAt = performance.now();
const embeddings = await embedBatch(examples.map((item) => item.text));
const encodingMs = performance.now() - encodeStartedAt;
const trainEnd = dataset.train.length;
const validationEnd = trainEnd + dataset.validation.length;
const trainEmbeddings = embeddings.slice(0, trainEnd);
const validationEmbeddings = embeddings.slice(trainEnd, validationEnd);
const testEmbeddings = embeddings.slice(validationEnd);

const prototype = trainPrototypeClassifier(dataset.train, trainEmbeddings, dataset.labels);
const prototypeCalibration = calibrateEmbeddingClassifier(
  dataset.validation,
  validationEmbeddings,
  (embedding) => predictPrototype(prototype, embedding)
);
const prototypeTest = evaluateEmbeddingClassifier(
  dataset.test,
  testEmbeddings,
  (embedding) => predictPrototype(prototype, embedding),
  prototypeCalibration.thresholds
);

const linear = trainLinearClassifier(dataset.train, trainEmbeddings, dataset.labels);
const linearCalibration = calibrateEmbeddingClassifier(
  dataset.validation,
  validationEmbeddings,
  (embedding) => predictLinear(linear, embedding)
);
const linearTest = evaluateEmbeddingClassifier(
  dataset.test,
  testEmbeddings,
  (embedding) => predictLinear(linear, embedding),
  linearCalibration.thresholds
);

const compactMetrics = (metrics) => ({
  total: metrics.total,
  accuracy: metrics.accuracy,
  macroF1: metrics.macroF1,
  unknownRecall: metrics.unknownRecall,
  coverage: metrics.coverage,
  confusion: metrics.confusion,
  perLabel: metrics.perLabel
});
const artifact = {
  id: 'resumepilot-skill-router-embedding-comparison',
  version: '1.0.0',
  createdAt: new Date().toISOString(),
  dataset: {
    id: dataset.id,
    version: dataset.version,
    sha256: createHash('sha256').update(datasetRaw).digest('hex')
  },
  encoder: {
    model: process.env.EMBED_MODEL || 'Xenova/bge-m3',
    pooling: 'cls',
    normalize: true,
    frozen: true,
    dimension: embeddings[0]?.length || 0,
    examplesEncoded: examples.length,
    encodingMs: Number(encodingMs.toFixed(3))
  },
  prototype: {
    thresholds: prototypeCalibration.thresholds,
    validationMetrics: compactMetrics(prototypeCalibration.metrics),
    testMetrics: compactMetrics(prototypeTest),
    model: prototype
  },
  fineTunedHead: {
    description: 'Frozen BGE encoder with a trainable softmax classification head; the encoder itself is not fine-tuned.',
    thresholds: linearCalibration.thresholds,
    validationMetrics: compactMetrics(linearCalibration.metrics),
    testMetrics: compactMetrics(linearTest),
    model: linear
  }
};
await fs.mkdir(path.dirname(artifactFile), { recursive: true });
await fs.writeFile(artifactFile, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({
  artifactFile,
  encoder: artifact.encoder,
  prototype: {
    thresholds: artifact.prototype.thresholds,
    validation: artifact.prototype.validationMetrics,
    test: artifact.prototype.testMetrics
  },
  fineTunedHead: {
    thresholds: artifact.fineTunedHead.thresholds,
    validation: artifact.fineTunedHead.validationMetrics,
    test: artifact.fineTunedHead.testMetrics
  }
}, null, 2));
