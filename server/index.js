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

async function readLocalDb() {
  try {
    return JSON.parse(await fs.readFile(dataFile, 'utf8'));
  } catch {
    return { sessions: [], resumes: [], runs: [] };
  }
}

app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.get('/api/health', async (_, res) => {
  res.json({ ok: true, multiAgent: true, vectorProvider, db: await getDatabaseOverview() });
});

app.get('/api/mcp/tools', (_, res) => {
  res.json({ tools: listTools() });
});

app.post('/api/mcp', async (req, res) => {
  res.json(await handleMcpRequest(req.body));
});

app.get('/api/app-roadmap', (_, res) => {
  res.json(getAppRoadmap());
});

app.get('/api/runs', async (_, res) => {
  res.json({ runs: await listRecentRuns() });
});

app.get('/api/runs/:id', async (req, res) => {
  const db = await readLocalDb();
  const run = (db.runs || []).find((item) => item.id === req.params.id);
  if (!run) return res.status(404).json({ error: 'Run not found' });
  res.json({ run });
});

app.get('/api/resumes', async (_, res) => {
  const db = await readLocalDb();
  res.json({ resumes: (db.resumes || []).slice().reverse() });
});

app.get('/api/resumes/:id', async (req, res) => {
  const db = await readLocalDb();
  const resume = (db.resumes || []).find((item) => item.id === req.params.id);
  if (!resume) return res.status(404).json({ error: 'Resume not found' });
  res.json({ resume });
});

app.get('/api/sessions', async (_, res) => {
  const db = await readLocalDb();
  const sessions = (db.runs || []).reduce((acc, run) => {
    const key = run.goal || 'Default Session';
    if (!acc[key]) {
      acc[key] = {
        id: `session_${Object.keys(acc).length + 1}`,
        title: key,
        createdAt: run.createdAt,
        runs: 0,
        lastVectorProvider: run.vectorProvider || 'unknown'
      };
    }
    acc[key].runs += 1;
    return acc;
  }, {});
  res.json({ sessions: Object.values(sessions) });
});

app.get('/api/sessions/:id', async (req, res) => {
  const db = await readLocalDb();
  const sessions = (db.runs || []).reduce((acc, run) => {
    const key = run.goal || 'Default Session';
    if (!acc[key]) acc[key] = [];
    acc[key].push(run);
    return acc;
  }, {});
  const keys = Object.keys(sessions);
  const idx = keys.findIndex((_, i) => `session_${i + 1}` === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Session not found' });
  const title = keys[idx];
  res.json({ session: { id: req.params.id, title, runs: sessions[title] } });
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
    const { text, goal, answer = '', history = [] } = req.body;
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

    for (const step of executionPlan) {
      if (step.agent === 'parser') {
        parseOutput = { sections, risks: detectRisks(text || '') };
        agentOutputs.push({ step, output: parseOutput });
      } else if (step.agent === 'planner') {
        plan = await planNextStep({ goal, history, sections });
        agentOutputs.push({ step, output: plan });
      } else if (step.agent === 'retriever') {
        const result = await retrieveContext({ text, query: goal, topK: 3 });
        retrieved = result.retrieved;
        agentOutputs.push({ step, output: { retrieved } });
      } else if (step.agent === 'interviewer') {
        const result = await generateInterviewQuestions({ goal, retrieved });
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

    res.json({
      runId: record.id,
      skill,
      executionPlan,
      agentOutputs,
      plan,
      parseOutput,
      retrieved,
      questions,
      critique,
      rewrite,
      vectorProvider
    });
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
