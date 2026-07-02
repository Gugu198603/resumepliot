import { Router } from 'express';
import { asyncRoute, HttpError } from '../middleware/http.js';
import {
  deleteManagedMemory,
  getManagedMemory,
  listManagedMemories,
  MEMORY_SCOPES,
  MEMORY_TYPES,
  promoteManagedMemory,
  updateManagedMemory,
  writeMemory
} from '../services/memoryManager.js';

const router = Router();

function csv(value) {
  if (Array.isArray(value)) return value.map(String).filter(Boolean);
  return String(value || '').split(',').map((item) => item.trim()).filter(Boolean);
}

function booleanQuery(value, fallback) {
  if (value === undefined) return fallback;
  return !['false', '0', 'no'].includes(String(value).toLowerCase());
}

function validateScopedEntity(body) {
  const fieldByScope = {
    user: 'userId',
    resume: 'resumeId',
    session: 'sessionId',
    job: 'jobId'
  };
  const field = fieldByScope[body.scope];
  if (field && !body[field]) {
    throw new HttpError(400, 'VALIDATION_ERROR', `${field} is required for ${body.scope} memory.`);
  }
  if (body.scope === 'run' && !body.runId && !body.sourceId) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'runId or sourceId is required for run memory.');
  }
}

router.get('/memories', asyncRoute(async (req, res) => {
  const memories = await listManagedMemories({
    query: req.query.query || '',
    scopes: csv(req.query.scope || req.query.scopes),
    types: csv(req.query.type || req.query.types),
    status: req.query.status || undefined,
    userId: req.query.userId || undefined,
    resumeId: req.query.resumeId || undefined,
    sessionId: req.query.sessionId || undefined,
    jobId: req.query.jobId || undefined,
    runId: req.query.runId || undefined,
    sourceKind: req.query.sourceKind || undefined,
    sourceId: req.query.sourceId || undefined,
    includeExpired: booleanQuery(req.query.includeExpired, true),
    limit: req.query.limit
  });
  res.json({ memories, count: memories.length });
}));

router.get('/memories/:id', asyncRoute(async (req, res) => {
  const memory = await getManagedMemory(req.params.id);
  if (!memory) throw new HttpError(404, 'MEMORY_NOT_FOUND', 'Memory not found');
  res.json({ memory });
}));

router.post('/memories', asyncRoute(async (req, res) => {
  const body = req.body || {};
  if (!MEMORY_SCOPES.has(body.scope)) {
    throw new HttpError(400, 'VALIDATION_ERROR', `Invalid memory scope: ${body.scope}`);
  }
  if (!MEMORY_TYPES.has(body.type)) {
    throw new HttpError(400, 'VALIDATION_ERROR', `Invalid memory type: ${body.type}`);
  }
  if (!String(body.content || '').trim()) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'content is required');
  }
  if (body.status && !['active', 'archived'].includes(body.status)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'status must be active or archived');
  }
  validateScopedEntity(body);
  const memory = await writeMemory({
    ...body,
    sourceKind: body.sourceKind || 'manual_api',
    sourceId: body.sourceId || `manual:${Date.now()}`
  });
  res.status(201).json({ memory });
}));

router.patch('/memories/:id', asyncRoute(async (req, res) => {
  let memory;
  try {
    memory = await updateManagedMemory(req.params.id, req.body || {});
  } catch (error) {
    throw new HttpError(400, 'VALIDATION_ERROR', error.message);
  }
  if (!memory) throw new HttpError(404, 'MEMORY_NOT_FOUND', 'Memory not found');
  res.json({ memory });
}));

router.post('/memories/:id/promote', asyncRoute(async (req, res) => {
  const result = await promoteManagedMemory(req.params.id);
  if (!result) throw new HttpError(404, 'MEMORY_NOT_FOUND', 'Memory not found');
  if (!result.promoted.length) {
    throw new HttpError(409, 'MEMORY_NOT_PROMOTABLE', 'Only active run summaries with a target session, resume or user can be promoted.');
  }
  res.json(result);
}));

router.delete('/memories/:id', asyncRoute(async (req, res) => {
  const result = await deleteManagedMemory(req.params.id);
  if (!result) throw new HttpError(404, 'MEMORY_NOT_FOUND', 'Memory not found');
  res.json({ ok: true, id: req.params.id, vectorCleanup: result.vectorCleanup });
}));

export const memoryRouter = router;
