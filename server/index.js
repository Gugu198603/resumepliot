import express from 'express';
import cors from 'cors';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { normalizeText, splitSections, detectRisks, rewriteResume } from './services/resumeParser.js';
import { buildKnowledgeBase, provider as vectorProvider } from './services/vectorStore.js';
import { planNextStep } from './agents/planner.js';
import { retrieveContext } from './agents/retriever.js';
import { generateInterviewQuestions } from './agents/interviewer.js';
import { critiqueAnswer } from './agents/critic.js';
import { rewriteArtifacts } from './agents/writer.js';
import { routeSkill } from './router/skillRouter.js';
import { handleMcpRequest } from './mcp/runtime.js';
import { listTools } from './mcp/server.js';
import { resolveExecutionPlan } from './services/skillWorkflow.js';
import { saveResumeRecord, saveRunRecord, listRecentRuns, getDatabaseOverview } from './services/database.js';
import { getAppRoadmap } from './services/appPlanner.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const app = express();
const upload = multer({ storage: multer.memoryStorage() });
const PORT = 8787;
const dataFile = path.resolve(__dirname, '../data/app-db.json');

async function readLocalDb() { try { return JSON.parse(await fs.readFile(dataFile, 'utf8')); } catch { return { sessions: [], resumes: [], runs: [] }; } }
async function writeLocalDb(db) { await fs.mkdir(path.dirname(dataFile), { recursive: true }); await fs.writeFile(dataFile, JSON.stringify(db, null, 2)); }
function ensureSession(db, goal) {
  const title = goal || 'Default Session';
  let session = (db.sessions || []).find((s) => s.title === title);
  if (!session) {
    session = { id: `session_${Date.now()}`, title, goal: title, createdAt: new Date().toISOString(), turns: [], runs: [] };
    db.sessions.push(session);
  }
  return session;
}

function computeDashboard(db) {
  const resumes = db.resumes || [];
  const runs = db.runs || [];
  const sessions = db.sessions || [];

  const totalTurns = sessions.reduce((sum, s) => sum + (s.turns?.length || 0), 0);
  const retrievedScores = sessions.flatMap((s) => (s.turns || []).flatMap((t) => (t.retrieved || []).map((r) => Number(r.score || 0))));
  const avgRetrieval = retrievedScores.length ? retrievedScores.reduce((a, b) => a + b, 0) / retrievedScores.length : 0;
  const sessionDepthAvg = sessions.length ? totalTurns / sessions.length : 0;
  const runsWithSkill = runs.filter((r) => r.skill?.name || r.skillId).length;

  return {
    overview: {
      resumes: resumes.length,
      runs: runs.length,
      sessions: sessions.length,
      totalTurns,
      vectorProvider
    },
    quality: {
      avgRetrievalScore: Number(avgRetrieval.toFixed(3)),
      avgSessionDepth: Number(sessionDepthAvg.toFixed(2)),
      skillRoutedRuns: runsWithSkill,
      riskCoverage: resumes.length ? Number((resumes.filter((r) => (r.risks || []).length > 0).length / resumes.length).toFixed(2)) : 0
    },
    trend: sessions.map((s) => ({ title: s.title, turns: s.turns?.length || 0, createdAt: s.createdAt })),
    retrievalSamples: sessions.flatMap((s) => (s.turns || []).slice(-2).map((t) => ({ session: s.title, question: t.question, retrieved: t.retrieved || [] }))).slice(-6)
  };
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', async (_, res) => res.json({ ok: true, multiAgent: true, vectorProvider, db: await getDatabaseOverview() }));
app.get('/api/mcp/tools', (_, res) => res.json({ tools: listTools() }));
app.post('/api/mcp', async (req, res) => res.json(await handleMcpRequest(req.body)));
app.get('/api/app-roadmap', (_, res) => res.json(getAppRoadmap()));
app.get('/api/runs', async (_, res) => res.json({ runs: await listRecentRuns() }));
app.get('/api/dashboard', async (_, res) => { const db = await readLocalDb(); res.json(computeDashboard(db)); });
app.get('/api/runs/:id', async (req, res) => { const db = await readLocalDb(); const run = (db.runs || []).find((item) => item.id === req.params.id); if (!run) return res.status(404).json({ error: 'Run not found' }); res.json({ run }); });
app.get('/api/resumes', async (_, res) => { const db = await readLocalDb(); res.json({ resumes: (db.resumes || []).slice().reverse() }); });
app.get('/api/resumes/:id', async (req, res) => { const db = await readLocalDb(); const resume = (db.resumes || []).find((item) => item.id === req.params.id); if (!resume) return res.status(404).json({ error: 'Resume not found' }); res.json({ resume }); });
app.get('/api/sessions', async (_, res) => { const db = await readLocalDb(); res.json({ sessions: (db.sessions || []).slice().reverse() }); });
app.get('/api/sessions/:id', async (req, res) => { const db = await readLocalDb(); const session = (db.sessions || []).find((item) => item.id === req.params.id); if (!session) return res.status(404).json({ error: 'Session not found' }); res.json({ session }); });
app.post('/api/sessions', async (req, res) => { const db = await readLocalDb(); const title = req.body?.title || 'New Session'; const goal = req.body?.goal || title; const session = { id: `session_${Date.now()}`, title, goal, createdAt: new Date().toISOString(), turns: [], runs: [] }; db.sessions.push(session); await writeLocalDb(db); res.json({ session }); });

app.post('/api/sessions/:id/continue', async (req, res) => {
  const db = await readLocalDb();
  const session = (db.sessions || []).find((item) => item.id === req.params.id);
  if (!session) return res.status(404).json({ error: 'Session not found' });

  const { text = '', answer = '' } = req.body || {};
  const lastTurn = session.turns?.[session.turns.length - 1] || null;
  const retrieval = await retrieveContext({ text, query: session.goal || session.title || '', topK: 3, sessionTurns: session.turns || [] });
  const retrieved = retrieval.retrieved;
  const { questions } = await generateInterviewQuestions({ goal: session.goal || session.title || '', retrieved, previousAnswer: answer, previousQuestion: lastTurn?.question || '' });
  const question = questions?.detail?.[0] || questions?.basic?.[0] || '请继续介绍你的经历。';
  const critique = await critiqueAnswer({ answer, retrieved, question });
  const rewrite = await rewriteArtifacts({ text, answer, feedback: critique?.feedback || [] });

  const turn = { id: `turn_${Date.now()}`, createdAt: new Date().toISOString(), question, answer, critique: critique?.feedback || [], improvedAnswer: rewrite?.improvedAnswer || '', retrieved };
  session.turns.push(turn);
  await writeLocalDb(db);

  res.json({ session, turn, critique, rewrite, questions, retrieved, retrievalMeta: { resumeResults: retrieval.resumeResults, historyResults: retrieval.historyResults } });
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
    const kb = await buildKnowledgeBase(text);
    const outDir = path.resolve(__dirname, '../data');
    await fs.mkdir(outDir, { recursive: true });
    const kbForDisk = kb.map(({ id, content }) => ({ id, content }));
    await fs.writeFile(path.join(outDir, 'latest.json'), JSON.stringify({ text, sections, risks, kb: kbForDisk }, null, 2));
    await saveResumeRecord({ text, sections, risks, kbSize: kb.length });
    res.json({ text, sections, risks, kbSize: kb.length, vectorProvider });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post('/api/agent-run', async (req, res) => {
  try {
    const { text, goal, answer = '', history = [], sessionId = null } = req.body;
    const sections = splitSections(text || '');
    const skill = await routeSkill({ goal: goal || '' });
    const executionPlan = resolveExecutionPlan({ content: skill.rawContent || '' });
    const agentOutputs = [];
    let parseOutput = null;
    let plan = null;
    let retrieved = [];
    let questions = null;
    let critique = null;
    let rewrite = null;
    let retrievalMeta = null;
    let sessionTurns = [];

    if (sessionId) {
      const db = await readLocalDb();
      const session = (db.sessions || []).find((s) => s.id === sessionId);
      sessionTurns = session?.turns || [];
    }

    for (const step of executionPlan) {
      if (step.agent === 'parser') {
        parseOutput = { sections, risks: detectRisks(text || '') };
        agentOutputs.push({ step, output: parseOutput });
      } else if (step.agent === 'planner') {
        plan = await planNextStep({ goal, history, sections });
        agentOutputs.push({ step, output: plan });
      } else if (step.agent === 'retriever') {
        const result = await retrieveContext({ text, query: goal, topK: 3, sessionTurns });
        retrieved = result.retrieved;
        retrievalMeta = { resumeResults: result.resumeResults, historyResults: result.historyResults };
        agentOutputs.push({ step, output: { retrieved, retrievalMeta } });
      } else if (step.agent === 'interviewer') {
        const result = await generateInterviewQuestions({ goal, retrieved, previousAnswer: answer });
        questions = result.questions;
        agentOutputs.push({ step, output: result });
      } else if (step.agent === 'critic' && answer) {
        critique = await critiqueAnswer({ answer, retrieved, question: questions?.detail?.[0] || questions?.basic?.[0] || '' });
        agentOutputs.push({ step, output: critique });
      } else if (step.agent === 'writer' && answer) {
        rewrite = await rewriteArtifacts({ text, answer, feedback: critique?.feedback || [] });
        agentOutputs.push({ step, output: rewrite });
      }
    }

    const record = await saveRunRecord({ goal, hasAnswer: Boolean(answer), skill: skill.selectedSkill, executionPlan, vectorProvider, agentOutputs });
    let session = null;
    if (sessionId || goal) {
      const db = await readLocalDb();
      session = sessionId ? (db.sessions || []).find((s) => s.id === sessionId) : ensureSession(db, goal);
      if (session) {
        const turn = { id: `turn_${Date.now()}`, createdAt: new Date().toISOString(), question: questions?.detail?.[0] || questions?.basic?.[0] || goal, answer, critique: critique?.feedback || [], improvedAnswer: rewrite?.improvedAnswer || '', retrieved, runId: record.id };
        session.turns.push(turn);
        session.runs.push(record.id);
        await writeLocalDb(db);
      }
    }

    res.json({ runId: record.id, sessionId: session?.id || null, skill, executionPlan, agentOutputs, plan, parseOutput, retrieved, questions, critique, rewrite, retrievalMeta, vectorProvider });
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

app.listen(PORT, () => {
  console.log(`ResumePilot Web App server running at http://localhost:${PORT}`);
});
