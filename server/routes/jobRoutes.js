import { Router } from 'express';
import { listJobDescriptions, listJobMatches, saveJobDescription } from '../services/database.js';
import { listSources, fetchFromSource } from '../services/jobSources/index.js';
import { getSchedulerStatus, runOnce } from '../services/jobScheduler.js';
import { asyncRoute } from '../middleware/http.js';

export const jobRouter = Router();

jobRouter.get('/jobs', asyncRoute(async (_req, res) => {
  res.json({ jobs: await listJobDescriptions() });
}));

jobRouter.get('/job-matches', asyncRoute(async (_req, res) => {
  res.json({ matches: await listJobMatches() });
}));

jobRouter.get('/job-sources', (_req, res) => {
  res.json({ sources: listSources() });
});

jobRouter.get('/job-scheduler', (_req, res) => {
  res.json(getSchedulerStatus());
});

jobRouter.post('/job-scheduler/run', asyncRoute(async (req, res) => {
  const jobs = Array.isArray(req.body?.jobs) ? req.body.jobs : undefined;
  res.json(await runOnce(jobs));
}));

jobRouter.post('/jobs/fetch', asyncRoute(async (req, res) => {
  const { source = 'url', config = {} } = req.body || {};
  const fetched = await fetchFromSource(source, config);
  const saved = [];
  const errors = [];
  for (const job of fetched) {
    if (job.error) {
      errors.push({ sourceUrl: job.sourceUrl, error: job.error });
      continue;
    }
    saved.push(await saveJobDescription(job));
  }
  res.json({ source, savedCount: saved.length, jobs: saved, errors });
}));
