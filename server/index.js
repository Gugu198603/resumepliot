import 'dotenv/config';
import { createHash } from 'crypto';
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
  saveRunRecord,
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

app.use(cors());
app.use(express.json({ limit: '10mb' }));

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
      ? { ...lastTurn, answer, critique: critique?.feedback || [], improvedAnswer: rewrite?.improvedAnswer || '', retrieved, resumeId, depth }
      : { id: makeId('turn'), question: currentQuestion, answer, critique: critique?.feedback || [], improvedAnswer: rewrite?.improvedAnswer || '', retrieved, resumeId, depth };
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
    const { text = '', goal, answer = '', history = [], sessionId = null, resumeId = null } = req.body;
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
      vectorProvider
    });
    const { status, error, agentOutputs, llmTrace, llmSummary, parseOutput, plan, retrieved, questions, critique, rewrite, retrievalMeta, memoryContext, memoryWrite, recovery, runtimeRunId, runEvents, runtimeLimits } = runtime;
    const record = await saveRunRecord({ status, error, goal, hasAnswer: Boolean(answer), sessionId, resumeId: persistedResume?.id || resumeId || null, skill: skill.selectedSkill, executionPlan, vectorProvider, agentOutputs, retrievalMeta, llmTrace, llmSummary, recovery, runtimeRunId, runEvents, runtimeLimits });
    let session = null;
    if (status === 'succeeded' && (sessionId || goal)) {
      session = sessionId ? await getSession(sessionId) : await findOrCreateSessionByGoal(goal, { resumeId: persistedResume?.id || resumeId || null });
      if (session) {
        const turn = { id: makeId('turn'), question: questions?.detail?.[0] || questions?.basic?.[0] || goal, answer, critique: critique?.feedback || [], improvedAnswer: rewrite?.improvedAnswer || '', retrieved, runId: record.id, resumeId: persistedResume?.id || resumeId || null };
        session = await appendSessionTurn(session.id, turn, record.id);
      }
    }
    const responseStatus = status === 'succeeded' ? 200 : 500;
    res.status(responseStatus).json({ runId: record.id, runtimeRunId, status, error, sessionId: session?.id || null, resumeId: persistedResume?.id || resumeId || null, skill, executionPlan, agentOutputs, plan, parseOutput, retrieved, questions, critique, rewrite, retrievalMeta, memoryContext, memoryWrite, recovery, runEvents, runtimeLimits, vectorProvider, llmTrace, llmSummary });
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
    const result = await matchJobDescription({ resumeText, resumeChunks, jdText: jdContent });
    const match = await saveJobMatch({ jobId: job.id, resumeId: persistedResume?.id || resumeId || null, matchScore: result.matchScore, result });
    res.json({ resumeId: persistedResume?.id || resumeId || null, jobId: job.id, matchId: match.id, ...result });
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

app.listen(PORT, () => {
  console.log(`ResumePilot Web App server running at http://localhost:${PORT}`);
  const scheduler = startScheduler();
  if (scheduler.enabled) {
    console.log(`Job scheduler enabled: sources=[${scheduler.sources.join(', ')}], interval=${scheduler.intervalMs}ms`);
  }
});
