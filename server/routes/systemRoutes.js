import { Router } from 'express';
import { getDatabaseOverview, getDashboardSnapshot, getResume, getRun, listRecentRuns } from '../services/database.js';
import { getAppRoadmap } from '../services/appPlanner.js';
import { getLLMConfig } from '../services/llmClient.js';
import { computeLlmMetrics } from '../services/llmMetrics.js';
import {
  DEFAULT_GOLDEN_QUERIES,
  evaluateGoldenDataset,
  evaluateRag,
  loadGoldenDataset
} from '../services/ragEvaluation.js';
import { listTools } from '../mcp/server.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { createResumePilotMcpServer } from '../mcp/sdkServer.js';
import { listExternalTools, parseExternalMcpServers } from '../mcp/externalClient.js';
import { asyncRoute, HttpError } from '../middleware/http.js';
import { cleanupRetiredKnowledgeBases } from '../services/knowledgeBaseVersion.js';
import { runOrchestrationComparison } from '../experiments/orchestrationComparison.js';

export function createSystemRouter({ vectorProvider, computeDashboard, getQdrantReadiness }) {
  const router = Router();
  router.get('/health', asyncRoute(async (_req, res) => res.json({ ok: true, multiAgent: true, vectorProvider, db: await getDatabaseOverview() })));
  router.get('/mcp/tools', asyncRoute(async (_req, res) => {
    const externalServers = parseExternalMcpServers();
    const externalTools = externalServers.length ? await listExternalTools(externalServers) : [];
    res.json({ tools: listTools(), externalTools });
  }));
  router.post('/mcp', asyncRoute(async (req, res) => {
    const server = createResumePilotMcpServer();
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined });
    res.on('close', () => {
      transport.close().catch(() => {});
      server.close().catch(() => {});
    });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }));
  router.get('/mcp', (_req, res) => res.status(405).json({ error: 'Stateless MCP endpoint only accepts POST.' }));
  router.delete('/mcp', (_req, res) => res.status(405).json({ error: 'Stateless MCP endpoint does not maintain sessions.' }));
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
  router.post('/rag-eval/golden', asyncRoute(async (_req, res) => {
    res.json(await evaluateGoldenDataset({ dataset: await loadGoldenDataset() }));
  }));
  router.post('/knowledge-bases/cleanup', asyncRoute(async (req, res) => {
    const retentionDays = Number(req.body?.retentionDays ?? process.env.KB_RETENTION_DAYS ?? 7);
    if (!Number.isFinite(retentionDays) || retentionDays < 0) {
      throw new HttpError(400, 'VALIDATION_ERROR', 'retentionDays must be a non-negative number');
    }
    res.json(await cleanupRetiredKnowledgeBases({
      retentionDays,
      resumeId: req.body?.resumeId || null,
      dryRun: req.body?.dryRun !== false
    }));
  }));
  router.post('/experiments/orchestration', asyncRoute(async (req, res) => {
    res.json(await runOrchestrationComparison({
      input: req.body?.input,
      iterations: req.body?.iterations
    }));
  }));
  return router;
}
