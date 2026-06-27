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

test('json session persists resumeId and backfills when missing', async () => {
  const created = await db.findOrCreateSessionByGoal('带简历目标', { resumeId: 'resume_abc' });
  assert.equal(created.resumeId, 'resume_abc');

  const reused = await db.findOrCreateSessionByGoal('带简历目标', { resumeId: 'resume_xyz' });
  assert.equal(reused.id, created.id);
  assert.equal(reused.resumeId, 'resume_abc', 'existing resumeId must not be overwritten');

  const noResume = await db.findOrCreateSessionByGoal('无简历目标', {});
  assert.equal(noResume.resumeId, null);
  const backfilled = await db.findOrCreateSessionByGoal('无简历目标', { resumeId: 'resume_late' });
  assert.equal(backfilled.id, noResume.id);
  assert.equal(backfilled.resumeId, 'resume_late', 'missing resumeId should be backfilled');
});

test('json resume update renames and delete removes the record', async () => {
  const resume = await db.saveResumeRecord({ text: '可删除简历', sections: [], risks: [], kbSize: 0 });
  const renamed = await db.updateResume(resume.id, { title: '新名字' });
  assert.equal(renamed.title, '新名字');
  assert.equal((await db.getResume(resume.id)).title, '新名字');

  const removed = await db.deleteResume(resume.id);
  assert.equal(removed, true);
  assert.equal(await db.getResume(resume.id), null);
  assert.equal(await db.deleteResume('does-not-exist'), false);
});

test('json job descriptions upsert by dedupeKey and store matches', async () => {
  const first = await db.saveJobDescription({ title: 'Backend', company: 'Acme', source: 'greenhouse', sourceUrl: 'https://x/1', text: 'Go + gRPC', dedupeKey: 'dk-1' });
  assert.ok(first.id.startsWith('job'));

  const dup = await db.saveJobDescription({ title: 'Backend (Updated)', company: 'Acme', source: 'greenhouse', sourceUrl: 'https://x/1', text: 'Go + gRPC + k8s', dedupeKey: 'dk-1' });
  assert.equal(dup.id, first.id, 'same dedupeKey must upsert the same row');
  assert.equal(dup.title, 'Backend (Updated)');

  const second = await db.saveJobDescription({ title: 'Frontend', company: 'Acme', source: 'lever', sourceUrl: 'https://x/2', text: 'React', dedupeKey: 'dk-2' });
  const list = await db.listJobDescriptions();
  assert.equal(list.length, 2, 'two unique dedupeKeys => two rows');

  const match = await db.saveJobMatch({ jobId: second.id, resumeId: 'resume_1', matchScore: 87.6, result: { overallScore: 88 } });
  assert.equal(match.matchScore, 88, 'matchScore is rounded');
  const matches = await db.listJobMatches();
  assert.equal(matches.length, 1);
  assert.equal(matches[0].job.id, second.id, 'match joins its job description');
});
