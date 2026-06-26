import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { normalizeText, splitSections, detectRisks, rewriteResume } from './services/resumeParser.js';
import { buildKnowledgeBase, provider as vectorProvider } from './services/vectorStore.js';
import { planNextStep } from './agents/planner.js';
import { retrieveContext } from './agents/retriever.js';
import { generateInterviewQuestions } from './agents/interviewer.js';
import { critiqueAnswer } from './agents/critic.js';
import { rewriteArtifacts } from './agents/writer.js';
import { matchJobDescription } from './agents/jdMatcher.js';
import { routeSkill } from './router/skillRouter.js';
import { handleMcpRequest } from './mcp/runtime.js';
import { listTools } from './mcp/server.js';
import { resolveExecutionPlan } from './services/skillWorkflow.js';
import {
  saveResumeRecord,
  saveRunRecord,
  listRecentRuns,
  getDatabaseOverview,
  listResumes,
  getResume,
  getRun,
  createSession,
  findOrCreateSessionByGoal,
  listSessions,
  getSession,
  appendSessionTurn,
  getDashboardSnapshot
} from './services/database.js';
import { getAppRoadmap } from './services/appPlanner.js';
import { getLLMConfig } from './services/llmClient.js';

const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = Number(process.env.PORT || 8787);

function makeId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function summarizeLlmTrace(trace = []) {
  const calls = trace.length;
  const liveCalls = trace.filter((t) => t.mode === 'live').length;
  const totalLatencyMs = trace.reduce((sum, t) => sum + (t.latencyMs || 0), 0);
  const totalTokens = trace.reduce((sum, t) => sum + (t.usage?.totalTokens || 0), 0);
  const models = [...new Set(trace.map((t) => t.model).filter(Boolean))];
  const errors = trace.filter((t) => t.error).map((t) => ({ agent: t.agent, error: t.error }));
  return {
    calls,
    liveCalls,
    fallbackCalls: calls - liveCalls,
    mode: calls === 0 ? 'none' : liveCalls === calls ? 'live' : liveCalls === 0 ? 'fallback' : 'mixed',
    totalLatencyMs,
    avgLatencyMs: calls ? Math.round(totalLatencyMs / calls) : 0,
    totalTokens,
    models,
    errors
  };
}

function stripChunkForResponse(chunk) {
  const { embedding, ...safeChunk } = chunk;
  return safeChunk;
}

async function getQdrantReadiness() {
  const provider = vectorProvider;
  const readiness = {
    provider,
    configured: provider === 'qdrant',
    env: {
      QDRANT_URL: process.env.QDRANT_URL || null,
      QDRANT_COLLECTION: process.env.QDRANT_COLLECTION || 'resume_chunks',
      QDRANT_VECTOR_SIZE: process.env.QDRANT_VECTOR_SIZE || '1024',
      QDRANT_API_KEY: process.env.QDRANT_API_KEY ? 'configured' : 'not_set'
    },
    serviceReachable: false,
    collectionReachable: false,
    notes: []
  };

  if (provider !== 'qdrant') {
    readiness.notes.push('当前 provider 不是 qdrant，所以实际检索不会走向量数据库。');
    return readiness;
  }

  if (!process.env.QDRANT_URL) {
    readiness.notes.push('未设置 QDRANT_URL。');
    return readiness;
  }

  try {
    const headers = {
      'Content-Type': 'application/json',
      ...(process.env.QDRANT_API_KEY ? { 'api-key': process.env.QDRANT_API_KEY } : {})
    };
    const root = await fetch(`${process.env.QDRANT_URL}/collections`, { headers });
    readiness.serviceReachable = root.ok;
    if (!root.ok) readiness.notes.push(`Qdrant service responded with status ${root.status}.`);

    const collectionName = process.env.QDRANT_COLLECTION || 'resume_chunks';
    const col = await fetch(`${process.env.QDRANT_URL}/collections/${collectionName}`, { headers });
    readiness.collectionReachable = col.ok;
    if (!col.ok) readiness.notes.push(`Collection ${collectionName} is not reachable yet.`);
  } catch (error) {
    readiness.notes.push(`Qdrant connectivity failed: ${error.message}`);
  }

  if (readiness.serviceReachable && readiness.collectionReachable) {
    readiness.notes.push('Qdrant service and collection are both reachable.');
  }
  return readiness;
}

function computeDashboard(db) {
  const resumes = db.resumes || [];
  const runs = db.runs || [];
  const sessions = db.sessions || [];
  const totalTurns = sessions.reduce((sum, s) => sum + (s.turns?.length || 0), 0);
  const retrievalItems = sessions.flatMap((s) => (s.turns || []).flatMap((t) => t.retrieved || []));
  const retrievedScores = retrievalItems.map((r) => Number(r.score || 0));
  const avgRetrieval = retrievedScores.length ? retrievedScores.reduce((a, b) => a + b, 0) / retrievedScores.length : 0;
  const sessionDepthAvg = sessions.length ? totalTurns / sessions.length : 0;
  const runsWithSkill = runs.filter((r) => r.skill?.name || r.skillId).length;
  const avgCritiqueLength = sessions.length ? sessions.flatMap((s) => (s.turns || []).map((t) => Array.isArray(t.critique) ? t.critique.join(' ').length : String(t.critique || '').length)).reduce((a, b) => a + b, 0) / Math.max(1, totalTurns) : 0;
  const improvedCoverage = totalTurns ? sessions.flatMap((s) => s.turns || []).filter((t) => t.improvedAnswer && String(t.improvedAnswer).trim().length > 0).length / totalTurns : 0;
  const sessionHistoryHits = retrievalItems.filter((r) => r.source === 'session_history').length;
  const resumeHits = retrievalItems.filter((r) => r.source === 'resume').length;
  const sourceMix = retrievalItems.length ? { resume: Number((resumeHits / retrievalItems.length).toFixed(2)), session_history: Number((sessionHistoryHits / retrievalItems.length).toFixed(2)) } : { resume: 0, session_history: 0 };

  return {
    overview: { resumes: resumes.length, runs: runs.length, sessions: sessions.length, totalTurns, vectorProvider },
    quality: {
      avgRetrievalScore: Number(avgRetrieval.toFixed(3)),
      avgSessionDepth: Number(sessionDepthAvg.toFixed(2)),
      skillRoutedRuns: runsWithSkill,
      riskCoverage: resumes.length ? Number((resumes.filter((r) => (r.risks || []).length > 0).length / resumes.length).toFixed(2)) : 0,
      avgCritiqueLength: Number(avgCritiqueLength.toFixed(1)),
      improvedAnswerCoverage: Number(improvedCoverage.toFixed(2))
    },
    sourceMix,
    trend: sessions.map((s) => ({ title: s.title, turns: s.turns?.length || 0, createdAt: s.createdAt })),
    retrievalSamples: sessions.flatMap((s) => (s.turns || []).slice(-2).map((t) => ({ session: s.title, question: t.question, retrieved: t.retrieved || [] }))).slice(-6),
    evalNotes: [
      'avgRetrievalScore 反映当前上下文召回相关性。',
      'avgSessionDepth 反映用户是否形成持续训练行为。',
      'sourceMix 反映系统是更多依赖简历还是历史对话。',
      'improvedAnswerCoverage 反映改写模块在多轮会话中的参与程度。'
    ]
  };
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', async (_, res) => res.json({ ok: true, multiAgent: true, vectorProvider, db: await getDatabaseOverview() }));
app.get('/api/mcp/tools', (_, res) => res.json({ tools: listTools() }));
app.post('/api/mcp', async (req, res) => res.json(await handleMcpRequest(req.body)));
app.get('/api/app-roadmap', (_, res) => res.json(getAppRoadmap()));
app.get('/api/runs', async (_, res) => res.json({ runs: await listRecentRuns() }));
app.get('/api/dashboard', async (_, res) => { res.json(computeDashboard(await getDashboardSnapshot())); });
app.get('/api/qdrant-readiness', async (_, res) => { res.json(await getQdrantReadiness()); });
app.get('/api/llm-readiness', (_, res) => {
  const config = getLLMConfig();
  res.json({
    ...config,
    notes: config.configured
      ? [`Agents will call ${config.model} at ${config.baseUrl}.`]
      : ['未设置 OPENAI_API_KEY，所有 agent 当前运行在 fallback 启发式模式（输出为模板拼接，非真实生成）。']
  });
});
app.get('/api/runs/:id', async (req, res) => { const run = await getRun(req.params.id); if (!run) return res.status(404).json({ error: 'Run not found' }); res.json({ run }); });
app.get('/api/resumes', async (_, res) => { res.json({ resumes: await listResumes() }); });
app.get('/api/resumes/:id', async (req, res) => { const resume = await getResume(req.params.id); if (!resume) return res.status(404).json({ error: 'Resume not found' }); res.json({ resume }); });
app.get('/api/sessions', async (_, res) => { res.json({ sessions: await listSessions() }); });
app.get('/api/sessions/:id', async (req, res) => { const session = await getSession(req.params.id); if (!session) return res.status(404).json({ error: 'Session not found' }); res.json({ session }); });
app.post('/api/sessions', async (req, res) => { const title = req.body?.title || 'New Session'; const goal = req.body?.goal || title; const session = await createSession({ title, goal, resumeId: req.body?.resumeId || null }); res.json({ session }); });

app.post('/api/sessions/:id/continue', async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });
  const { text = '', answer = '', resumeId = session.resumeId || null } = req.body || {};
  const lastTurn = session.turns?.[session.turns.length - 1] || null;
  const retrieval = await retrieveContext({ text, query: session.goal || session.title || '', topK: 3, sessionTurns: session.turns || [], resumeId });
  const retrieved = retrieval.retrieved;
  const { questions } = await generateInterviewQuestions({ goal: session.goal || session.title || '', retrieved, previousAnswer: answer, previousQuestion: lastTurn?.question || '' });
  const question = questions?.detail?.[0] || questions?.basic?.[0] || '请继续介绍你的经历。';
  const critique = await critiqueAnswer({ answer, retrieved, question });
  const rewrite = await rewriteArtifacts({ text, answer, feedback: critique?.feedback || [] });
  const turn = { id: makeId('turn'), question, answer, critique: critique?.feedback || [], improvedAnswer: rewrite?.improvedAnswer || '', retrieved, resumeId };
  const updatedSession = await appendSessionTurn(session.id, turn);
  res.json({ session: updatedSession, turn, critique, rewrite, questions, retrieved, retrievalMeta: { resumeResults: retrieval.resumeResults, historyResults: retrieval.historyResults, kbSource: retrieval.kbSource, resumeId: retrieval.resumeId } });
});

app.post('/api/skill-route', async (req, res) => {
  try {
    const { goal = '' } = req.body || {};
    const skill = await routeSkill({ goal });
    const executionPlan = skill.selectedSkill ? resolveExecutionPlan({ content: skill.rawContent || '' }) : [];
    res.json({ ...skill, executionPlan });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/parse', upload.single('resume'), async (req, res) => {
  try {
    let text = req.body.text || '';
    if (req.file) {
      if (req.file.mimetype.includes('pdf')) {
        const parsed = await pdfParse(req.file.buffer);
        text = parsed.text || text;
      } else {
        text = req.file.buffer.toString('utf8');
      }
    }
    text = normalizeText(text);
    const sections = splitSections(text);
    const risks = detectRisks(text);
    const resumeId = makeId('resume');
    const kb = await buildKnowledgeBase(text, resumeId);
    const chunks = kb.map((chunk) => ({ ...chunk, resumeId }));
    const record = await saveResumeRecord({ id: resumeId, text, sections, risks, kbSize: kb.length, chunks, vectorProvider });
    res.json({ resumeId: record.id, text, sections, risks, kbSize: kb.length, chunks: chunks.map(stripChunkForResponse), vectorProvider });
  } catch (error) {
    console.error('[parse]', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.post('/api/agent-run', async (req, res) => {
  try {
    const { text = '', goal, answer = '', history = [], sessionId = null, resumeId = null } = req.body;
    const persistedResume = resumeId ? await getResume(resumeId) : null;
    const sourceText = persistedResume?.text || text || '';
    const sections = persistedResume?.sections || splitSections(sourceText);
    const skill = await routeSkill({ goal: goal || '' });
    const executionPlan = resolveExecutionPlan({ content: skill.rawContent || '' });
    const agentOutputs = [];
    const llmTrace = [];
    let parseOutput = null;
    let plan = null;
    let retrieved = [];
    let questions = null;
    let critique = null;
    let rewrite = null;
    let retrievalMeta = null;
    let sessionTurns = [];
    if (sessionId) {
      const session = await getSession(sessionId);
      sessionTurns = session?.turns || [];
    }
    for (const step of executionPlan) {
      if (step.agent === 'parser') {
        parseOutput = { sections, risks: persistedResume?.risks || detectRisks(sourceText) };
        agentOutputs.push({ step, output: parseOutput });
      } else if (step.agent === 'planner') {
        plan = await planNextStep({ goal, history, sections });
        if (plan.llm) llmTrace.push({ agent: 'planner', ...plan.llm });
        agentOutputs.push({ step, output: plan });
      } else if (step.agent === 'retriever') {
        const result = await retrieveContext({ text: sourceText, query: goal, topK: 3, sessionTurns, resumeId: persistedResume?.id || resumeId });
        retrieved = result.retrieved;
        retrievalMeta = { resumeResults: result.resumeResults, historyResults: result.historyResults, kbSource: result.kbSource, resumeId: result.resumeId };
        agentOutputs.push({ step, output: { retrieved, retrievalMeta } });
      } else if (step.agent === 'interviewer') {
        const result = await generateInterviewQuestions({ goal, retrieved, previousAnswer: answer });
        questions = result.questions;
        if (result.llm) llmTrace.push({ agent: 'interviewer', ...result.llm });
        agentOutputs.push({ step, output: result });
      } else if (step.agent === 'critic' && answer) {
        critique = await critiqueAnswer({ answer, retrieved, question: questions?.detail?.[0] || questions?.basic?.[0] || '' });
        if (critique.llm) llmTrace.push({ agent: 'critic', ...critique.llm });
        agentOutputs.push({ step, output: critique });
      } else if (step.agent === 'writer' && answer) {
        rewrite = await rewriteArtifacts({ text: sourceText, answer, feedback: critique?.feedback || [] });
        if (rewrite.llm) llmTrace.push({ agent: 'writer', ...rewrite.llm });
        agentOutputs.push({ step, output: rewrite });
      }
    }
    const llmSummary = summarizeLlmTrace(llmTrace);
    const record = await saveRunRecord({ goal, hasAnswer: Boolean(answer), resumeId: persistedResume?.id || resumeId || null, skill: skill.selectedSkill, executionPlan, vectorProvider, agentOutputs, retrievalMeta, llmTrace, llmSummary });
    let session = null;
    if (sessionId || goal) {
      session = sessionId ? await getSession(sessionId) : await findOrCreateSessionByGoal(goal, { resumeId: persistedResume?.id || resumeId || null });
      if (session) {
        const turn = { id: makeId('turn'), question: questions?.detail?.[0] || questions?.basic?.[0] || goal, answer, critique: critique?.feedback || [], improvedAnswer: rewrite?.improvedAnswer || '', retrieved, runId: record.id, resumeId: persistedResume?.id || resumeId || null };
        session = await appendSessionTurn(session.id, turn, record.id);
      }
    }
    res.json({ runId: record.id, sessionId: session?.id || null, resumeId: persistedResume?.id || resumeId || null, skill, executionPlan, agentOutputs, plan, parseOutput, retrieved, questions, critique, rewrite, retrievalMeta, vectorProvider, llmTrace, llmSummary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/rewrite', async (req, res) => {
  try {
    const { text, answer = '', feedback = [] } = req.body;
    const base = rewriteResume(text || '');
    const enhanced = await rewriteArtifacts({ text: text || '', answer, feedback });
    res.json({ ...base, improvedAnswer: enhanced.improvedAnswer, mode: enhanced.mode });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/jd-match', async (req, res) => {
  try {
    const { resumeId = null, jdText = '', text = '' } = req.body || {};
    if (!jdText.trim()) return res.status(400).json({ error: 'jdText is required' });
    const persistedResume = resumeId ? await getResume(resumeId) : null;
    const resumeText = persistedResume?.text || text || '';
    const resumeChunks = persistedResume?.chunks || [];
    if (!resumeText.trim() && !resumeChunks.length) {
      return res.status(400).json({ error: 'No resume content. Provide resumeId or text.' });
    }
    const result = await matchJobDescription({ resumeText, resumeChunks, jdText });
    res.json({ resumeId: persistedResume?.id || resumeId || null, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.listen(PORT, () => {
  console.log(`ResumePilot Web App server running at http://localhost:${PORT}`);
});
