import { Router } from 'express';
import { routeSkill } from '../router/skillRouter.js';
import { resolveExecutionPlan } from '../services/skillWorkflow.js';
import {
  loadEmbeddingSkillClassifier,
  loadSkillClassifier
} from '../services/skillClassifier.js';

const router = Router();

router.get('/skill-router/model', async (_req, res) => {
  try {
    const artifact = await loadSkillClassifier();
    return res.json({
      id: artifact.id,
      version: artifact.version,
      createdAt: artifact.createdAt,
      dataset: artifact.dataset,
      thresholds: artifact.thresholds,
      validationMetrics: {
        accuracy: artifact.validationMetrics?.accuracy,
        macroF1: artifact.validationMetrics?.macroF1,
        unknownRecall: artifact.validationMetrics?.unknownRecall,
        coverage: artifact.validationMetrics?.coverage
      },
      testMetrics: {
        accuracy: artifact.testMetrics?.accuracy,
        macroF1: artifact.testMetrics?.macroF1,
        unknownRecall: artifact.testMetrics?.unknownRecall,
        coverage: artifact.testMetrics?.coverage
      },
      labels: artifact.model?.labels || [],
      vocabularySize: artifact.model?.vocabularySize || 0,
      documentCount: artifact.model?.documentCount || 0
    });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

router.get('/skill-router/embedding-experiment', async (_req, res) => {
  try {
    const artifact = await loadEmbeddingSkillClassifier();
    return res.json({
      id: artifact.id,
      version: artifact.version,
      createdAt: artifact.createdAt,
      dataset: artifact.dataset,
      encoder: artifact.encoder,
      prototype: {
        thresholds: artifact.prototype.thresholds,
        validationMetrics: artifact.prototype.validationMetrics,
        testMetrics: artifact.prototype.testMetrics
      },
      fineTunedHead: {
        description: artifact.fineTunedHead.description,
        thresholds: artifact.fineTunedHead.thresholds,
        validationMetrics: artifact.fineTunedHead.validationMetrics,
        testMetrics: artifact.fineTunedHead.testMetrics
      }
    });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

router.post('/skill-route', async (req, res) => {
  try {
    const skill = await routeSkill({ goal: req.body?.goal || '' });
    const executionPlan = skill.selectedSkill
      ? resolveExecutionPlan({ content: skill.rawContent || '' })
      : [];
    return res.json({ ...skill, executionPlan });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export const skillRouter = router;
