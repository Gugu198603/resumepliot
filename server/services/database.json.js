import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbFile = process.env.APP_DB_FILE || path.resolve(__dirname, '../../data/app-db.json');

async function readDb() {
  try {
    const raw = await fs.readFile(dbFile, 'utf8');
    return normalizeDb(JSON.parse(raw));
  } catch {
    return normalizeDb({});
  }
}

function normalizeDb(db = {}) {
  return {
    sessions: Array.isArray(db.sessions) ? db.sessions : [],
    resumes: Array.isArray(db.resumes) ? db.resumes : [],
    corrections: Array.isArray(db.corrections) ? db.corrections : [],
    runs: Array.isArray(db.runs) ? db.runs : [],
    runEvents: Array.isArray(db.runEvents) ? db.runEvents : [],
    jobs: Array.isArray(db.jobs) ? db.jobs : [],
    jobMatches: Array.isArray(db.jobMatches) ? db.jobMatches : [],
    resumeVersions: Array.isArray(db.resumeVersions) ? db.resumeVersions : []
  };
}

function normalizeSections(sections = []) {
  return Array.isArray(sections)
    ? sections.map((section) => ({
        title: String(section?.title || '未命名模块').trim() || '未命名模块',
        content: Array.isArray(section?.content)
          ? section.content.map((line) => String(line || '').trim()).filter(Boolean)
          : []
      })).filter((section) => section.content.length)
    : [];
}

function summarizeCorrection(beforeSections = [], afterSections = [], errorTypes = []) {
  const beforeTitles = beforeSections.map((section) => section.title);
  const afterTitles = afterSections.map((section) => section.title);
  const beforeLines = beforeSections.reduce((sum, section) => sum + (section.content?.length || 0), 0);
  const afterLines = afterSections.reduce((sum, section) => sum + (section.content?.length || 0), 0);
  const titleChanges = Math.max(beforeTitles.length, afterTitles.length) - beforeTitles.filter((title, idx) => title === afterTitles[idx]).length;
  return {
    errorTypes,
    beforeSectionCount: beforeSections.length,
    afterSectionCount: afterSections.length,
    changedSectionTitles: Math.max(0, titleChanges),
    addedSections: Math.max(0, afterSections.length - beforeSections.length),
    removedSections: Math.max(0, beforeSections.length - afterSections.length),
    beforeLineCount: beforeLines,
    afterLineCount: afterLines,
    lineDelta: afterLines - beforeLines,
    contentChanged: JSON.stringify(beforeSections) !== JSON.stringify(afterSections)
  };
}

function nowId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

async function writeDb(data) {
  await fs.mkdir(path.dirname(dbFile), { recursive: true });
  await fs.writeFile(dbFile, JSON.stringify(data, null, 2));
}

export async function saveResumeRecord(record) {
  const db = await readDb();
  db.resumes.push({ id: record.id || nowId('resume'), createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), ...record });
  await writeDb(db);
  return db.resumes[db.resumes.length - 1];
}

export async function listResumes() {
  const db = await readDb();
  return db.resumes.slice().reverse();
}

export async function getResume(id) {
  const db = await readDb();
  return db.resumes.find((item) => item.id === id) || null;
}

export async function updateResume(id, patch = {}) {
  const db = await readDb();
  const resume = db.resumes.find((item) => item.id === id);
  if (!resume) return null;
  if (typeof patch.title === 'string') resume.title = patch.title;
  if (typeof patch.text === 'string') resume.text = patch.text;
  if (Array.isArray(patch.sections)) resume.sections = normalizeSections(patch.sections);
  if (Array.isArray(patch.risks)) resume.risks = patch.risks;
  if (Number.isFinite(patch.kbSize)) resume.kbSize = patch.kbSize;
  if (Array.isArray(patch.chunks)) resume.chunks = patch.chunks;
  if (patch.vectorProvider !== undefined) resume.vectorProvider = patch.vectorProvider || null;
  resume.updatedAt = new Date().toISOString();
  await writeDb(db);
  return resume;
}

export async function saveResumeCorrectionEvent({ resumeId, beforeSections = [], afterSections = [], errorTypes = [] } = {}) {
  const db = await readDb();
  const normalizedBefore = normalizeSections(beforeSections);
  const normalizedAfter = normalizeSections(afterSections);
  const normalizedErrorTypes = Array.isArray(errorTypes) ? errorTypes.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const event = {
    id: nowId('correction'),
    resumeId,
    errorTypes: normalizedErrorTypes,
    beforeSections: normalizedBefore,
    afterSections: normalizedAfter,
    summary: summarizeCorrection(normalizedBefore, normalizedAfter, normalizedErrorTypes),
    createdAt: new Date().toISOString()
  };
  db.corrections.push(event);
  await writeDb(db);
  return event;
}

export async function listResumeCorrectionEvents(limit = 500) {
  const db = await readDb();
  return db.corrections.slice(-limit).reverse();
}

export async function deleteResume(id) {
  const db = await readDb();
  const before = db.resumes.length;
  db.resumes = db.resumes.filter((item) => item.id !== id);
  db.corrections = db.corrections.filter((item) => item.resumeId !== id);
  db.resumeVersions = db.resumeVersions.filter((item) => item.resumeId !== id);
  const removed = db.resumes.length < before;
  if (removed) await writeDb(db);
  return removed;
}

export async function saveResumeVersion(record = {}) {
  const db = await readDb();
  const versions = db.resumeVersions.filter((item) => item.resumeId === record.resumeId);
  const version = {
    id: nowId('resumeversion'),
    resumeId: record.resumeId,
    jobId: record.jobId || null,
    label: record.label || `版本 ${versions.length + 1}`,
    versionNumber: versions.length + 1,
    content: record.content || {},
    candidateProfile: record.candidateProfile || null,
    matchScore: Number.isFinite(record.matchScore) ? Math.round(record.matchScore) : null,
    createdAt: new Date().toISOString()
  };
  db.resumeVersions.push(version);
  await writeDb(db);
  return version;
}

export async function listResumeVersions(resumeId) {
  const db = await readDb();
  return db.resumeVersions.filter((item) => item.resumeId === resumeId).sort((a, b) => b.versionNumber - a.versionNumber);
}

export async function getResumeVersion(id) {
  const db = await readDb();
  return db.resumeVersions.find((item) => item.id === id) || null;
}

export async function saveRunRecord(record) {
  const db = await readDb();
  const run = { id: record.id || nowId('run'), createdAt: new Date().toISOString(), ...record };
  const events = Array.isArray(record.runEvents)
    ? record.runEvents.map((event, index) => ({
        id: event.id || nowId('runevent'),
        runId: run.id,
        runtimeRunId: event.runtimeRunId || record.runtimeRunId || null,
        sequence: Number.isFinite(event.sequence) ? event.sequence : index + 1,
        type: event.type || 'unknown',
        agent: event.agent || null,
        status: event.status || null,
        latencyMs: Number.isFinite(event.latencyMs) ? event.latencyMs : null,
        errorCode: event.errorCode || null,
        errorMessage: event.errorMessage || null,
        payload: event.payload || null,
        createdAt: new Date().toISOString()
      }))
    : [];
  run.runEvents = events;
  db.runs.push(run);
  db.runEvents.push(...events);
  await writeDb(db);
  return run;
}

export async function createRunRecord(record) {
  const db = await readDb();
  const now = new Date().toISOString();
  const run = {
    id: record.id || nowId('run'),
    createdAt: now,
    updatedAt: now,
    startedAt: now,
    status: record.status || 'running',
    runEvents: [],
    ...record
  };
  db.runs.push(run);
  await writeDb(db);
  return run;
}

export async function appendRunEvent(runId, event) {
  const db = await readDb();
  const run = db.runs.find((item) => item.id === runId);
  if (!run) return null;
  const row = {
    id: event.id || nowId('runevent'),
    runId,
    runtimeRunId: event.runtimeRunId || run.runtimeRunId || null,
    sequence: Number.isFinite(event.sequence) ? event.sequence : (db.runEvents.filter((item) => item.runId === runId).length + 1),
    type: event.type || 'unknown',
    agent: event.agent || null,
    status: event.status || null,
    latencyMs: Number.isFinite(event.latencyMs) ? event.latencyMs : null,
    errorCode: event.errorCode || null,
    errorMessage: event.errorMessage || null,
    payload: event.payload || null,
    createdAt: new Date().toISOString()
  };
  run.runEvents = Array.isArray(run.runEvents) ? run.runEvents : [];
  run.runEvents.push(row);
  run.updatedAt = new Date().toISOString();
  db.runEvents.push(row);
  await writeDb(db);
  return row;
}

export async function finalizeRunRecord(runId, record) {
  const db = await readDb();
  const run = db.runs.find((item) => item.id === runId);
  if (!run) return null;
  const finishedAt = new Date().toISOString();
  const startedAt = run.startedAt ? new Date(run.startedAt).getTime() : Date.now();
  Object.assign(run, {
    ...record,
    id: run.id,
    createdAt: run.createdAt,
    startedAt: run.startedAt,
    updatedAt: finishedAt,
    finishedAt,
    latencyMs: Number.isFinite(record.latencyMs) ? record.latencyMs : Math.max(0, Date.now() - startedAt),
    runEvents: db.runEvents.filter((event) => event.runId === runId).sort((a, b) => a.sequence - b.sequence)
  });
  await writeDb(db);
  return run;
}

export async function listRecentRuns(limit = 10) {
  const db = await readDb();
  return db.runs.slice(-limit).reverse();
}

export async function getRun(id) {
  const db = await readDb();
  const run = db.runs.find((item) => item.id === id) || null;
  if (!run) return null;
  const runEvents = db.runEvents.filter((event) => event.runId === id).sort((a, b) => a.sequence - b.sequence);
  return { ...run, runEvents: runEvents.length ? runEvents : (run.runEvents || []) };
}

export async function createSession({ title = 'New Session', goal = title, resumeId = null } = {}) {
  const db = await readDb();
  const session = { id: nowId('session'), title, goal, resumeId, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), turns: [], runs: [] };
  db.sessions.push(session);
  await writeDb(db);
  return session;
}

export async function findOrCreateSessionByGoal(goal, attrs = {}) {
  const db = await readDb();
  const title = goal || 'Default Session';
  let session = db.sessions.find((item) => item.title === title || item.goal === title);
  if (!session) {
    session = { id: nowId('session'), title, goal: title, resumeId: attrs.resumeId || null, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), turns: [], runs: [] };
    db.sessions.push(session);
  } else if (attrs.resumeId && !session.resumeId) {
    session.resumeId = attrs.resumeId;
    session.updatedAt = new Date().toISOString();
  }
  await writeDb(db);
  return session;
}

export async function listSessions() {
  const db = await readDb();
  return db.sessions.slice().reverse();
}

export async function getSession(id) {
  const db = await readDb();
  return db.sessions.find((item) => item.id === id) || null;
}

export async function appendSessionTurn(sessionId, turn, runId = null) {
  const db = await readDb();
  const session = db.sessions.find((item) => item.id === sessionId);
  if (!session) return null;
  session.turns = Array.isArray(session.turns) ? session.turns : [];
  session.runs = Array.isArray(session.runs) ? session.runs : [];
  session.turns.push({ id: turn.id || nowId('turn'), createdAt: new Date().toISOString(), ...turn });
  if (runId && !session.runs.includes(runId)) session.runs.push(runId);
  if (turn.resumeId && !session.resumeId) session.resumeId = turn.resumeId;
  session.updatedAt = new Date().toISOString();
  await writeDb(db);
  return session;
}

export async function updateSessionTurns(sessionId, turns = [], runId = null) {
  const db = await readDb();
  const session = db.sessions.find((item) => item.id === sessionId);
  if (!session) return null;
  session.turns = Array.isArray(turns) ? turns : [];
  session.runs = Array.isArray(session.runs) ? session.runs : [];
  if (runId && !session.runs.includes(runId)) session.runs.push(runId);
  const resumeId = session.turns.find((turn) => turn.resumeId)?.resumeId;
  if (resumeId && !session.resumeId) session.resumeId = resumeId;
  session.updatedAt = new Date().toISOString();
  await writeDb(db);
  return session;
}

export async function getDashboardSnapshot() {
  return await readDb();
}

export async function getDatabaseOverview() {
  const db = await readDb();
  return {
    provider: 'json-fallback',
    resumes: db.resumes.length,
    runs: db.runs.length,
    sessions: db.sessions.length,
    corrections: db.corrections.length
  };
}

export async function saveJobDescription(record) {
  const db = await readDb();
  const now = new Date().toISOString();
  if (record.dedupeKey) {
    const existing = db.jobs.find((j) => j.dedupeKey === record.dedupeKey);
    if (existing) {
      Object.assign(existing, {
        title: record.title ?? existing.title,
        company: record.company ?? existing.company,
        location: record.location ?? existing.location,
        sourceUrl: record.sourceUrl ?? existing.sourceUrl,
        text: record.text || record.originalText || existing.text,
        parsed: record.parsed ?? existing.parsed,
        updatedAt: now
      });
      await writeDb(db);
      return existing;
    }
  }
  const job = {
    id: nowId('job'),
    title: record.title || null,
    company: record.company || null,
    location: record.location || null,
    source: record.source || 'manual',
    sourceUrl: record.sourceUrl || null,
    dedupeKey: record.dedupeKey || null,
    text: record.text || record.originalText || '',
    parsed: record.parsed || null,
    createdAt: now,
    updatedAt: now
  };
  db.jobs.push(job);
  await writeDb(db);
  return job;
}

export async function listJobDescriptions(limit = 50) {
  const db = await readDb();
  return db.jobs.slice(-limit).reverse();
}

export async function getJobDescription(id) {
  const db = await readDb();
  return db.jobs.find((j) => j.id === id) || null;
}

export async function saveJobMatch(record) {
  const db = await readDb();
  const match = {
    id: nowId('jobmatch'),
    jobId: record.jobId,
    resumeId: record.resumeId || null,
    matchScore: Number.isFinite(record.matchScore) ? Math.round(record.matchScore) : 0,
    result: record.result || null,
    createdAt: new Date().toISOString()
  };
  db.jobMatches.push(match);
  await writeDb(db);
  return match;
}

export async function listJobMatches(limit = 50) {
  const db = await readDb();
  const jobsById = new Map(db.jobs.map((j) => [j.id, j]));
  return db.jobMatches.slice(-limit).reverse().map((m) => ({ ...m, job: jobsById.get(m.jobId) || null }));
}
