import { htmlToText, normalizeJob } from './normalize.js';

export const id = 'url';

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_BYTES = 2_000_000;

function extractTitle(html = '') {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (ogTitle) return ogTitle[1].trim();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title ? title[1].trim() : null;
}

export async function fetchOne(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResumePilotBot/0.1)' }
    });
    if (!res.ok) throw new Error(`Fetch ${url} responded ${res.status}`);
    const html = (await res.text()).slice(0, MAX_BYTES);
    const text = htmlToText(html);
    if (text.length < 40) throw new Error('Extracted text too short; page may require JS rendering.');
    return normalizeJob({ source: 'url', sourceUrl: url, title: extractTitle(html), text });
  } finally {
    clearTimeout(timer);
  }
}

export async function fetchJobs(config = {}) {
  const urls = Array.isArray(config.urls) ? config.urls : config.url ? [config.url] : [];
  const results = [];
  for (const url of urls) {
    try {
      results.push(await fetchOne(url, config));
    } catch (error) {
      results.push({ source: 'url', sourceUrl: url, error: error.message });
    }
  }
  return results;
}
