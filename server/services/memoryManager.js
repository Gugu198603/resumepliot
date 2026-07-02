import { createHash } from 'crypto';
import { logger } from './logger.js';
import { provider as vectorProvider, searchMemoryPoints, upsertMemoryPoint } from './vectorStore.js';
import {
  createMemoryRecord,
  findMemoryRecord,
  listMemoryRecords,
  touchMemoryRecords,
  updateMemoryRecord
} from './database.js';

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

const PROMOTION_HIT_THRESHOLD = Number(process.env.MEMORY_PROMOTION_HIT_THRESHOLD || 3);
const PROMOTION_TARGETS = ['session', 'resume', 'user'];

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

function entityIdForScope(scope, input = {}) {
  if (scope === 'global') return 'global';
  if (scope === 'user') return input.userId || null;
  if (scope === 'resume') return input.resumeId || null;
  if (scope === 'session') return input.sessionId || null;
  if (scope === 'job') return input.jobId || null;
  if (scope === 'run') return input.runId || input.sourceId || null;
  return null;
}

export function buildMemoryNamespace(scope, input = {}) {
  const entityId = entityIdForScope(scope, input);
  return entityId ? `memory:${scope}:${entityId}` : null;
}

function buildSearchNamespaces(options = {}) {
  const scopes = asArray(options.scopes);
  const targets = scopes.length ? scopes : [...MEMORY_SCOPES];
  return targets
    .map((scope) => buildMemoryNamespace(scope, options))
    .filter(Boolean);
}

function isPromotableRunSummary(row) {
  return row?.scope === 'run' && row?.type === 'summary' && row?.status === 'active';
}

function promotionTargetsFor(row) {
  return PROMOTION_TARGETS
    .map((scope) => ({ scope, entityId: entityIdForScope(scope, row) }))
    .filter((target) => target.entityId);
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

async function indexMemoryRow(row) {
  if (!row || vectorProvider !== 'qdrant') return { indexed: false, reason: 'vector_provider_not_qdrant' };
  const namespace = buildMemoryNamespace(row.scope, row);
  if (!namespace) return { indexed: false, reason: 'missing_namespace' };

  try {
    const indexed = await upsertMemoryPoint({
      namespace,
      memoryId: row.id,
      content: row.content,
      payload: {
        scope: row.scope,
        type: row.type,
        userId: row.userId || null,
        resumeId: row.resumeId || null,
        sessionId: row.sessionId || null,
        jobId: row.jobId || null,
        runId: row.runId || null,
        sourceKind: row.sourceKind || null,
        sourceId: row.sourceId || null,
        title: row.title || null,
        contentHash: row.contentHash || null
      }
    });

    if (!indexed?.pointId) return { indexed: false, reason: 'empty_point' };

    const updated = await updateMemoryRecord(row.id, {
        embeddingProvider: process.env.EMBED_MODEL || 'Xenova/bge-m3',
        vectorProvider,
        vectorNamespace: indexed.namespace,
        vectorPointId: indexed.pointId,
        vectorDim: indexed.vectorDim
    });
    return { indexed: true, row: updated };
  } catch (error) {
    logger.info('memory.vector.index_failed', {
      id: row.id,
      scope: row.scope,
      type: row.type,
      error: error.message
    });
    return { indexed: false, reason: error.message };
  }
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
      const namespace = input.vectorNamespace || buildMemoryNamespace(input.scope, input);
      const existing = await findMemoryRecord({
          scope: input.scope,
          type: input.type,
          contentHash: hash,
          userId: input.userId || null,
          resumeId: input.resumeId || null,
          sessionId: input.sessionId || null,
          jobId: input.jobId || null,
          runId: input.runId || null,
          sourceKind: input.sourceKind || null,
          sourceId: input.sourceId || null
      });
      const row = existing || await createMemoryRecord({
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
          vectorNamespace: namespace || null,
        vectorPointId: input.vectorPointId || null,
        vectorDim: Number.isFinite(input.vectorDim) ? input.vectorDim : null,
        status: input.status || 'active',
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        metadataJson: toJsonString(input.metadata)
    });
      const indexResult = existing?.vectorPointId ? { row: existing } : await indexMemoryRow(row);
      const mapped = mapMemory(indexResult.row || row);

    logger.info('memory.write.success', {
        id: mapped.id,
        scope: mapped.scope,
        type: mapped.type,
        sourceKind: mapped.sourceKind,
        sourceId: mapped.sourceId,
        contentHash: mapped.contentHash,
        vectorProvider: mapped.vectorProvider || null,
        vectorNamespace: mapped.vectorNamespace || null,
        vectorPointId: mapped.vectorPointId || null,
        reusedExisting: Boolean(existing),
      latencyMs: Date.now() - startedAt
    });

      return mapped;
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

async function retrieveVectorMemoryCandidates(options, limit) {
  if (vectorProvider !== 'qdrant' || !String(options.query || '').trim()) return [];
  const namespaces = buildSearchNamespaces(options);
  if (!namespaces.length) return [];

  try {
    const points = await searchMemoryPoints({ namespaces, query: options.query, limit });
    const ids = [...new Set(points.map((point) => point.memoryId).filter(Boolean))];
    if (!ids.length) return [];
    const scopeList = asArray(options.scopes);
    const typeList = asArray(options.types);
    const rows = await listMemoryRecords({
      ids,
      scopes: scopeList,
      types: typeList,
      status: options.status || 'active',
      includeExpired: options.includeExpired
    }, ids.length);
    const scoreById = new Map(points.map((point) => [point.memoryId, point]));
    return rows.map((row) => ({
      ...row,
      retrievalScore: scoreById.get(row.id)?.score || null,
      retrievalSource: 'vector'
    }));
  } catch (error) {
    logger.info('memory.vector.retrieve_failed', {
      query: preview(options.query, 160),
      namespaces,
      error: error.message
    });
    return [];
  }
}

async function promoteMemoryItem(row) {
  if (!isPromotableRunSummary(row)) return [];
  const targets = promotionTargetsFor(row);
  if (!targets.length) return [];
  const promoted = [];

  for (const target of targets) {
    const exists = await findMemoryRecord({
        scope: target.scope,
        type: row.type,
        contentHash: row.contentHash,
        userId: target.scope === 'user' ? row.userId : null,
        resumeId: target.scope === 'resume' ? row.resumeId : null,
        sessionId: target.scope === 'session' ? row.sessionId : null,
        sourceKind: 'memory_promotion',
        sourceId: row.id
    });
    if (exists) continue;

    const namespace = buildMemoryNamespace(target.scope, row);
    const created = await createMemoryRecord({
        userId: target.scope === 'user' ? row.userId : null,
        resumeId: target.scope === 'resume' ? row.resumeId : null,
        sessionId: target.scope === 'session' ? row.sessionId : null,
        jobId: null,
        runId: null,
        scope: target.scope,
        type: row.type,
        sourceKind: 'memory_promotion',
        sourceId: row.id,
        title: row.title ? `[promoted:${target.scope}] ${row.title}` : `Promoted ${target.scope} memory`,
        content: row.content,
        contentHash: row.contentHash,
        importance: Math.min(1, (row.importance || 0.5) + 0.1),
        confidence: Math.max(0, (row.confidence || 1) - 0.05),
        vectorNamespace: namespace,
        status: 'active',
        metadataJson: toJsonString({
          promotedFrom: row.id,
          promotedFromScope: row.scope,
          promotedAtAccessCount: row.accessCount
        })
    });
    const indexResult = await indexMemoryRow(created);
    promoted.push(mapMemory(indexResult.row || created));
  }

  if (promoted.length) {
    logger.info('memory.promote.success', {
      sourceId: row.id,
      targets: promoted.map((item) => ({ id: item.id, scope: item.scope }))
    });
  }
  return promoted;
}

async function promoteRetrievedMemories(rows = []) {
  const candidates = rows.filter((row) => isPromotableRunSummary(row) && (row.accessCount || 0) + 1 >= PROMOTION_HIT_THRESHOLD);
  const results = [];
  for (const row of candidates) {
    results.push(...await promoteMemoryItem(row));
  }
  return results;
}

export async function retrieveMemory(options = {}) {
  const limit = Math.min(Number(options.limit) || 10, 50);
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
    const rows = await listMemoryRecords({
      query: options.query || '',
      scopes: asArray(options.scopes),
      types: asArray(options.types),
      userId: options.userId,
      resumeId: options.resumeId,
      sessionId: options.sessionId,
      jobId: options.jobId,
      runId: options.runId,
      sourceKind: options.sourceKind,
      sourceId: options.sourceId,
      status: options.status || 'active',
      includeExpired: options.includeExpired
    }, limit);
    const vectorRows = await retrieveVectorMemoryCandidates(options, limit);
    const mergedById = new Map();
    for (const row of [...vectorRows, ...rows]) {
      const current = mergedById.get(row.id);
      if (!current || (row.retrievalScore || 0) > (current.retrievalScore || 0)) {
        mergedById.set(row.id, row);
      }
    }
    const mergedRows = [...mergedById.values()]
      .sort((a, b) => {
        const scoreDiff = (b.retrievalScore || 0) - (a.retrievalScore || 0);
        if (scoreDiff) return scoreDiff;
        const importanceDiff = (b.importance || 0) - (a.importance || 0);
        if (importanceDiff) return importanceDiff;
        return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
      })
      .slice(0, limit);

    logger.info('memory.retrieve.db_result', {
      count: mergedRows.length,
      dbCount: rows.length,
      vectorCount: vectorRows.length,
      ids: mergedRows.map((row) => row.id),
      scopes: [...new Set(mergedRows.map((row) => row.scope))],
      types: [...new Set(mergedRows.map((row) => row.type))],
      topScore: mergedRows[0] ? { importance: mergedRows[0].importance, confidence: mergedRows[0].confidence, retrievalScore: mergedRows[0].retrievalScore || null } : null,
      latencyMs: Date.now() - startedAt
    });

    if (mergedRows.length && options.touch !== false) {
      const touchStartedAt = Date.now();
      await touchMemoryRecords(mergedRows.map((row) => row.id));
      const promoted = await promoteRetrievedMemories(mergedRows);
      logger.info('memory.retrieve.touch_success', {
        count: mergedRows.length,
        ids: mergedRows.map((row) => row.id),
        promotedCount: promoted.length,
        latencyMs: Date.now() - touchStartedAt
      });
    }

    logger.info('memory.retrieve.success', {
      count: mergedRows.length,
      totalLatencyMs: Date.now() - startedAt
    });

    return mergedRows.map(mapMemory);
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
