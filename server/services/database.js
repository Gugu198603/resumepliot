import * as jsonDb from './database.json.js';

let prismaDb = null;
let prismaLoadAttempted = false;

async function tryLoadPrisma() {
  if (prismaLoadAttempted) return prismaDb;
  prismaLoadAttempted = true;
  try {
    prismaDb = await import('./database.prisma.js');
    await prismaDb.getDatabaseOverview();
    return prismaDb;
  } catch {
    prismaDb = null;
    return null;
  }
}

async function getProvider() {
  const preferred = process.env.APP_DB_PROVIDER || 'auto';

  if (preferred === 'json') return jsonDb;
  if (preferred === 'prisma') {
    const prisma = await tryLoadPrisma();
    if (!prisma) throw new Error('Prisma provider requested but not available.');
    return prisma;
  }

  return (await tryLoadPrisma()) || jsonDb;
}

export async function saveResumeRecord(record) {
  const provider = await getProvider();
  return await provider.saveResumeRecord(record);
}

export async function listResumes() {
  const provider = await getProvider();
  return await provider.listResumes();
}

export async function getResume(id) {
  const provider = await getProvider();
  return await provider.getResume(id);
}

export async function updateResume(id, patch) {
  const provider = await getProvider();
  return await provider.updateResume(id, patch);
}

export async function deleteResume(id) {
  const provider = await getProvider();
  return await provider.deleteResume(id);
}

export async function saveRunRecord(record) {
  const provider = await getProvider();
  return await provider.saveRunRecord(record);
}

export async function listRecentRuns(limit = 10) {
  const provider = await getProvider();
  return await provider.listRecentRuns(limit);
}

export async function getRun(id) {
  const provider = await getProvider();
  return await provider.getRun(id);
}

export async function createSession(attrs) {
  const provider = await getProvider();
  return await provider.createSession(attrs);
}

export async function findOrCreateSessionByGoal(goal, attrs) {
  const provider = await getProvider();
  return await provider.findOrCreateSessionByGoal(goal, attrs);
}

export async function listSessions() {
  const provider = await getProvider();
  return await provider.listSessions();
}

export async function getSession(id) {
  const provider = await getProvider();
  return await provider.getSession(id);
}

export async function appendSessionTurn(sessionId, turn, runId) {
  const provider = await getProvider();
  return await provider.appendSessionTurn(sessionId, turn, runId);
}

export async function getDashboardSnapshot() {
  const provider = await getProvider();
  return await provider.getDashboardSnapshot();
}

export async function getDatabaseOverview() {
  const provider = await getProvider();
  return await provider.getDatabaseOverview();
}

export async function saveJobDescription(record) {
  const provider = await getProvider();
  return await provider.saveJobDescription(record);
}

export async function listJobDescriptions(limit = 50) {
  const provider = await getProvider();
  return await provider.listJobDescriptions(limit);
}

export async function getJobDescription(id) {
  const provider = await getProvider();
  return await provider.getJobDescription(id);
}

export async function saveJobMatch(record) {
  const provider = await getProvider();
  return await provider.saveJobMatch(record);
}

export async function listJobMatches(limit = 50) {
  const provider = await getProvider();
  return await provider.listJobMatches(limit);
}
