import { Router } from 'express';
import { routeSkill } from '../router/skillRouter.js';
import { resolveExecutionPlan } from '../services/skillWorkflow.js';

const router = Router();

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
