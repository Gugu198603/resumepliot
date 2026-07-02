import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { classifyWithRejection } from './skillClassifierCore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultModelFile = path.resolve(__dirname, '../../models/skill-router/naive-bayes-v1.json');
const defaultEmbeddingModelFile = path.resolve(__dirname, '../../models/skill-router/embedding-comparison-v1.json');
let cached = null;
let cachedEmbedding = null;

export async function loadSkillClassifier(file = process.env.SKILL_ROUTER_MODEL || defaultModelFile) {
  if (cached?.file === file) return cached.artifact;
  const artifact = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!artifact?.id || !artifact?.version || !artifact?.model || !artifact?.thresholds) {
    throw new Error('Skill Router model artifact is invalid.');
  }
  cached = { file, artifact };
  return artifact;
}

export async function loadEmbeddingSkillClassifier(
  file = process.env.SKILL_ROUTER_EMBEDDING_MODEL || defaultEmbeddingModelFile
) {
  if (cachedEmbedding?.file === file) return cachedEmbedding.artifact;
  const artifact = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!artifact?.id || !artifact?.version || !artifact?.encoder || !artifact?.prototype || !artifact?.fineTunedHead) {
    throw new Error('Embedding Skill Router artifact is invalid.');
  }
  cachedEmbedding = { file, artifact };
  return artifact;
}

export async function classifySkillGoal(goal) {
  try {
    const artifact = await loadSkillClassifier();
    const result = classifyWithRejection(artifact.model, goal, artifact.thresholds);
    return {
      available: true,
      modelId: artifact.id,
      modelVersion: artifact.version,
      datasetVersion: artifact.dataset?.version || null,
      thresholds: artifact.thresholds,
      ...result
    };
  } catch (error) {
    return {
      available: false,
      modelId: null,
      modelVersion: null,
      datasetVersion: null,
      label: 'unknown',
      predictedLabel: 'unknown',
      confidence: 0,
      margin: 0,
      probabilities: [],
      rejected: true,
      rejectionReason: 'model_unavailable',
      error: error.message
    };
  }
}

export function clearSkillClassifierCache() {
  cached = null;
  cachedEmbedding = null;
}
