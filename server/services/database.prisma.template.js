// After installing Prisma, replace database.js imports with this Prisma-backed module.
// Install:
//   /Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/npm install prisma @prisma/client
// Generate client:
//   DATABASE_URL="file:./prisma/dev.db" /Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/prisma/build/index.js generate
// Push schema:
//   DATABASE_URL="file:./prisma/dev.db" /Users/bytedance/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node ./node_modules/prisma/build/index.js db push

import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

export async function saveResumeRecord(record) {
  return await prisma.resume.create({
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
  return await prisma.run.create({
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
  return await prisma.run.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit
  });
}

export async function getDatabaseOverview() {
  const [resumes, runs, sessions] = await Promise.all([
    prisma.resume.count(),
    prisma.run.count(),
    prisma.session.count()
  ]);
  return { resumes, runs, sessions };
}
