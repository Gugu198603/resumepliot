import { Router } from 'express';
import { getSession } from '../services/database.js';
import { executeInterviewTurn } from '../services/interviewSessionExecution.js';
import { createSseChannel } from '../services/sseResponse.js';
import { asyncRoute, HttpError } from '../middleware/http.js';
import { logger } from '../services/logger.js';

export const sessionExecutionRouter = Router();

sessionExecutionRouter.post('/sessions/:id/continue', asyncRoute(async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found');
  const { text = '', answer = '', resumeId = session.resumeId || null } = req.body || {};
  if (!String(answer).trim()) throw new HttpError(400, 'VALIDATION_ERROR', 'answer is required');
  res.json(await executeInterviewTurn({ session, text, answer, resumeId }));
}));

sessionExecutionRouter.post('/sessions/:id/continue/stream', async (req, res) => {
  const channel = createSseChannel(res);
  try {
    const session = await getSession(req.params.id);
    if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found');
    const { text = '', answer = '', resumeId = session.resumeId || null } = req.body || {};
    if (!String(answer).trim()) throw new HttpError(400, 'VALIDATION_ERROR', 'answer is required');
    const result = await executeInterviewTurn({
      session,
      text,
      answer,
      resumeId,
      onProgress: (progress) => channel.send('process_event', progress)
    });
    channel.send('run_complete', result);
  } catch (error) {
    logger.error('session_continue_stream.error', { sessionId: req.params.id, error: error.message });
    channel.send('run_error', { error: error.message, code: error.code || 'SESSION_EXECUTION_FAILED' });
  } finally {
    channel.end();
  }
});
