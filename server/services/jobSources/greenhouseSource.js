import { htmlToText, normalizeJob, applyJobFilter } from './normalize.js';

export const id = 'greenhouse';

const DEFAULT_TIMEOUT_MS = 15000;

function boardsToList(config) {
  if (Array.isArray(config.boards)) return config.boards;
  if (config.board) return [config.board];
  const env = process.env.GREENHOUSE_BOARDS;
  return env ? env.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

async function fetchBoard(board, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://boards-api.greenhouse.io/v1/boards/${encodeURIComponent(board)}/jobs?content=true`;
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Greenhouse board ${board} responded ${res.status}`);
    const data = await res.json();
    const jobs = Array.isArray(data.jobs) ? data.jobs : [];
    return jobs.map((job) => normalizeJob({
      source: 'greenhouse',
      sourceUrl: job.absolute_url || null,
      title: job.title || null,
      company: board,
      location: job.location?.name || null,
      text: htmlToText(decodeContent(job.content || ''))
    })).filter((j) => j.text.length > 0);
  } finally {
    clearTimeout(timer);
  }
}

function decodeContent(html) {
  return html
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

export async function fetchJobs(config = {}) {
  const boards = boardsToList(config);
  const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
  const limit = Number(config.limit) || Infinity;
  const results = [];
  for (const board of boards) {
    try {
      const jobs = await fetchBoard(board, timeoutMs);
      results.push(...jobs);
    } catch (error) {
      results.push({ source: 'greenhouse', sourceUrl: board, error: error.message });
    }
  }
  const filtered = applyJobFilter(results, config.filter || config);
  const ok = filtered.filter((r) => !r.error);
  const errors = filtered.filter((r) => r.error);
  return [...ok.slice(0, limit), ...errors];
}
