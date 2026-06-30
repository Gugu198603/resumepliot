import 'dotenv/config';
import { createHash } from 'crypto';
import { pathToFileURL } from 'url';
import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { normalizeText, splitSections, detectRisks, rewriteResume } from './services/resumeParser.js';
import { buildKnowledgeBase, provider as vectorProvider } from './services/vectorStore.js';
import { retrieveContext } from './agents/retriever.js';
import { generateInterviewQuestions } from './agents/interviewer.js';
import { critiqueAnswer } from './agents/critic.js';
import { rewriteArtifacts } from './agents/writer.js';
import { matchJobDescription } from './agents/jdMatcher.js';
import { buildResumeComparison } from './agents/resumeComparer.js';
import { routeSkill } from './router/skillRouter.js';
import { handleMcpRequest } from './mcp/runtime.js';
import { listTools } from './mcp/server.js';
import { resolveExecutionPlan } from './services/skillWorkflow.js';
import {
  saveResumeRecord,
  createRunRecord,
  appendRunEvent,
  finalizeRunRecord,
  listRecentRuns,
  getDatabaseOverview,
  listResumes,
  getResume,
  updateResume,
  saveResumeCorrectionEvent,
  deleteResume,
  getRun,
  createSession,
  findOrCreateSessionByGoal,
  listSessions,
  getSession,
  appendSessionTurn,
  updateSessionTurns,
  getDashboardSnapshot,
  saveJobDescription,
  listJobDescriptions,
  getJobDescription,
  saveJobMatch,
  listJobMatches
} from './services/database.js';
import { getAppRoadmap } from './services/appPlanner.js';
import { getLLMConfig } from './services/llmClient.js';
import { computeLlmMetrics } from './services/llmMetrics.js';
import { loadRuntimeMemory, runAgentWorkflow } from './services/agentRuntime.js';
import { DEFAULT_GOLDEN_QUERIES, evaluateRag } from './services/ragEvaluation.js';
import { listSources, fetchFromSource } from './services/jobSources/index.js';
import { startScheduler, getSchedulerStatus, runOnce } from './services/jobScheduler.js';
import { logger } from './services/logger.js';
import { generateResumePreview } from './services/resumeGeneration.js';
import { buildCandidateProfile } from './services/candidateProfile.js';
import { corsOptionsFromEnv, basicSecurityHeaders, apiTokenAuth, createRateLimit } from './middleware/security.js';
import { errorHandler, notFoundHandler } from './middleware/http.js';
import { productRouter } from './routes/productRoutes.js';

const app = express();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_RESUME_UPLOAD_BYTES || 8 * 1024 * 1024), files: 1 },
  fileFilter(_req, file, callback) {
    const allowed = new Set(['application/pdf', 'text/plain', 'text/markdown']);
    const accepted = allowed.has(file.mimetype);
    callback(accepted ? null : new Error('仅支持 PDF、TXT 或 Markdown 简历。'), accepted);
  }
});
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

function resumeFingerprint(text = '') {
  const canonical = String(text || '')
    .replace(/\s+/g, '')
    .replace(/[，。；：、,. ;:]/g, '')
    .trim()
    .toLowerCase();
  return canonical ? createHash('sha256').update(canonical).digest('hex') : '';
}

function mergeDuplicateResumes(resumes = []) {
  const grouped = new Map();
  for (const resume of resumes) {
    const key = resumeFingerprint(resume.text || '');
    if (!key) {
      grouped.set(resume.id, { ...resume, duplicateCount: 1, duplicateIds: [resume.id] });
      continue;
    }
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...resume, duplicateCount: 1, duplicateIds: [resume.id] });
      continue;
    }
    existing.duplicateCount += 1;
    existing.duplicateIds.push(resume.id);
  }
  return [...grouped.values()];
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
  const corrections = db.corrections || [];
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
  const correctionResumeIds = new Set(corrections.map((item) => item.resumeId).filter(Boolean));
  const errorCounts = new Map();
  let changedSectionTitles = 0;
  let beforeSectionTotal = 0;
  let lineDeltaTotal = 0;
  for (const event of corrections) {
    const summary = event.summary || {};
    changedSectionTitles += Number(summary.changedSectionTitles || 0);
    beforeSectionTotal += Number(summary.beforeSectionCount || 0);
    lineDeltaTotal += Number(summary.lineDelta || 0);
    for (const type of event.errorTypes || summary.errorTypes || []) {
      errorCounts.set(type, (errorCounts.get(type) || 0) + 1);
    }
  }
  const correctionMetrics = {
    totalCorrections: corrections.length,
    correctedResumes: correctionResumeIds.size,
    correctionRate: resumes.length ? Number((correctionResumeIds.size / resumes.length).toFixed(2)) : 0,
    sectionChangeRatio: beforeSectionTotal ? Number((changedSectionTitles / beforeSectionTotal).toFixed(2)) : 0,
    avgLineDelta: corrections.length ? Number((lineDeltaTotal / corrections.length).toFixed(1)) : 0,
    commonErrorTypes: [...errorCounts.entries()].map(([type, count]) => ({ type, count })).sort((a, b) => b.count - a.count).slice(0, 6)
  };

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
    correctionMetrics,
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

function normalizeCorrectionSections(sections = []) {
  return Array.isArray(sections)
    ? sections.map((section) => ({
        title: String(section?.title || '未命名模块').trim() || '未命名模块',
        content: Array.isArray(section?.content)
          ? section.content.map((line) => String(line || '').trim()).filter(Boolean)
          : String(section?.content || '').split('\n').map((line) => line.trim()).filter(Boolean)
      })).filter((section) => section.content.length)
    : [];
}

function sectionsToText(sections = []) {
  return sections.map((section) => [section.title, ...(section.content || [])].filter(Boolean).join('\n')).join('\n');
}

function previewText(value = '', limit = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function buildCorrectionDiff(beforeSections = [], afterSections = []) {
  const max = Math.max(beforeSections.length, afterSections.length);
  const modules = [];
  for (let index = 0; index < max; index += 1) {
    const before = beforeSections[index] || null;
    const after = afterSections[index] || null;
    modules.push({
      index,
      beforeTitle: before?.title || null,
      afterTitle: after?.title || null,
      titleChanged: Boolean(before && after && before.title !== after.title),
      beforeLineCount: before?.content?.length || 0,
      afterLineCount: after?.content?.length || 0,
      lineDelta: (after?.content?.length || 0) - (before?.content?.length || 0),
      beforePreview: previewText((before?.content || [])[0] || ''),
      afterPreview: previewText((after?.content || [])[0] || ''),
      changeKind: before && after ? 'updated' : before ? 'removed' : 'added'
    });
  }
  return modules;
}

app.use(cors(corsOptionsFromEnv()));
app.use(basicSecurityHeaders);
app.use(createRateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_MAX || 120)
}));
app.use(apiTokenAuth);
app.use(express.json({ limit: '10mb' }));
app.use('/api', productRouter);

app.get('/api/health', async (_, res) => res.json({ ok: true, multiAgent: true, vectorProvider, db: await getDatabaseOverview() }));
app.get('/api/mcp/tools', (_, res) => res.json({ tools: listTools() }));
app.post('/api/mcp', async (req, res) => res.json(await handleMcpRequest(req.body)));
app.get('/api/app-roadmap', (_, res) => res.json(getAppRoadmap()));
app.get('/api/runs', async (_, res) => res.json({ runs: await listRecentRuns() }));
app.get('/api/dashboard', async (_, res) => { res.json(computeDashboard(await getDashboardSnapshot())); });
app.get('/api/llm-metrics', async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 200, 1000);
  res.json(computeLlmMetrics(await listRecentRuns(limit)));
});
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
app.post('/api/rag-eval', async (req, res) => {
  try {
    const { resumeId = null, text = '', queries = DEFAULT_GOLDEN_QUERIES, topK = 3 } = req.body || {};
    const resume = resumeId ? await getResume(resumeId) : null;
    if (resumeId && !resume) return res.status(404).json({ error: 'Resume not found' });
    if (!resume && !String(text || '').trim()) {
      return res.status(400).json({ error: 'resumeId or text is required' });
    }
    res.json(await evaluateRag({ resume, text, queries, topK }));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get('/api/runs/:id', async (req, res) => { const run = await getRun(req.params.id); if (!run) return res.status(404).json({ error: 'Run not found' }); res.json({ run }); });
app.get('/api/resumes', async (_, res) => {
  const resumes = await listResumes();
  res.json({ resumes: mergeDuplicateResumes(resumes) });
});
app.post('/api/resumes/compare', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
    const jdText = req.body?.jdText || '';
    const jobId = req.body?.jobId || null;
    if (ids.length < 2) return res.status(400).json({ error: 'At least two resume ids are required.' });
    const resumes = (await Promise.all(ids.map((id) => getResume(id)))).filter(Boolean);
    if (resumes.length < 2) return res.status(404).json({ error: 'Could not load at least two resumes.' });

    const comparison = buildResumeComparison(resumes);

    let jdContent = jdText;
    let job = null;
    if (jobId) {
      job = await getJobDescription(jobId);
      if (job) jdContent = job.text || '';
    }
    let jobMatchScores = null;
    if (jdContent.trim()) {
      jobMatchScores = await Promise.all(resumes.map(async (resume) => {
        const result = await matchJobDescription({ resumeText: resume.text || '', resumeChunks: resume.chunks || [], jdText: jdContent });
        return { id: resume.id, matchScore: result.matchScore, mode: result.mode };
      }));
    }
    res.json({ ...comparison, jobMatchScores, jobId: job?.id || null });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});
app.get('/api/resumes/:id', async (req, res) => { const resume = await getResume(req.params.id); if (!resume) return res.status(404).json({ error: 'Resume not found' }); res.json({ resume }); });
app.patch('/api/resumes/:id', async (req, res) => {
  const resume = await updateResume(req.params.id, { title: req.body?.title });
  if (!resume) return res.status(404).json({ error: 'Resume not found' });
  res.json({ resume });
});
app.post('/api/resumes/:id/corrections', async (req, res) => {
  try {
    const current = await getResume(req.params.id);
    if (!current) return res.status(404).json({ error: 'Resume not found' });
    const sections = normalizeCorrectionSections(req.body?.sections || []);
    if (!sections.length) return res.status(400).json({ error: 'sections is required' });
    const errorTypes = Array.isArray(req.body?.errorTypes) ? req.body.errorTypes : [];
    const beforeSections = current.sections || [];
    const moduleDiff = buildCorrectionDiff(beforeSections, sections);
    logger.info('resume_correction.request', {
      resumeId: current.id,
      errorTypes,
      beforeSectionCount: beforeSections.length,
      afterSectionCount: sections.length,
      moduleDiff
    });
    const text = typeof req.body?.text === 'string' && req.body.text.trim() ? normalizeText(req.body.text) : sectionsToText(sections);
    const risks = detectRisks(text);
    const kb = await buildKnowledgeBase(text, current.id);
    const chunks = kb.map((chunk) => ({ ...chunk, resumeId: current.id }));
    const correction = await saveResumeCorrectionEvent({
      resumeId: current.id,
      beforeSections,
      afterSections: sections,
      errorTypes
    });
    const resume = await updateResume(current.id, {
      text,
      sections,
      risks,
      kbSize: kb.length,
      chunks,
      vectorProvider
    });
    logger.info('resume_correction.saved', {
      resumeId: current.id,
      correctionId: correction.id,
      errorTypes: correction.errorTypes,
      summary: correction.summary,
      moduleDiff,
      rebuiltKbSize: kb.length,
      riskTerms: risks.map((risk) => risk.term)
    });
    res.json({ resume, correction });
  } catch (error) {
    logger.error('resume_correction.error', {
      resumeId: req.params.id,
      error: error.message
    });
    res.status(500).json({ error: error.message });
  }
});
app.post('/api/resumes/:id/generation-preview', async (req, res) => {
  try {
    const resume = await getResume(req.params.id);
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    const adjustment = String(req.body?.adjustment || '').trim();
    let jobDescription = String(req.body?.jdText || req.body?.jobDescription || '').trim();
    const jobId = req.body?.jobId || null;
    if (jobId && !jobDescription) {
      const job = await getJobDescription(jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      jobDescription = job.text || '';
    }
    const result = await generateResumePreview({ resume, adjustment, jobDescription });
    res.status(result.ok ? 200 : 422).json({
      resumeId: resume.id,
      adjustment,
      jobOptimizationAvailable: Boolean(jobDescription),
      ...result
    });
  } catch (error) {
    logger.error('resume_generation_preview.error', {
      resumeId: req.params.id,
      error: error.message
    });
    res.status(500).json({ error: error.message });
  }
});
app.delete('/api/resumes/:id', async (req, res) => {
  const removed = await deleteResume(req.params.id);
  if (!removed) return res.status(404).json({ error: 'Resume not found' });
  res.json({ ok: true, id: req.params.id });
});
app.get('/api/sessions', async (_, res) => { res.json({ sessions: await listSessions() }); });
app.get('/api/sessions/:id', async (req, res) => { const session = await getSession(req.params.id); if (!session) return res.status(404).json({ error: 'Session not found' }); res.json({ session }); });
app.post('/api/sessions', async (req, res) => { const title = req.body?.title || 'New Session'; const goal = req.body?.goal || title; const session = await createSession({ title, goal, resumeId: req.body?.resumeId || null }); res.json({ session }); });

app.post('/api/sessions/:id/continue', async (req, res) => {
  try {
    const session = await getSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'Session not found' });
    const { text = '', answer = '', resumeId = session.resumeId || null } = req.body || {};
    if (!String(answer || '').trim()) return res.status(400).json({ error: 'answer is required' });
    const turns = session.turns || [];
    const lastTurn = turns[turns.length - 1] || null;
    const depth = turns.filter((turn) => String(turn.answer || '').trim()).length;
    const askedQuestions = turns.map((t) => t.question).filter(Boolean);
    const memoryContext = await loadRuntimeMemory({ goal: session.goal || session.title || '', resumeId, sessionId: session.id });
    const retrieval = await retrieveContext({ text, query: session.goal || session.title || '', topK: 3, sessionTurns: turns, resumeId });
    const retrieved = retrieval.retrieved;
    const currentQuestion = lastTurn?.question || session.goal || session.title || '请介绍你的经历。';
    const critique = await critiqueAnswer({ answer, retrieved, question: currentQuestion, memoryContext });
    const rewrite = await rewriteArtifacts({ text, answer, feedback: critique?.feedback || [], memoryContext });
    const answeredTurn = lastTurn
      ? { ...lastTurn, answer, critique: critique?.feedback || [], scores: critique?.scores || {}, assessment: critique?.assessment || null, improvedAnswer: rewrite?.improvedAnswer || '', retrieved, resumeId, depth }
      : { id: makeId('turn'), question: currentQuestion, answer, critique: critique?.feedback || [], scores: critique?.scores || {}, assessment: critique?.assessment || null, improvedAnswer: rewrite?.improvedAnswer || '', retrieved, resumeId, depth };
    const answeredTurns = lastTurn ? [...turns.slice(0, -1), answeredTurn] : [answeredTurn];
    const interview = await generateInterviewQuestions({ goal: session.goal || session.title || '', retrieved, previousAnswer: answer, previousQuestion: currentQuestion, depth: depth + 1, askedQuestions, memoryContext });
    const questions = interview.questions;
    const question = questions?.detail?.[0] || questions?.basic?.[0] || '请继续介绍你的经历。';
    const nextTurn = { id: makeId('turn'), question, answer: '', critique: [], improvedAnswer: '', retrieved: [], resumeId, depth: depth + 1, stage: interview.stage };
    const updatedSession = await updateSessionTurns(session.id, [...answeredTurns, nextTurn]);
    res.json({ session: updatedSession, turn: nextTurn, answeredTurn, critique, rewrite, questions, depth: depth + 1, stage: interview.stage, retrieved, memoryContext, retrievalMeta: { resumeResults: retrieval.resumeResults, historyResults: retrieval.historyResults, kbSource: retrieval.kbSource, resumeId: retrieval.resumeId } });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
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
    const fingerprint = resumeFingerprint(text);
    const duplicate = fingerprint
      ? (await listResumes()).find((resume) => resumeFingerprint(resume.text || '') === fingerprint)
      : null;
    if (duplicate) {
      const sections = splitSections(text);
      const risks = detectRisks(text);
      const parsedChanged = JSON.stringify(duplicate.sections || []) !== JSON.stringify(sections);
      const resume = parsedChanged
        ? await updateResume(duplicate.id, { sections, risks })
        : duplicate;
      return res.json({
        resumeId: resume.id,
        text: resume.text || '',
        sections: resume.sections || [],
        risks: resume.risks || [],
        kbSize: resume.kbSize || 0,
        chunks: (resume.chunks || []).map(stripChunkForResponse),
        vectorProvider: resume.vectorProvider || vectorProvider,
        duplicateOf: resume.id,
        reusedExisting: true
      });
    }
    const sections = splitSections(text);
    const risks = detectRisks(text);
    const resumeId = makeId('resume');
    const kb = await buildKnowledgeBase(text, resumeId);
    const chunks = kb.map((chunk) => ({ ...chunk, resumeId }));
    const record = await saveResumeRecord({ id: resumeId, text, sections, risks, kbSize: kb.length, chunks, vectorProvider });
    res.json({ resumeId: record.id, text, sections, risks, kbSize: kb.length, chunks: chunks.map(stripChunkForResponse), vectorProvider, reusedExisting: false });
  } catch (error) {
    console.error('[parse]', error);
    res.status(500).json({ error: error.message, stack: error.stack });
  }
});

app.post('/api/agent-run', async (req, res) => {
  try {
      const { text = '', goal, answer = '', history = [], sessionId = null, resumeId = null, startNewSession = false } = req.body;
    const persistedResume = resumeId ? await getResume(resumeId) : null;
    const sourceText = persistedResume?.text || text || '';
    const sections = persistedResume?.sections || splitSections(sourceText);
    const risks = persistedResume?.risks || detectRisks(sourceText);
    const skill = await routeSkill({ goal: goal || '' });
    const executionPlan = resolveExecutionPlan({ content: skill.rawContent || '' });
    let sessionTurns = [];
    if (sessionId) {
      const session = await getSession(sessionId);
      sessionTurns = session?.turns || [];
    }
      const runtimeRunId = makeId('runtime');
      const run = await createRunRecord({
        runtimeRunId,
        status: 'running',
        goal,
        hasAnswer: Boolean(answer),
        sessionId,
        resumeId: persistedResume?.id || resumeId || null,
        skill: skill.selectedSkill,
        executionPlan,
        vectorProvider
      });
    const runtime = await runAgentWorkflow({
      goal,
      answer,
      history,
      sourceText,
      sections,
      risks,
      executionPlan,
      sessionTurns,
      sessionId,
      resumeId: persistedResume?.id || resumeId || null,
        vectorProvider,
        runtimeRunId,
        onRunEvent: (event) => appendRunEvent(run.id, event)
    });
      const { status, error, agentOutputs, llmTrace, llmSummary, parseOutput, plan, retrieved, questions, critique, rewrite, retrievalMeta, memoryContext, memoryWrite, recovery, runEvents, runtimeLimits, workspaceState, orchestrationHistory } = runtime;
    let session = null;
      if (status === 'succeeded' && (sessionId || goal)) {
        session = sessionId && !startNewSession
          ? await getSession(sessionId)
          : await createSession({ title: goal || '模拟面试', goal: goal || '模拟面试', resumeId: persistedResume?.id || resumeId || null });
      if (session) {
          const turn = { id: makeId('turn'), question: questions?.detail?.[0] || questions?.basic?.[0] || goal, answer, critique: critique?.feedback || [], improvedAnswer: rewrite?.improvedAnswer || '', retrieved, runId: run.id, resumeId: persistedResume?.id || resumeId || null };
          session = await appendSessionTurn(session.id, turn, run.id);
      }
    }
      const finalRecord = await finalizeRunRecord(run.id, { runId: run.id, runtimeRunId, status, error, goal, hasAnswer: Boolean(answer), sessionId: session?.id || sessionId || null, resumeId: persistedResume?.id || resumeId || null, skill: skill.selectedSkill, executionPlan, vectorProvider, agentOutputs, retrievalMeta, llmTrace, llmSummary, recovery, runEvents, runtimeLimits, parseOutput, plan, retrieved, questions, critique, rewrite, memoryContext, memoryWrite, workspaceState, orchestrationHistory });
    const responseStatus = status === 'succeeded' ? 200 : 500;
      res.status(responseStatus).json({ runId: run.id, runtimeRunId, status, error, sessionId: session?.id || null, resumeId: persistedResume?.id || resumeId || null, skill, executionPlan, agentOutputs, plan, parseOutput, retrieved, questions, critique, rewrite, retrievalMeta, memoryContext, memoryWrite, recovery, runEvents: finalRecord?.runEvents || runEvents, runtimeLimits, workspaceState, orchestrationHistory, vectorProvider, llmTrace, llmSummary });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

function writeSse(res, event, data) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
  res.flush?.();
}

app.post('/api/sessions/:id/continue/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.socket?.setNoDelay?.(true);
  res.flushHeaders?.();
  res.write(': connected\n\n');

  let closed = false;
  res.on('close', () => {
    closed = true;
  });
  const push = (type, payload = {}) => {
    if (!closed) writeSse(res, type, payload);
  };

  try {
    const session = await getSession(req.params.id);
    if (!session) {
      push('run_error', { error: 'Session not found' });
      return res.end();
    }
    const { text = '', answer = '', resumeId = session.resumeId || null } = req.body || {};
    if (!String(answer || '').trim()) {
      push('run_error', { error: 'answer is required' });
      return res.end();
    }

    const turns = session.turns || [];
    const lastTurn = turns[turns.length - 1] || null;
    const depth = turns.filter((turn) => String(turn.answer || '').trim()).length;
    const askedQuestions = turns.map((t) => t.question).filter(Boolean);
    const currentQuestion = lastTurn?.question || session.goal || session.title || '请介绍你的经历。';

    push('process_event', {
      id: 'memory',
      title: '读取上下文',
      detail: '正在读取本场面试历史和简历记忆。',
      reasoning: [
        { label: '输入识别', text: `当前问题：${currentQuestion}` },
        { label: '边界确认', text: `会话已回答 ${depth} 轮，目标是「${session.goal || session.title || '模拟面试'}」。` },
        { label: '处理意图', text: '先把历史问答和简历记忆取出来，后续评估不能脱离这些事实。' }
      ],
      status: 'running'
    });
    const memoryContext = await loadRuntimeMemory({ goal: session.goal || session.title || '', resumeId, sessionId: session.id });
    push('process_event', {
      id: 'memory',
      title: '读取上下文',
      detail: `已读取 ${memoryContext.items.length} 条相关记忆。`,
      reasoning: [
        { label: '读取结果', text: `命中 ${memoryContext.items.length} 条相关记忆。` },
        { label: '分布判断', text: Object.entries(memoryContext.buckets || {}).map(([key, value]) => `${key}: ${value}`).join('；') || '没有额外记忆分桶。' },
        { label: '后续用途', text: '这些记忆会作为回答评估和追问生成的背景约束。' }
      ],
      meta: Object.entries(memoryContext.buckets || {}).map(([key, value]) => `${key}: ${value}`),
      status: 'done'
    });

    push('process_event', {
      id: 'retriever',
      title: '检索相关经历',
      detail: 'retriever 正在从简历和历史回答中召回依据。',
      reasoning: [
        { label: '检索目标', text: `围绕「${session.goal || session.title || '当前面试目标'}」查找依据。` },
        { label: '检索范围', text: '同时参考简历正文和本场历史回答。' },
        { label: '处理意图', text: '先找到相关经历片段，再让 critic 判断回答是否贴合事实。' }
      ],
      status: 'running'
    });
    const retrieval = await retrieveContext({ text, query: session.goal || session.title || '', topK: 3, sessionTurns: turns, resumeId });
    const retrieved = retrieval.retrieved;
    push('process_event', {
      id: 'retriever',
      title: '检索相关经历',
      detail: `已召回 ${retrieved.length} 条可参考经历。`,
      reasoning: [
        { label: '召回结果', text: `从 ${retrieval.kbSource || '简历知识库'} 召回 ${retrieved.length} 条候选经历。` },
        { label: '依据片段', text: retrieved.slice(0, 2).map((item) => String(item.content || '').slice(0, 90)).join(' / ') || '没有召回到明确片段。' },
        { label: '下一步', text: '把这些依据交给 critic，用来对照用户回答。' }
      ],
      meta: retrieved.slice(0, 3).map((item) => String(item.content || '').slice(0, 90)),
      status: 'done'
    });

    push('process_event', {
      id: 'critic',
      title: '分析你的回答',
      detail: 'critic 正在评价回答的具体性、可信度和经历匹配度。',
      reasoning: [
        { label: '回答拆解', text: '先看回答里是否包含具体动作、技术细节、结果和复盘。' },
        { label: '事实对照', text: '再和召回的简历片段逐项对照，避免出现无依据表达。' },
        { label: '评分方向', text: '重点看具体性、可信度、语义匹配度和可追问空间。' }
      ],
      status: 'running'
    });
    const critique = await critiqueAnswer({ answer, retrieved, question: currentQuestion, memoryContext });
    push('process_event', {
      id: 'critic',
      title: '分析你的回答',
      detail: `已生成 ${critique?.feedback?.length || 0} 条反馈。`,
      reasoning: [
        { label: '评分结果', text: critique?.scores ? `语义匹配度 ${critique.scores.semanticMatch ?? '-'}，具体性 ${critique.scores.specificity ?? '-'}。` : '已完成回答质量评估。' },
        { label: '主要问题', text: (critique?.feedback || []).slice(0, 2).join(' / ') || '没有明显问题。' },
        { label: '下一步', text: '把反馈交给 writer，转成更好的面试表达。' }
      ],
      meta: (critique?.feedback || []).slice(0, 3),
      status: 'done'
    });

    push('process_event', {
      id: 'writer',
      title: '整理反馈表达',
      detail: 'writer 正在整理更好的回答表达。',
      reasoning: [
        { label: '改写策略', text: '把 critic 的问题转成“背景-行动-结果-复盘”的面试表达。' },
        { label: '事实约束', text: '只使用当前简历、回答和检索记忆中已有的信息。' },
        { label: '输出目标', text: '生成一版可参考表达，而不是替用户编造经历。' }
      ],
      status: 'running'
    });
    const rewrite = await rewriteArtifacts({ text, answer, feedback: critique?.feedback || [], memoryContext });
    push('process_event', {
      id: 'writer',
      title: '整理反馈表达',
      detail: rewrite?.improvedAnswer ? '已整理出可参考的改进回答。' : '已完成反馈整理。',
      reasoning: [
        { label: '保留内容', text: '保留用户回答中已有的事实和技术上下文。' },
        { label: '表达调整', text: rewrite?.improvedAnswer ? String(rewrite.improvedAnswer).slice(0, 140) : '没有生成额外改写内容。' },
        { label: '风险控制', text: '不新增无法验证的简历实体或夸张指标。' }
      ],
      meta: rewrite?.improvedAnswer ? [String(rewrite.improvedAnswer).slice(0, 120)] : [],
      status: 'done'
    });

    const answeredTurn = lastTurn
      ? { ...lastTurn, answer, critique: critique?.feedback || [], scores: critique?.scores || {}, assessment: critique?.assessment || null, improvedAnswer: rewrite?.improvedAnswer || '', retrieved, resumeId, depth }
      : { id: makeId('turn'), question: currentQuestion, answer, critique: critique?.feedback || [], scores: critique?.scores || {}, assessment: critique?.assessment || null, improvedAnswer: rewrite?.improvedAnswer || '', retrieved, resumeId, depth };
    const answeredTurns = lastTurn ? [...turns.slice(0, -1), answeredTurn] : [answeredTurn];

    push('process_event', {
      id: 'interviewer',
      title: '生成下一轮追问',
      detail: 'interviewer 正在基于你的回答继续追问。',
      reasoning: [
        { label: '追问依据', text: '综合当前回答、critic 反馈和召回经历。' },
        { label: '追问方向', text: '优先追问回答中的薄弱点、关键技术选择或高价值项目细节。' },
        { label: '目标', text: '让下一题能继续验证能力，而不是随机换话题。' }
      ],
      status: 'running'
    });
    const interview = await generateInterviewQuestions({ goal: session.goal || session.title || '', retrieved, previousAnswer: answer, previousQuestion: currentQuestion, depth: depth + 1, askedQuestions, memoryContext });
    const questions = interview.questions;
    const question = questions?.detail?.[0] || questions?.basic?.[0] || '请继续介绍你的经历。';
    const nextTurn = { id: makeId('turn'), question, answer: '', critique: [], improvedAnswer: '', retrieved: [], resumeId, depth: depth + 1, stage: interview.stage };
    const updatedSession = await updateSessionTurns(session.id, [...answeredTurns, nextTurn]);
    push('process_event', {
      id: 'interviewer',
      title: '生成下一轮追问',
      detail: '下一轮问题已生成。',
      reasoning: [
        { label: '阶段判断', text: `本轮进入「${interview.stage || '追问'}」阶段。` },
        { label: '问题生成', text: question },
        { label: '为什么问这个', text: '这个问题用于继续验证上一轮回答中最值得深挖的能力点。' }
      ],
      meta: [question],
      status: 'done'
    });
    push('run_complete', { session: updatedSession, turn: nextTurn, answeredTurn, critique, rewrite, questions, depth: depth + 1, stage: interview.stage, retrieved, memoryContext, retrievalMeta: { resumeResults: retrieval.resumeResults, historyResults: retrieval.historyResults, kbSource: retrieval.kbSource, resumeId: retrieval.resumeId } });
    res.end();
  } catch (error) {
    logger.error('session_continue_stream.error', { sessionId: req.params.id, error: error.message });
    push('run_error', { error: error.message });
    res.end();
  }
});

app.post('/api/agent-run/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream; charset=utf-8');
  res.setHeader('Cache-Control', 'no-cache, no-transform');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.socket?.setNoDelay?.(true);
  res.flushHeaders?.();
  res.write(': connected\n\n');

  let closed = false;
  res.on('close', () => {
    closed = true;
  });

  try {
    const { text = '', goal, answer = '', history = [], sessionId = null, resumeId = null, startNewSession = false } = req.body || {};
    const persistedResume = resumeId ? await getResume(resumeId) : null;
    const sourceText = persistedResume?.text || text || '';
    const sections = persistedResume?.sections || splitSections(sourceText);
    const risks = persistedResume?.risks || detectRisks(sourceText);
    const skill = await routeSkill({ goal: goal || '' });
    const executionPlan = resolveExecutionPlan({ content: skill.rawContent || '' });
    let sessionTurns = [];
    if (sessionId) {
      const session = await getSession(sessionId);
      sessionTurns = session?.turns || [];
    }

    const runtimeRunId = makeId('runtime');
    const run = await createRunRecord({
      runtimeRunId,
      status: 'running',
      goal,
      hasAnswer: Boolean(answer),
      sessionId,
      resumeId: persistedResume?.id || resumeId || null,
      skill: skill.selectedSkill,
      executionPlan,
      vectorProvider,
      resultJson: {
        runtimeRunId,
        status: 'running',
        goal,
        hasAnswer: Boolean(answer),
        skill: skill.selectedSkill,
        executionPlan,
        vectorProvider
      }
    });
    writeSse(res, 'run_created', { runId: run.id, runtimeRunId, status: 'running', executionPlan, skill });

    const runtime = await runAgentWorkflow({
      goal,
      answer,
      history,
      sourceText,
      sections,
      risks,
      executionPlan,
      sessionTurns,
      sessionId,
      resumeId: persistedResume?.id || resumeId || null,
      vectorProvider,
      runtimeRunId,
      onRunEvent: async (event) => {
        const savedEvent = await appendRunEvent(run.id, event);
        if (!closed) writeSse(res, 'run_event', savedEvent || event);
      }
    });

    const {
      status,
      error,
      agentOutputs,
      llmTrace,
      llmSummary,
      parseOutput,
      plan,
      retrieved,
      questions,
      critique,
      rewrite,
      retrievalMeta,
      memoryContext,
      memoryWrite,
      recovery,
      runEvents,
      runtimeLimits,
      workspaceState,
      orchestrationHistory
    } = runtime;

    let session = null;
    if (status === 'succeeded' && (sessionId || goal)) {
      session = sessionId && !startNewSession
        ? await getSession(sessionId)
        : await createSession({ title: goal || '模拟面试', goal: goal || '模拟面试', resumeId: persistedResume?.id || resumeId || null });
      if (session) {
        const turn = {
          id: makeId('turn'),
          question: questions?.detail?.[0] || questions?.basic?.[0] || goal,
          answer,
          critique: critique?.feedback || [],
          improvedAnswer: rewrite?.improvedAnswer || '',
          retrieved,
          runId: run.id,
          resumeId: persistedResume?.id || resumeId || null
        };
        session = await appendSessionTurn(session.id, turn, run.id);
      }
    }

    const finalRecord = await finalizeRunRecord(run.id, {
      runId: run.id,
      runtimeRunId,
      status,
      error,
      goal,
      hasAnswer: Boolean(answer),
      sessionId: session?.id || sessionId || null,
      resumeId: persistedResume?.id || resumeId || null,
      skill: skill.selectedSkill,
      executionPlan,
      vectorProvider,
      agentOutputs,
      retrievalMeta,
      llmTrace,
      llmSummary,
      recovery,
      runtimeLimits,
      parseOutput,
      plan,
      retrieved,
      questions,
      critique,
      rewrite,
      memoryContext,
      memoryWrite,
      workspaceState,
      orchestrationHistory,
      runEvents,
      latencyMs: runtime.runEvents?.findLast?.((event) => event.type === 'run_success' || event.type === 'run_failed')?.latencyMs
    });

    if (!closed) {
      writeSse(res, 'run_complete', {
        runId: run.id,
        runtimeRunId,
        status,
        error,
        sessionId: session?.id || null,
        resumeId: persistedResume?.id || resumeId || null,
        skill,
        executionPlan,
        agentOutputs,
        plan,
        parseOutput,
        retrieved,
        questions,
        critique,
        rewrite,
        retrievalMeta,
        memoryContext,
        memoryWrite,
        recovery,
        runEvents: finalRecord?.runEvents || runEvents,
        runtimeLimits,
        workspaceState,
        orchestrationHistory,
        vectorProvider,
        llmTrace,
        llmSummary
      });
      res.end();
    }
  } catch (error) {
    logger.error('agent_run_stream.error', { error: error.message });
    if (!closed) {
      writeSse(res, 'run_error', { error: error.message });
      res.end();
    }
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
    const { resumeId = null, jdText = '', text = '', jobId = null, title = null, company = null, sourceUrl = null } = req.body || {};
    let jdContent = jdText;
    let job = null;
    if (jobId) {
      job = await getJobDescription(jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      jdContent = job.text || '';
    }
    if (!jdContent.trim()) return res.status(400).json({ error: 'jdText or jobId is required' });
    const persistedResume = resumeId ? await getResume(resumeId) : null;
    const resumeText = persistedResume?.text || text || '';
    const resumeChunks = persistedResume?.chunks || [];
    if (!resumeText.trim() && !resumeChunks.length) {
      return res.status(400).json({ error: 'No resume content. Provide resumeId or text.' });
    }
    if (!job) {
      job = await saveJobDescription({ title, company, sourceUrl, source: 'manual', text: jdContent });
    }
    const candidateProfile = buildCandidateProfile(persistedResume || { text: resumeText, sections: splitSections(resumeText) });
    const result = await matchJobDescription({ resumeText, resumeChunks, jdText: jdContent, candidateProfile });
    const match = await saveJobMatch({ jobId: job.id, resumeId: persistedResume?.id || resumeId || null, matchScore: result.matchScore, result });
    res.json({ resumeId: persistedResume?.id || resumeId || null, jobId: job.id, matchId: match.id, candidateProfile, ...result });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get('/api/jobs', async (_, res) => { res.json({ jobs: await listJobDescriptions() }); });
app.get('/api/job-matches', async (_, res) => { res.json({ matches: await listJobMatches() }); });
app.get('/api/job-sources', (_, res) => res.json({ sources: listSources() }));
app.get('/api/job-scheduler', (_, res) => res.json(getSchedulerStatus()));
app.post('/api/job-scheduler/run', async (req, res) => {
  try {
    const jobs = Array.isArray(req.body?.jobs) ? req.body.jobs : undefined;
    const summary = await runOnce(jobs);
    res.json(summary);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/jobs/fetch', async (req, res) => {
  try {
    const { source = 'url', config = {} } = req.body || {};
    const fetched = await fetchFromSource(source, config);
    const saved = [];
    const errors = [];
    for (const job of fetched) {
      if (job.error) { errors.push({ sourceUrl: job.sourceUrl, error: job.error }); continue; }
      saved.push(await saveJobDescription(job));
    }
    res.json({ source, savedCount: saved.length, jobs: saved, errors });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.use(notFoundHandler);
app.use(errorHandler);

export { app };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(PORT, () => {
    console.log(`ResumePilot Web App server running at http://localhost:${PORT}`);
    const scheduler = startScheduler();
    if (scheduler.enabled) {
      console.log(`Job scheduler enabled: sources=[${scheduler.sources.join(', ')}], interval=${scheduler.intervalMs}ms`);
    }
  });
}
