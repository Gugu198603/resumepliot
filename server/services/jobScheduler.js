import { fetchFromSource } from './jobSources/index.js';
import { saveJobDescription } from './database.js';

const DEFAULT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6h

let timer = null;
const state = {
  enabled: false,
  intervalMs: DEFAULT_INTERVAL_MS,
  jobs: [],
  running: false,
  lastRunAt: null,
  lastResult: null
};

function parseScheduleConfig() {
  const raw = process.env.JOB_SCHEDULER_CONFIG;
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function runOnce(jobs = state.jobs) {
  if (state.running) return state.lastResult;
  state.running = true;
  const summary = { startedAt: new Date().toISOString(), saved: 0, skipped: 0, errors: [] };
  try {
    for (const entry of jobs) {
      const source = entry.source;
      const config = entry.config || {};
      try {
        const fetched = await fetchFromSource(source, config);
        for (const job of fetched) {
          if (job.error) { summary.errors.push({ source, sourceUrl: job.sourceUrl, error: job.error }); continue; }
          await saveJobDescription(job);
          summary.saved += 1;
        }
      } catch (error) {
        summary.errors.push({ source, error: error.message });
      }
    }
  } finally {
    summary.finishedAt = new Date().toISOString();
    state.running = false;
    state.lastRunAt = summary.finishedAt;
    state.lastResult = summary;
  }
  return summary;
}

export function startScheduler() {
  state.enabled = String(process.env.JOB_SCHEDULER_ENABLED || '').toLowerCase() === 'true';
  state.intervalMs = Number(process.env.JOB_SCHEDULER_INTERVAL_MS || DEFAULT_INTERVAL_MS);
  state.jobs = parseScheduleConfig();

  if (timer) { clearInterval(timer); timer = null; }
  if (!state.enabled || !state.jobs.length) return getSchedulerStatus();

  timer = setInterval(() => { runOnce().catch(() => {}); }, state.intervalMs);
  if (timer.unref) timer.unref();
  runOnce().catch(() => {});
  return getSchedulerStatus();
}

export function stopScheduler() {
  if (timer) { clearInterval(timer); timer = null; }
  state.enabled = false;
  return getSchedulerStatus();
}

export function getSchedulerStatus() {
  return {
    enabled: state.enabled,
    intervalMs: state.intervalMs,
    sources: state.jobs.map((j) => j.source),
    running: state.running,
    lastRunAt: state.lastRunAt,
    lastResult: state.lastResult
  };
}
