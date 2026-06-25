import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dbFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'resumepilot-db-')), 'app-db.json');
process.env.APP_DB_FILE = dbFile;
const db = await import(`../server/services/database.json.js?db=${Date.now()}`);

test('json database stores resumes, runs, sessions, and turns through one service', async () => {
  const resume = await db.saveResumeRecord({ text: '项目经历\nRAG demo', sections: [], risks: [], kbSize: 1, chunks: [{ id: 1, content: 'RAG demo', embedding: [1, 0] }] });
  assert.ok(resume.id.startsWith('resume_'));
  assert.equal((await db.getResume(resume.id)).chunks.length, 1);

  const session = await db.findOrCreateSessionByGoal('面试训练', { resumeId: resume.id });
  const run = await db.saveRunRecord({ goal: '面试训练', resumeId: resume.id });
  const updated = await db.appendSessionTurn(session.id, { question: 'Q', answer: 'A', resumeId: resume.id }, run.id);

  assert.equal(updated.turns.length, 1);
  assert.equal(updated.runs[0], run.id);
  assert.equal((await db.getDashboardSnapshot()).sessions.length, 1);
});
