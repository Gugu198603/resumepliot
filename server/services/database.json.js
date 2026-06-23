import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbFile = path.resolve(__dirname, '../../data/app-db.json');

async function readDb() {
  try {
    const raw = await fs.readFile(dbFile, 'utf8');
    return JSON.parse(raw);
  } catch {
    return { sessions: [], resumes: [], runs: [] };
  }
}

async function writeDb(data) {
  await fs.mkdir(path.dirname(dbFile), { recursive: true });
  await fs.writeFile(dbFile, JSON.stringify(data, null, 2));
}

export async function saveResumeRecord(record) {
  const db = await readDb();
  db.resumes.push({ id: `resume_${Date.now()}`, createdAt: new Date().toISOString(), ...record });
  await writeDb(db);
  return db.resumes[db.resumes.length - 1];
}

export async function saveRunRecord(record) {
  const db = await readDb();
  db.runs.push({ id: `run_${Date.now()}`, createdAt: new Date().toISOString(), ...record });
  await writeDb(db);
  return db.runs[db.runs.length - 1];
}

export async function listRecentRuns(limit = 10) {
  const db = await readDb();
  return db.runs.slice(-limit).reverse();
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
