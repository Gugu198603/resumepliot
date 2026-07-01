import { Router } from 'express';
import { createSession, getSession, listSessions } from '../services/database.js';
import { asyncRoute, HttpError } from '../middleware/http.js';

export const sessionRouter = Router();

sessionRouter.get('/sessions', asyncRoute(async (_req, res) => {
  res.json({ sessions: await listSessions() });
}));

sessionRouter.get('/sessions/:id', asyncRoute(async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found');
  res.json({ session });
}));

sessionRouter.post('/sessions', asyncRoute(async (req, res) => {
  const title = req.body?.title || 'New Session';
  const goal = req.body?.goal || title;
  const session = await createSession({ title, goal, resumeId: req.body?.resumeId || null });
  res.status(201).json({ session });
}));
