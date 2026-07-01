import { Router } from 'express';
import { getDatabaseOverview, getDashboardSnapshot, getResume, getRun, listRecentRuns } from '../services/database.js';
import { getAppRoadmap } from '../services/appPlanner.js';
import { getLLMConfig } from '../services/llmClient.js';
import { computeLlmMetrics } from '../services/llmMetrics.js';
import { DEFAULT_GOLDEN_QUERIES, evaluateRag } from '../services/ragEvaluation.js';
import { handleMcpRequest } from '../mcp/runtime.js';
import { listTools } from '../mcp/server.js';
import { asyncRoute, HttpError } from '../middleware/http.js';

export function createSystemRouter({ vectorProvider, computeDashboard, getQdrantReadiness }) {
  const router = Router();
  router.get('/health', asyncRoute(async (_req, res) => res.json({ ok: true, multiAgent: true, vectorProvider, db: await getDatabaseOverview() })));
  router.get('/mcp/tools', (_req, res) => res.json({ tools: listTools() }));
  router.post('/mcp', asyncRoute(async (req, res) => res.json(await handleMcpRequest(req.body))));
  router.get('/app-roadmap', (_req, res) => res.json(getAppRoadmap()));
  router.get('/runs', asyncRoute(async (_req, res) => res.json({ runs: await listRecentRuns() })));
  router.get('/runs/:id', asyncRoute(async (req, res) => {
    const run = await getRun(req.params.id);
    if (!run) throw new HttpError(404, 'RUN_NOT_FOUND', 'Run not found');
    res.json({ run });
  }));
  router.get('/dashboard', asyncRoute(async (_req, res) => res.json(computeDashboard(await getDashboardSnapshot()))));
  router.get('/llm-metrics', asyncRoute(async (req, res) => {
    const limit = Math.min(Number(req.query.limit) || 200, 1000);
    res.json(computeLlmMetrics(await listRecentRuns(limit)));
  }));
  router.get('/qdrant-readiness', asyncRoute(async (_req, res) => res.json(await getQdrantReadiness())));
  router.get('/llm-readiness', (_req, res) => {
    const config = getLLMConfig();
    res.json({
      ...config,
      notes: config.configured
        ? [`Agents will call ${config.model} at ${config.baseUrl}.`]
        : ['未设置 OPENAI_API_KEY，所有 agent 当前运行在 fallback 启发式模式（输出为模板拼接，非真实生成）。']
    });
  });
  router.post('/rag-eval', asyncRoute(async (req, res) => {
    const { resumeId = null, text = '', queries = DEFAULT_GOLDEN_QUERIES, topK = 3 } = req.body || {};
    const resume = resumeId ? await getResume(resumeId) : null;
    if (resumeId && !resume) throw new HttpError(404, 'RESUME_NOT_FOUND', 'Resume not found');
    if (!resume && !String(text || '').trim()) throw new HttpError(400, 'VALIDATION_ERROR', 'resumeId or text is required');
    res.json(await evaluateRag({ resume, text, queries, topK }));
  }));
  return router;
}
