import { normalizeJob } from './normalize.js';

export const id = 'manual';

export async function fetchJobs(config = {}) {
  const items = Array.isArray(config.items) ? config.items : config.text ? [{ text: config.text, title: config.title, company: config.company }] : [];
  return items
    .map((item) => normalizeJob({ ...item, source: 'manual' }))
    .filter((job) => job.text.length > 0);
}
