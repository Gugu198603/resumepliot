import fs from 'fs/promises';
import { createHash } from 'crypto';
import path from 'path';
import { fileURLToPath } from 'url';
import { evaluateSkillClassifier } from '../server/services/skillClassifierCore.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const dataset = JSON.parse(await fs.readFile(
  process.env.SKILL_ROUTER_DATASET || path.join(root, 'datasets/skill-router.v1.json'),
  'utf8'
));
const datasetRaw = await fs.readFile(
  process.env.SKILL_ROUTER_DATASET || path.join(root, 'datasets/skill-router.v1.json'),
  'utf8'
);
const artifact = JSON.parse(await fs.readFile(
  process.env.SKILL_ROUTER_MODEL || path.join(root, 'models/skill-router/naive-bayes-v1.json'),
  'utf8'
));
const datasetHash = createHash('sha256').update(datasetRaw).digest('hex');
if (artifact.dataset?.sha256 !== datasetHash) {
  throw new Error('Skill Router model is stale: dataset hash does not match. Run npm run train:skill-router.');
}
const metrics = evaluateSkillClassifier(artifact.model, dataset.test, artifact.thresholds);
const gates = {
  accuracy: Number(process.env.SKILL_ROUTER_MIN_ACCURACY || 0.8),
  macroF1: Number(process.env.SKILL_ROUTER_MIN_MACRO_F1 || 0.75),
  unknownRecall: Number(process.env.SKILL_ROUTER_MIN_UNKNOWN_RECALL || 0.75)
};
const failures = Object.entries(gates)
  .filter(([metric, threshold]) => metrics[metric] < threshold)
  .map(([metric, threshold]) => ({ metric, actual: metrics[metric], threshold }));
const reportMetrics = process.env.SKILL_ROUTER_VERBOSE === 'true'
  ? metrics
  : {
      total: metrics.total,
      accuracy: metrics.accuracy,
      macroF1: metrics.macroF1,
      unknownRecall: metrics.unknownRecall,
      coverage: metrics.coverage,
      confusion: metrics.confusion,
      perLabel: metrics.perLabel
    };
const report = {
  dataset: { id: dataset.id, version: dataset.version },
  model: { id: artifact.id, version: artifact.version },
  thresholds: artifact.thresholds,
  gates,
  passed: failures.length === 0,
  failures,
  metrics: reportMetrics
};
console.log(JSON.stringify(report, null, 2));
if (!report.passed) process.exitCode = 1;
