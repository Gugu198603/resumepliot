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

export async function saveRunRecord(record) {
  const provider = await getProvider();
  return await provider.saveRunRecord(record);
}

export async function listRecentRuns(limit = 10) {
  const provider = await getProvider();
  return await provider.listRecentRuns(limit);
}

export async function getDatabaseOverview() {
  const provider = await getProvider();
  return await provider.getDatabaseOverview();
}
