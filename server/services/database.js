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

export async function saveResumeCorrectionEvent(input) {
  const provider = await getProvider();
  return await provider.saveResumeCorrectionEvent(input);
}

export async function listResumeCorrectionEvents(limit = 500) {
  const provider = await getProvider();
  return await provider.listResumeCorrectionEvents(limit);
}

export async function deleteResume(id) {
  const provider = await getProvider();
  return await provider.deleteResume(id);
}

export async function createKnowledgeBaseVersion(record) {
  return await (await getProvider()).createKnowledgeBaseVersion(record);
}

export async function activateKnowledgeBaseVersion(id) {
  return await (await getProvider()).activateKnowledgeBaseVersion(id);
}

export async function listKnowledgeBaseVersions(filters) {
  return await (await getProvider()).listKnowledgeBaseVersions(filters);
}

export async function updateKnowledgeBaseVersion(id, patch) {
  return await (await getProvider()).updateKnowledgeBaseVersion(id, patch);
}

export async function saveRunRecord(record) {
  const provider = await getProvider();
  return await provider.saveRunRecord(record);
}

export async function createRunRecord(record) {
  const provider = await getProvider();
  return await provider.createRunRecord(record);
}

export async function appendRunEvent(runId, event) {
  const provider = await getProvider();
  return await provider.appendRunEvent(runId, event);
}

export async function finalizeRunRecord(runId, record) {
  const provider = await getProvider();
  return await provider.finalizeRunRecord(runId, record);
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

export async function updateSessionTurns(sessionId, turns, runId) {
  const provider = await getProvider();
  return await provider.updateSessionTurns(sessionId, turns, runId);
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

export async function saveResumeVersion(record) {
  const provider = await getProvider();
  return await provider.saveResumeVersion(record);
}

export async function listResumeVersions(resumeId) {
  const provider = await getProvider();
  return await provider.listResumeVersions(resumeId);
}

export async function getResumeVersion(id) {
  const provider = await getProvider();
  return await provider.getResumeVersion(id);
}

export async function createApplication(record) {
  return await (await getProvider()).createApplication(record);
}

export async function listApplications() {
  return await (await getProvider()).listApplications();
}

export async function getApplication(id) {
  return await (await getProvider()).getApplication(id);
}

export async function updateApplication(id, patch) {
  return await (await getProvider()).updateApplication(id, patch);
}

export async function deleteApplication(id) {
  return await (await getProvider()).deleteApplication(id);
}

export async function findMemoryRecord(filters) {
  return await (await getProvider()).findMemoryRecord(filters);
}

export async function createMemoryRecord(data) {
  return await (await getProvider()).createMemoryRecord(data);
}

export async function updateMemoryRecord(id, patch) {
  return await (await getProvider()).updateMemoryRecord(id, patch);
}

export async function deleteMemoryRecord(id) {
  return await (await getProvider()).deleteMemoryRecord(id);
}

export async function listMemoryRecords(filters, limit) {
  return await (await getProvider()).listMemoryRecords(filters, limit);
}

export async function touchMemoryRecords(ids) {
  return await (await getProvider()).touchMemoryRecords(ids);
}
