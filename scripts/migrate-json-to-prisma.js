import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { PrismaClient } from '@prisma/client';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dbFile = process.env.APP_DB_FILE || path.resolve(__dirname, '../data/app-db.json');

const prisma = new PrismaClient();

function toJsonString(value) {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

async function readJsonDb() {
  try {
    const raw = await fs.readFile(dbFile, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      sessions: Array.isArray(parsed.sessions) ? parsed.sessions : [],
      resumes: Array.isArray(parsed.resumes) ? parsed.resumes : [],
      runs: Array.isArray(parsed.runs) ? parsed.runs : []
    };
  } catch {
    return { sessions: [], resumes: [], runs: [] };
  }
}

async function main() {
  const db = await readJsonDb();
  const counts = { resumes: 0, sessions: 0, messages: 0, runs: 0, skipped: 0 };

  // 1) Resumes
  for (const r of db.resumes) {
    if (!r.id) continue;
    const exists = await prisma.resume.findUnique({ where: { id: r.id } });
    if (exists) { counts.skipped++; continue; }
    await prisma.resume.create({
      data: {
        id: r.id,
        title: r.title || 'Imported Resume',
        originalText: r.text || '',
        parsedJson: toJsonString({
          sections: r.sections || [],
          risks: r.risks || [],
          kbSize: r.kbSize || 0,
          chunks: r.chunks || [],
          vectorProvider: r.vectorProvider || null
        }),
        createdAt: r.createdAt ? new Date(r.createdAt) : undefined
      }
    });
    counts.resumes++;
  }

  // 2) Sessions (+ build run -> session map)
  const runToSession = new Map();
  for (const s of db.sessions) {
    if (!s.id) continue;
    for (const runId of (Array.isArray(s.runs) ? s.runs : [])) runToSession.set(runId, s.id);
    for (const turn of (Array.isArray(s.turns) ? s.turns : [])) {
      if (turn?.runId) runToSession.set(turn.runId, s.id);
    }
    const exists = await prisma.session.findUnique({ where: { id: s.id } });
    if (exists) { counts.skipped++; continue; }
    await prisma.session.create({
      data: {
        id: s.id,
        title: s.title || 'Imported Session',
        goal: s.goal || s.title || null,
        createdAt: s.createdAt ? new Date(s.createdAt) : undefined
      }
    });
    counts.sessions++;
    // Messages (turns serialized like the prisma provider expects)
    for (const turn of (Array.isArray(s.turns) ? s.turns : [])) {
      await prisma.message.create({
        data: {
          sessionId: s.id,
          role: 'turn',
          content: JSON.stringify(turn),
          createdAt: turn.createdAt ? new Date(turn.createdAt) : undefined
        }
      });
      counts.messages++;
    }
  }

  // 3) Runs (after resumes + sessions so FKs resolve)
  const resumeIds = new Set(db.resumes.map((r) => r.id));
  for (const run of db.runs) {
    if (!run.id) continue;
    const exists = await prisma.run.findUnique({ where: { id: run.id } });
    if (exists) { counts.skipped++; continue; }
    const sessionId = runToSession.get(run.id) || null;
    const resumeId = run.resumeId && resumeIds.has(run.resumeId) ? run.resumeId : null;
    await prisma.run.create({
      data: {
        id: run.id,
        sessionId,
        resumeId,
        goal: run.goal || '',
        skillId: run.skill?.id || run.skillId || null,
        vectorProvider: run.vectorProvider || null,
        executionPlan: toJsonString(run.executionPlan || []),
        resultJson: toJsonString(run),
        createdAt: run.createdAt ? new Date(run.createdAt) : undefined
      }
    });
    counts.runs++;
  }

  console.log('[migrate] done:', JSON.stringify(counts));
  const [resumes, sessions, runs, messages] = await Promise.all([
    prisma.resume.count(),
    prisma.session.count(),
    prisma.run.count(),
    prisma.message.count()
  ]);
  console.log('[migrate] prisma totals:', JSON.stringify({ resumes, sessions, runs, messages }));
}

main()
  .catch((err) => { console.error('[migrate] failed:', err); process.exitCode = 1; })
  .finally(async () => { await prisma.$disconnect(); });
