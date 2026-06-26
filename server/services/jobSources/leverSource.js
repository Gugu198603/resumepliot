import { normalizeJob, applyJobFilter } from './normalize.js';

export const id = 'lever';

const DEFAULT_TIMEOUT_MS = 15000;

function companiesToList(config) {
  if (Array.isArray(config.companies)) return config.companies;
  if (config.company) return [config.company];
  const env = process.env.LEVER_COMPANIES;
  return env ? env.split(',').map((s) => s.trim()).filter(Boolean) : [];
}

async function fetchCompany(company, timeoutMs) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const url = `https://api.lever.co/v0/postings/${encodeURIComponent(company)}?mode=json`;
    const res = await fetch(url, { signal: controller.signal, headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error(`Lever company ${company} responded ${res.status}`);
    const data = await res.json();
    const postings = Array.isArray(data) ? data : [];
    return postings.map((p) => normalizeJob({
      source: 'lever',
      sourceUrl: p.hostedUrl || null,
      title: p.text || null,
      company,
      location: p.categories?.location || p.country || null,
      text: (p.descriptionPlain || '').trim()
    })).filter((j) => j.text.length > 0);
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJobs(config = {}) {
  const companies = companiesToList(config);
  const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT_MS;
  const limit = Number(config.limit) || Infinity;
  const results = [];
  for (const company of companies) {
    try {
      const jobs = await fetchCompany(company, timeoutMs);
      results.push(...jobs);
    } catch (error) {
      results.push({ source: 'lever', sourceUrl: company, error: error.message });
    }
  }
  const filtered = applyJobFilter(results, config.filter || config);
  const ok = filtered.filter((r) => !r.error);
  const errors = filtered.filter((r) => r.error);
  return [...ok.slice(0, limit), ...errors];
}
