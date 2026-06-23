let prisma = null;
let providerAvailable = false;

async function getPrisma() {
  if (prisma) return prisma;
  const mod = await import('@prisma/client');
  prisma = new mod.PrismaClient();
  providerAvailable = true;
  return prisma;
}

export async function saveResumeRecord(record) {
  const client = await getPrisma();
  return await client.resume.create({
    data: {
      title: record.title || 'Imported Resume',
      originalText: record.text || '',
      parsedJson: {
        sections: record.sections || [],
        risks: record.risks || [],
        kbSize: record.kbSize || 0
      }
    }
  });
}

export async function saveRunRecord(record) {
  const client = await getPrisma();
  return await client.run.create({
    data: {
      goal: record.goal || '',
      skillId: record.skill?.id || record.skillId || null,
      vectorProvider: record.vectorProvider || null,
      executionPlan: record.executionPlan || [],
      resultJson: record
    }
  });
}

export async function listRecentRuns(limit = 10) {
  const client = await getPrisma();
  return await client.run.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit
  });
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
