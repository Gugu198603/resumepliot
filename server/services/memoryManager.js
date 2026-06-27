import { createHash } from 'crypto';
import { PrismaClient } from '@prisma/client';
import { logger } from './logger.js';

const prisma = new PrismaClient();

export const MEMORY_SCOPES = new Set(['global', 'user', 'resume', 'session', 'job', 'run']);
export const MEMORY_TYPES = new Set([
  'fact',
  'preference',
  'summary',
  'critique',
  'gap',
  'requirement',
  'interaction',
  'retrieval_feedback',
  'tool_observation'
]);

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

function contentHash(content) {
  return createHash('sha256').update(String(content || '')).digest('hex');
}

function preview(value, limit = 120) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function asArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function validateMemoryInput(input) {
  if (!MEMORY_SCOPES.has(input.scope)) {
    logger.info('memory.write.validation_failed', {
      reason: 'invalid_scope',
      scope: input.scope,
      type: input.type,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId
    });
    throw new Error(`Invalid memory scope: ${input.scope}`);
  }
  if (!MEMORY_TYPES.has(input.type)) {
    logger.info('memory.write.validation_failed', {
      reason: 'invalid_type',
      scope: input.scope,
      type: input.type,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId
    });
    throw new Error(`Invalid memory type: ${input.type}`);
  }
  if (!String(input.content || '').trim()) {
    logger.info('memory.write.validation_failed', {
      reason: 'empty_content',
      scope: input.scope,
      type: input.type,
      sourceKind: input.sourceKind,
      sourceId: input.sourceId
    });
    throw new Error('Memory content is required.');
  }
}

function mapMemory(row) {
  if (!row) return null;
  return {
    ...row,
    metadata: fromJsonString(row.metadataJson, null)
  };
}

function buildWhere({
  query = '',
  scopes,
  types,
  userId,
  resumeId,
  sessionId,
  jobId,
  runId,
  sourceKind,
  sourceId,
  status = 'active',
  includeExpired = false
} = {}) {
  const where = {};
  const scopeList = asArray(scopes);
  const typeList = asArray(types);

  if (scopeList.length) where.scope = { in: scopeList };
  if (typeList.length) where.type = { in: typeList };
  if (userId) where.userId = userId;
  if (resumeId) where.resumeId = resumeId;
  if (sessionId) where.sessionId = sessionId;
  if (jobId) where.jobId = jobId;
  if (runId) where.runId = runId;
  if (sourceKind) where.sourceKind = sourceKind;
  if (sourceId) where.sourceId = sourceId;
  if (status) where.status = status;

  if (!includeExpired) {
    where.OR = [
      { expiresAt: null },
      { expiresAt: { gt: new Date() } }
    ];
  }

  const trimmedQuery = String(query || '').trim();
  if (trimmedQuery) {
    const textFilter = [
      { title: { contains: trimmedQuery } },
      { content: { contains: trimmedQuery } }
    ];
    where.AND = [
      ...(where.AND || []),
      { OR: textFilter }
    ];
  }

  return where;
}

export async function writeMemory(input = {}) {
  validateMemoryInput(input);

  const content = String(input.content).trim();
  const hash = input.contentHash || contentHash(content);
  const startedAt = Date.now();
  logger.info('memory.write.start', {
    scope: input.scope,
    type: input.type,
    userId: input.userId || null,
    resumeId: input.resumeId || null,
    sessionId: input.sessionId || null,
    jobId: input.jobId || null,
    runId: input.runId || null,
    sourceKind: input.sourceKind || null,
    sourceId: input.sourceId || null,
    title: input.title || null,
    contentLength: content.length,
    contentPreview: preview(content),
    contentHash: hash,
    importance: Number.isFinite(input.importance) ? input.importance : 0.5,
    confidence: Number.isFinite(input.confidence) ? input.confidence : 1.0,
    vectorProvider: input.vectorProvider || null,
    vectorNamespace: input.vectorNamespace || null,
    vectorPointId: input.vectorPointId || null,
    status: input.status || 'active',
    hasMetadata: input.metadata !== undefined && input.metadata !== null
  });

  try {
    const row = await prisma.memoryItem.create({
      data: {
        userId: input.userId || null,
        resumeId: input.resumeId || null,
        sessionId: input.sessionId || null,
        jobId: input.jobId || null,
        runId: input.runId || null,
        scope: input.scope,
        type: input.type,
        sourceKind: input.sourceKind || null,
        sourceId: input.sourceId || null,
        title: input.title || null,
        content,
        contentHash: hash,
        importance: Number.isFinite(input.importance) ? input.importance : 0.5,
        confidence: Number.isFinite(input.confidence) ? input.confidence : 1.0,
        embeddingProvider: input.embeddingProvider || null,
        vectorProvider: input.vectorProvider || null,
        vectorNamespace: input.vectorNamespace || null,
        vectorPointId: input.vectorPointId || null,
        vectorDim: Number.isFinite(input.vectorDim) ? input.vectorDim : null,
        status: input.status || 'active',
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        metadataJson: toJsonString(input.metadata)
      }
    });

    logger.info('memory.write.success', {
      id: row.id,
      scope: row.scope,
      type: row.type,
      sourceKind: row.sourceKind,
      sourceId: row.sourceId,
      contentHash: row.contentHash,
      latencyMs: Date.now() - startedAt
    });

    return mapMemory(row);
  } catch (error) {
    logger.info('memory.write.error', {
      scope: input.scope,
      type: input.type,
      sourceKind: input.sourceKind || null,
      sourceId: input.sourceId || null,
      contentHash: hash,
      latencyMs: Date.now() - startedAt,
      error: error.message
    });
    throw error;
  }
}

export async function retrieveMemory(options = {}) {
  const limit = Math.min(Number(options.limit) || 10, 50);
  const where = buildWhere(options);
  const startedAt = Date.now();

  logger.info('memory.retrieve.start', {
    query: preview(options.query, 160),
    queryLength: String(options.query || '').length,
    scopes: asArray(options.scopes),
    types: asArray(options.types),
    userId: options.userId || null,
    resumeId: options.resumeId || null,
    sessionId: options.sessionId || null,
    jobId: options.jobId || null,
    runId: options.runId || null,
    sourceKind: options.sourceKind || null,
    sourceId: options.sourceId || null,
    status: options.status || 'active',
    includeExpired: Boolean(options.includeExpired),
    touch: options.touch !== false,
    limit
  });

  try {
    const rows = await prisma.memoryItem.findMany({
      where,
      orderBy: [
        { importance: 'desc' },
        { confidence: 'desc' },
        { updatedAt: 'desc' }
      ],
      take: limit
    });

    logger.info('memory.retrieve.db_result', {
      count: rows.length,
      ids: rows.map((row) => row.id),
      scopes: [...new Set(rows.map((row) => row.scope))],
      types: [...new Set(rows.map((row) => row.type))],
      topScore: rows[0] ? { importance: rows[0].importance, confidence: rows[0].confidence } : null,
      latencyMs: Date.now() - startedAt
    });

    if (rows.length && options.touch !== false) {
      const touchStartedAt = Date.now();
      await prisma.memoryItem.updateMany({
        where: { id: { in: rows.map((row) => row.id) } },
        data: {
          accessCount: { increment: 1 },
          lastAccessedAt: new Date()
        }
      });
      logger.info('memory.retrieve.touch_success', {
        count: rows.length,
        ids: rows.map((row) => row.id),
        latencyMs: Date.now() - touchStartedAt
      });
    }

    logger.info('memory.retrieve.success', {
      count: rows.length,
      totalLatencyMs: Date.now() - startedAt
    });

    return rows.map(mapMemory);
  } catch (error) {
    logger.info('memory.retrieve.error', {
      query: preview(options.query, 160),
      scopes: asArray(options.scopes),
      types: asArray(options.types),
      latencyMs: Date.now() - startedAt,
      error: error.message
    });
    throw error;
  }
}
