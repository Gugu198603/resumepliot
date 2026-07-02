import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datasetRaw = await fs.readFile(
  process.env.SKILL_ROUTER_DATASET || path.join(root, 'datasets/skill-router.v1.json'),
  'utf8'
);
const artifact = JSON.parse(await fs.readFile(
  process.env.SKILL_ROUTER_EMBEDDING_MODEL ||
    path.join(root, 'models/skill-router/embedding-comparison-v1.json'),
  'utf8'
));
const hash = createHash('sha256').update(datasetRaw).digest('hex');
if (artifact.dataset?.sha256 !== hash) {
  throw new Error('Embedding classifier artifact is stale. Run npm run train:skill-router:embeddings.');
}
const gates = {
  accuracy: Number(process.env.SKILL_ROUTER_EMBEDDING_MIN_ACCURACY || 0.85),
  macroF1: Number(process.env.SKILL_ROUTER_EMBEDDING_MIN_MACRO_F1 || 0.85),
  unknownRecall: Number(process.env.SKILL_ROUTER_EMBEDDING_MIN_UNKNOWN_RECALL || 0.75)
};
const models = [
  { name: 'prototype', metrics: artifact.prototype.testMetrics },
  { name: 'fineTunedHead', metrics: artifact.fineTunedHead.testMetrics }
].map((item) => ({
  ...item,
  failures: Object.entries(gates)
    .filter(([metric, threshold]) => item.metrics[metric] < threshold)
    .map(([metric, threshold]) => ({ metric, actual: item.metrics[metric], threshold }))
}));
const report = {
  dataset: artifact.dataset,
  artifact: { id: artifact.id, version: artifact.version },
  encoder: artifact.encoder,
  gates,
  passed: models.every((item) => item.failures.length === 0),
  models
};
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
