import 'dotenv/config';
import { pathToFileURL } from 'url';
import cors from 'cors';
import express from 'express';
import { agentRouter } from './routes/agentRoutes.js';
import { applicationRouter } from './routes/applicationRoutes.js';
import { jobMatchRouter } from './routes/jobMatchRoutes.js';
import { jobRouter } from './routes/jobRoutes.js';
import { productRouter } from './routes/productRoutes.js';
import { resumeAnalysisRouter, mergeDuplicateResumes } from './routes/resumeAnalysisRoutes.js';
import { createResumeRouter } from './routes/resumeRoutes.js';
import { sessionExecutionRouter } from './routes/sessionExecutionRoutes.js';
import { sessionRouter } from './routes/sessionRoutes.js';
import { skillRouter } from './routes/skillRoutes.js';
import { createSystemRouter } from './routes/systemRoutes.js';
import { errorHandler, notFoundHandler } from './middleware/http.js';
import {
  apiTokenAuth,
  basicSecurityHeaders,
  corsOptionsFromEnv,
  createRateLimit
} from './middleware/security.js';
import { startScheduler } from './services/jobScheduler.js';
import { computeDashboard, getQdrantReadiness } from './services/systemMetrics.js';
import { provider as vectorProvider } from './services/vectorStore.js';

const app = express();
const PORT = Number(process.env.PORT || 8787);

app.use(cors(corsOptionsFromEnv()));
app.use(basicSecurityHeaders);
app.use(createRateLimit({
  windowMs: Number(process.env.RATE_LIMIT_WINDOW_MS || 60_000),
  max: Number(process.env.RATE_LIMIT_MAX || 120)
}));
app.use(apiTokenAuth);
app.use(express.json({ limit: '10mb' }));

app.use('/api', createSystemRouter({ vectorProvider, computeDashboard, getQdrantReadiness }));
app.use('/api', productRouter);
app.use('/api', applicationRouter);
app.use('/api', jobRouter);
app.use('/api', jobMatchRouter);
app.use('/api', sessionRouter);
app.use('/api', createResumeRouter({ mergeDuplicateResumes }));
app.use('/api', resumeAnalysisRouter);
app.use('/api', sessionExecutionRouter);
app.use('/api', agentRouter);
app.use('/api', skillRouter);

app.use(notFoundHandler);
app.use(errorHandler);

export { app };

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  app.listen(PORT, () => {
    console.log(`ResumePilot Web App server running at http://localhost:${PORT}`);
    const scheduler = startScheduler();
    if (scheduler.enabled) {
      console.log(`Job scheduler enabled: sources=[${scheduler.sources.join(', ')}], interval=${scheduler.intervalMs}ms`);
    }
  });
}
