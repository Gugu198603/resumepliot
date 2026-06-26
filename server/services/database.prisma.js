let prisma = null;
let providerAvailable = false;

async function getPrisma() {
  if (prisma) return prisma;
  const mod = await import('@prisma/client');
  prisma = new mod.PrismaClient();
  providerAvailable = true;
  return prisma;
}

function toJsonString(value) {
  if (value === undefined || value === null) return null;
  return JSON.stringify(value);
}

function fromJsonString(value, fallback = null) {
  if (typeof value !== 'string') return value ?? fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export async function saveResumeRecord(record) {
  const client = await getPrisma();
  return await client.resume.create({
    data: {
      title: record.title || 'Imported Resume',
      originalText: record.text || '',
      parsedJson: toJsonString({
        sections: record.sections || [],
        risks: record.risks || [],
        kbSize: record.kbSize || 0,
        chunks: record.chunks || [],
        vectorProvider: record.vectorProvider || null
      })
    }
  });
}

function mapResume(record) {
  if (!record) return null;
  const parsed = fromJsonString(record.parsedJson, {}) || {};
  return {
    id: record.id,
    title: record.title,
    text: record.originalText,
    sections: parsed.sections || [],
    risks: parsed.risks || [],
    kbSize: parsed.kbSize || 0,
    chunks: parsed.chunks || [],
    vectorProvider: parsed.vectorProvider || null,
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export async function listResumes() {
  const client = await getPrisma();
  const rows = await client.resume.findMany({ orderBy: { createdAt: 'desc' } });
  return rows.map(mapResume);
}

export async function getResume(id) {
  const client = await getPrisma();
  return mapResume(await client.resume.findUnique({ where: { id } }));
}

export async function saveRunRecord(record) {
  const client = await getPrisma();
  return await client.run.create({
    data: {
      goal: record.goal || '',
      skillId: record.skill?.id || record.skillId || null,
      vectorProvider: record.vectorProvider || null,
      executionPlan: toJsonString(record.executionPlan || []),
      resultJson: toJsonString(record)
    }
  });
}

function mapRun(record) {
  if (!record) return null;
  return {
    id: record.id,
    goal: record.goal,
    skillId: record.skillId,
    vectorProvider: record.vectorProvider,
    executionPlan: fromJsonString(record.executionPlan, []) || [],
    ...(fromJsonString(record.resultJson, {}) || {}),
    createdAt: record.createdAt
  };
}

export async function listRecentRuns(limit = 10) {
  const client = await getPrisma();
  const rows = await client.run.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit
  });
  return rows.map(mapRun);
}

export async function getRun(id) {
  const client = await getPrisma();
  return mapRun(await client.run.findUnique({ where: { id } }));
}

export async function createSession({ title = 'New Session', goal = title, resumeId = null } = {}) {
  const client = await getPrisma();
  const session = await client.session.create({ data: { title, goal } });
  return { ...session, resumeId, turns: [], runs: [] };
}

export async function findOrCreateSessionByGoal(goal, attrs = {}) {
  const client = await getPrisma();
  const title = goal || 'Default Session';
  let session = await client.session.findFirst({ where: { OR: [{ title }, { goal: title }] } });
  if (!session) session = await client.session.create({ data: { title, goal: title } });
  return { ...session, resumeId: attrs.resumeId || null, turns: [], runs: [] };
}

export async function listSessions() {
  const client = await getPrisma();
  const rows = await client.session.findMany({ include: { messages: true, runs: true }, orderBy: { createdAt: 'desc' } });
  return rows.map(mapSession);
}

export async function getSession(id) {
  const client = await getPrisma();
  return mapSession(await client.session.findUnique({ where: { id }, include: { messages: true, runs: true } }));
}

function mapSession(record) {
  if (!record) return null;
  const turns = (record.messages || []).map((message) => {
    try {
      return JSON.parse(message.content);
    } catch {
      return { id: message.id, role: message.role, answer: message.content, createdAt: message.createdAt };
    }
  });
  return { ...record, turns, runs: (record.runs || []).map((run) => run.id) };
}

export async function appendSessionTurn(sessionId, turn, runId = null) {
  const client = await getPrisma();
  await client.message.create({ data: { sessionId, role: 'turn', content: JSON.stringify(turn) } });
  return await getSession(sessionId);
}

export async function getDashboardSnapshot() {
  const [resumes, runs, sessions] = await Promise.all([listResumes(), listRecentRuns(100), listSessions()]);
  return { resumes, runs, sessions };
}

export async function getDatabaseOverview() {
  const client = await getPrisma();
  const [resumes, runs, sessions] = await Promise.all([
    client.resume.count(),
    client.run.count(),
    client.session.count()
  ]);
  return { provider: 'prisma', resumes, runs, sessions };
}

export function isPrismaAvailable() {
  return providerAvailable;
}
