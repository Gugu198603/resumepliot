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

function normalizeSections(sections = []) {
  return Array.isArray(sections)
    ? sections.map((section) => ({
        title: String(section?.title || '未命名模块').trim() || '未命名模块',
        content: Array.isArray(section?.content)
          ? section.content.map((line) => String(line || '').trim()).filter(Boolean)
          : []
      })).filter((section) => section.content.length)
    : [];
}

function summarizeCorrection(beforeSections = [], afterSections = [], errorTypes = []) {
  const beforeTitles = beforeSections.map((section) => section.title);
  const afterTitles = afterSections.map((section) => section.title);
  const beforeLines = beforeSections.reduce((sum, section) => sum + (section.content?.length || 0), 0);
  const afterLines = afterSections.reduce((sum, section) => sum + (section.content?.length || 0), 0);
  const titleChanges = Math.max(beforeTitles.length, afterTitles.length) - beforeTitles.filter((title, idx) => title === afterTitles[idx]).length;
  return {
    errorTypes,
    beforeSectionCount: beforeSections.length,
    afterSectionCount: afterSections.length,
    changedSectionTitles: Math.max(0, titleChanges),
    addedSections: Math.max(0, afterSections.length - beforeSections.length),
    removedSections: Math.max(0, beforeSections.length - afterSections.length),
    beforeLineCount: beforeLines,
    afterLineCount: afterLines,
    lineDelta: afterLines - beforeLines,
    contentChanged: JSON.stringify(beforeSections) !== JSON.stringify(afterSections)
  };
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

export async function updateResume(id, patch = {}) {
  const client = await getPrisma();
  const current = await getResume(id);
  if (!current) return null;
  const data = {};
  if (typeof patch.title === 'string') data.title = patch.title;
  const parsedPatch = {};
  if (Array.isArray(patch.sections)) parsedPatch.sections = normalizeSections(patch.sections);
  if (Array.isArray(patch.risks)) parsedPatch.risks = patch.risks;
  if (Number.isFinite(patch.kbSize)) parsedPatch.kbSize = patch.kbSize;
  if (Array.isArray(patch.chunks)) parsedPatch.chunks = patch.chunks;
  if (patch.vectorProvider !== undefined) parsedPatch.vectorProvider = patch.vectorProvider || null;
  if (Object.keys(parsedPatch).length) {
    data.parsedJson = toJsonString({
      sections: current.sections || [],
      risks: current.risks || [],
      kbSize: current.kbSize || 0,
      chunks: current.chunks || [],
      vectorProvider: current.vectorProvider || null,
      ...parsedPatch
    });
  }
  if (typeof patch.text === 'string') data.originalText = patch.text;
  if (!Object.keys(data).length) return await getResume(id);
  return mapResume(await client.resume.update({ where: { id }, data }));
}

export async function saveResumeCorrectionEvent({ resumeId, beforeSections = [], afterSections = [], errorTypes = [] } = {}) {
  const client = await getPrisma();
  const normalizedBefore = normalizeSections(beforeSections);
  const normalizedAfter = normalizeSections(afterSections);
  const normalizedErrorTypes = Array.isArray(errorTypes) ? errorTypes.map((item) => String(item || '').trim()).filter(Boolean) : [];
  const summary = summarizeCorrection(normalizedBefore, normalizedAfter, normalizedErrorTypes);
  const row = await client.resumeCorrectionEvent.create({
    data: {
      resumeId,
      errorTypes: toJsonString(normalizedErrorTypes),
      beforeJson: toJsonString(normalizedBefore),
      afterJson: toJsonString(normalizedAfter),
      summaryJson: toJsonString(summary)
    }
  });
  return mapResumeCorrection(row);
}

function mapResumeCorrection(record) {
  if (!record) return null;
  return {
    id: record.id,
    resumeId: record.resumeId,
    errorTypes: fromJsonString(record.errorTypes, []) || [],
    beforeSections: fromJsonString(record.beforeJson, []) || [],
    afterSections: fromJsonString(record.afterJson, []) || [],
    summary: fromJsonString(record.summaryJson, {}) || {},
    createdAt: record.createdAt
  };
}

export async function listResumeCorrectionEvents(limit = 500) {
  const client = await getPrisma();
  const rows = await client.resumeCorrectionEvent.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  return rows.map(mapResumeCorrection);
}

export async function deleteResume(id) {
  const client = await getPrisma();
  try {
    await client.$transaction([
      client.run.updateMany({ where: { resumeId: id }, data: { resumeId: null } }),
      client.memoryItem.updateMany({ where: { resumeId: id }, data: { resumeId: null } }),
      client.resumeCorrectionEvent.deleteMany({ where: { resumeId: id } }),
      client.resume.delete({ where: { id } })
    ]);
    return true;
  } catch {
    return false;
  }
}

export async function saveRunRecord(record) {
  const client = await getPrisma();
  const terminalEvent = Array.isArray(record.runEvents)
    ? [...record.runEvents].reverse().find((event) => event.type === 'run_success' || event.type === 'run_failed')
    : null;
  const finishedAt = terminalEvent ? new Date() : null;
  const latencyMs = Number.isFinite(terminalEvent?.latencyMs) ? terminalEvent.latencyMs : null;
  const startedAt = finishedAt && latencyMs != null ? new Date(finishedAt.getTime() - latencyMs) : null;
  const run = await client.run.create({
    data: {
      sessionId: record.sessionId || null,
      resumeId: record.resumeId || null,
      runtimeRunId: record.runtimeRunId || null,
      status: record.status || 'pending',
      goal: record.goal || '',
      skillId: record.skill?.id || record.skillId || null,
      vectorProvider: record.vectorProvider || null,
      executionPlan: toJsonString(record.executionPlan || []),
      resultJson: toJsonString(record),
      errorCode: record.error?.code || null,
      errorMessage: record.error?.message || null,
      startedAt,
      finishedAt,
      latencyMs
    }
  });
  if (Array.isArray(record.runEvents) && record.runEvents.length) {
    await client.runEvent.createMany({
      data: record.runEvents.map((event, index) => ({
        runId: run.id,
        runtimeRunId: event.runtimeRunId || record.runtimeRunId || null,
        sequence: Number.isFinite(event.sequence) ? event.sequence : index + 1,
        type: event.type || 'unknown',
        agent: event.agent || null,
        status: event.status || null,
        latencyMs: Number.isFinite(event.latencyMs) ? event.latencyMs : null,
        errorCode: event.errorCode || null,
        errorMessage: event.errorMessage || null,
        payloadJson: toJsonString(event.payload || null)
      }))
    });
  }
  return mapRun({ ...run, events: record.runEvents || [] });
}

function mapRun(record) {
  if (!record) return null;
  const result = fromJsonString(record.resultJson, {}) || {};
  return {
    id: record.id,
    sessionId: record.sessionId,
    resumeId: record.resumeId,
    runtimeRunId: record.runtimeRunId || result.runtimeRunId || null,
    status: record.status || result.status || 'succeeded',
    goal: record.goal,
    skillId: record.skillId,
    vectorProvider: record.vectorProvider,
    executionPlan: fromJsonString(record.executionPlan, []) || [],
    errorCode: record.errorCode || result.error?.code || null,
    errorMessage: record.errorMessage || result.error?.message || null,
    startedAt: record.startedAt || null,
    finishedAt: record.finishedAt || null,
    latencyMs: record.latencyMs ?? null,
    ...result,
    runEvents: (record.events || result.runEvents || []).map(mapRunEvent),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

function mapRunEvent(record) {
  if (!record) return null;
  return {
    id: record.id,
    runId: record.runId,
    runtimeRunId: record.runtimeRunId,
    sequence: record.sequence,
    type: record.type,
    agent: record.agent,
    status: record.status,
    latencyMs: record.latencyMs,
    errorCode: record.errorCode,
    errorMessage: record.errorMessage,
    payload: record.payload !== undefined ? record.payload : fromJsonString(record.payloadJson, null),
    createdAt: record.createdAt
  };
}

export async function listRecentRuns(limit = 10) {
  const client = await getPrisma();
  const rows = await client.run.findMany({
    orderBy: { createdAt: 'desc' },
    take: limit,
    include: { events: { orderBy: { sequence: 'asc' } } }
  });
  return rows.map(mapRun);
}

export async function getRun(id) {
  const client = await getPrisma();
  return mapRun(await client.run.findUnique({ where: { id }, include: { events: { orderBy: { sequence: 'asc' } } } }));
}

export async function createSession({ title = 'New Session', goal = title, resumeId = null } = {}) {
  const client = await getPrisma();
  const session = await client.session.create({ data: { title, goal, resumeId } });
  return { ...session, turns: [], runs: [] };
}

export async function findOrCreateSessionByGoal(goal, attrs = {}) {
  const client = await getPrisma();
  const title = goal || 'Default Session';
  let session = await client.session.findFirst({ where: { OR: [{ title }, { goal: title }] } });
  if (!session) {
    session = await client.session.create({ data: { title, goal: title, resumeId: attrs.resumeId || null } });
  } else if (attrs.resumeId && !session.resumeId) {
    session = await client.session.update({ where: { id: session.id }, data: { resumeId: attrs.resumeId } });
  }
  return { ...session, turns: [], runs: [] };
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
  if (turn.resumeId) {
    const current = await client.session.findUnique({ where: { id: sessionId } });
    if (current && !current.resumeId) {
      await client.session.update({ where: { id: sessionId }, data: { resumeId: turn.resumeId } });
    }
  }
  return await getSession(sessionId);
}

export async function getDashboardSnapshot() {
  const [resumes, runs, sessions, corrections] = await Promise.all([listResumes(), listRecentRuns(100), listSessions(), listResumeCorrectionEvents(500)]);
  return { resumes, runs, sessions, corrections };
}

export async function getDatabaseOverview() {
  const client = await getPrisma();
  const [resumes, runs, sessions, corrections] = await Promise.all([
    client.resume.count(),
    client.run.count(),
    client.session.count(),
    client.resumeCorrectionEvent.count()
  ]);
  return { provider: 'prisma', resumes, runs, sessions, corrections };
}

function mapJob(record) {
  if (!record) return null;
  return {
    id: record.id,
    title: record.title,
    company: record.company,
    location: record.location,
    source: record.source,
    sourceUrl: record.sourceUrl,
    text: record.originalText,
    parsed: fromJsonString(record.parsedJson, null),
    createdAt: record.createdAt,
    updatedAt: record.updatedAt
  };
}

export async function saveJobDescription(record) {
  const client = await getPrisma();
  const data = {
    title: record.title || null,
    company: record.company || null,
    location: record.location || null,
    source: record.source || 'manual',
    sourceUrl: record.sourceUrl || null,
    dedupeKey: record.dedupeKey || null,
    originalText: record.text || record.originalText || '',
    parsedJson: toJsonString(record.parsed || null)
  };
  if (data.dedupeKey) {
    return mapJob(await client.jobDescription.upsert({
      where: { dedupeKey: data.dedupeKey },
      update: { title: data.title, company: data.company, location: data.location, sourceUrl: data.sourceUrl, originalText: data.originalText, parsedJson: data.parsedJson },
      create: data
    }));
  }
  return mapJob(await client.jobDescription.create({ data }));
}

export async function listJobDescriptions(limit = 50) {
  const client = await getPrisma();
  const rows = await client.jobDescription.findMany({ orderBy: { createdAt: 'desc' }, take: limit });
  return rows.map(mapJob);
}

export async function getJobDescription(id) {
  const client = await getPrisma();
  return mapJob(await client.jobDescription.findUnique({ where: { id } }));
}

export async function saveJobMatch(record) {
  const client = await getPrisma();
  const row = await client.jobMatch.create({
    data: {
      jobId: record.jobId,
      resumeId: record.resumeId || null,
      matchScore: Number.isFinite(record.matchScore) ? Math.round(record.matchScore) : 0,
      resultJson: toJsonString(record.result || null)
    }
  });
  return { id: row.id, jobId: row.jobId, resumeId: row.resumeId, matchScore: row.matchScore, result: record.result || null, createdAt: row.createdAt };
}

export async function listJobMatches(limit = 50) {
  const client = await getPrisma();
  const rows = await client.jobMatch.findMany({ orderBy: { createdAt: 'desc' }, take: limit, include: { job: true } });
  return rows.map((row) => ({
    id: row.id,
    jobId: row.jobId,
    resumeId: row.resumeId,
    matchScore: row.matchScore,
    result: fromJsonString(row.resultJson, null),
    job: mapJob(row.job),
    createdAt: row.createdAt
  }));
}

export function isPrismaAvailable() {
  return providerAvailable;
}
