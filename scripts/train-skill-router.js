import { createHash } from 'crypto';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  calibrateClassifier,
  evaluateSkillClassifier,
  trainNaiveBayes,
  validateSkillRouterDataset
} from '../server/services/skillClassifierCore.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const datasetFile = process.env.SKILL_ROUTER_DATASET || path.join(root, 'datasets/skill-router.v1.json');
const modelFile = process.env.SKILL_ROUTER_MODEL || path.join(root, 'models/skill-router/naive-bayes-v1.json');
const datasetRaw = await fs.readFile(datasetFile, 'utf8');
const dataset = JSON.parse(datasetRaw);
validateSkillRouterDataset(dataset);
const model = trainNaiveBayes(dataset.train, { labels: dataset.labels, alpha: 1 });
const calibration = calibrateClassifier(model, dataset.validation);
const thresholds = {
  minConfidence: calibration.minConfidence,
  minMargin: calibration.minMargin
};
const artifact = {
  id: 'resumepilot-skill-router-naive-bayes',
  version: '1.0.0',
  createdAt: new Date().toISOString(),
  dataset: {
    id: dataset.id,
    version: dataset.version,
    sha256: createHash('sha256').update(datasetRaw).digest('hex')
  },
  thresholds,
  validationMetrics: calibration.metrics,
  testMetrics: evaluateSkillClassifier(model, dataset.test, thresholds),
  model
};

await fs.mkdir(path.dirname(modelFile), { recursive: true });
await fs.writeFile(modelFile, `${JSON.stringify(artifact, null, 2)}\n`);
console.log(JSON.stringify({
  modelFile,
  version: artifact.version,
  thresholds,
  validation: {
    accuracy: artifact.validationMetrics.accuracy,
    macroF1: artifact.validationMetrics.macroF1,
    unknownRecall: artifact.validationMetrics.unknownRecall
  },
  test: {
    accuracy: artifact.testMetrics.accuracy,
    macroF1: artifact.testMetrics.macroF1,
    unknownRecall: artifact.testMetrics.unknownRecall
  }
}, null, 2));
