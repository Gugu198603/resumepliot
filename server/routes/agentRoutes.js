import { Router } from 'express';
import { executeAgentRun } from '../services/agentExecutionService.js';
import { createSseChannel } from '../services/sseResponse.js';
import { asyncRoute } from '../middleware/http.js';
import { logger } from '../services/logger.js';

export const agentRouter = Router();

agentRouter.post('/agent-run', asyncRoute(async (req, res) => {
  const result = await executeAgentRun(req.body || {});
  res.status(result.status === 'succeeded' ? 200 : 500).json(result);
}));

agentRouter.post('/agent-run/stream', async (req, res) => {
  const channel = createSseChannel(res);
  try {
    const result = await executeAgentRun(req.body || {}, {
      onCreated: ({ run, runtimeRunId, executionPlan, skill }) => {
        channel.send('run_created', { runId: run.id, runtimeRunId, status: 'running', executionPlan, skill });
      },
      onEvent: (event) => channel.send('run_event', event)
    });
    channel.send('run_complete', result);
  } catch (error) {
    logger.error('agent_run_stream.error', { error: error.message });
    channel.send('run_error', { error: error.message, code: error.code || 'AGENT_EXECUTION_FAILED' });
  } finally {
    channel.end();
  }
});
