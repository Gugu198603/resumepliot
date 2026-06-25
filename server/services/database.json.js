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
    runs: Array.isArray(db.runs) ? db.runs : []
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

export async function saveRunRecord(record) {
  const db = await readDb();
  db.runs.push({ id: record.id || nowId('run'), createdAt: new Date().toISOString(), ...record });
  await writeDb(db);
  return db.runs[db.runs.length - 1];
}

export async function listRecentRuns(limit = 10) {
  const db = await readDb();
  return db.runs.slice(-limit).reverse();
}

export async function getRun(id) {
  const db = await readDb();
  return db.runs.find((item) => item.id === id) || null;
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

export async function getDashboardSnapshot() {
  return await readDb();
}

export async function getDatabaseOverview() {
  const db = await readDb();
  return {
    provider: 'json-fallback',
    resumes: db.resumes.length,
    runs: db.runs.length,
    sessions: db.sessions.length
  };
}
