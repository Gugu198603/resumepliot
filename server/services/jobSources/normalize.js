import crypto from 'crypto';

export function htmlToText(html = '') {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|li|br|h[1-6]|tr)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .join('\n')
    .trim();
}

export function dedupeKeyFor({ source, sourceUrl, text }) {
  const basis = sourceUrl || `${source || 'manual'}:${(text || '').slice(0, 400)}`;
  return crypto.createHash('sha1').update(basis).digest('hex');
}

export function normalizeJob(raw = {}) {
  const text = (raw.text || raw.originalText || '').trim();
  const source = raw.source || 'manual';
  const sourceUrl = raw.sourceUrl || null;
  return {
    title: raw.title || null,
    company: raw.company || null,
    location: raw.location || null,
    source,
    sourceUrl,
    text,
    dedupeKey: raw.dedupeKey || dedupeKeyFor({ source, sourceUrl, text })
  };
}

function toTermList(value) {
  if (Array.isArray(value)) return value.map((s) => String(s).trim().toLowerCase()).filter(Boolean);
  if (typeof value === 'string') return value.split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  return [];
}

// Filters normalized jobs by keyword(s) and/or location.
// filter: { keywords, excludeKeywords, location, keywordMode: 'any' | 'all' }
// keywords match against title + text; location matches against location + title + text.
export function applyJobFilter(jobs = [], filter = {}) {
  const keywords = toTermList(filter.keywords);
  const excludeKeywords = toTermList(filter.excludeKeywords);
  const locations = toTermList(filter.location ?? filter.locations);
  const mode = filter.keywordMode === 'all' ? 'all' : 'any';
  if (!keywords.length && !excludeKeywords.length && !locations.length) return jobs;

  return jobs.filter((job) => {
    if (job.error) return true; // keep error markers so caller can report them
    const haystack = `${job.title || ''}\n${job.text || ''}`.toLowerCase();
    const locHaystack = `${job.location || ''}\n${job.title || ''}\n${job.text || ''}`.toLowerCase();

    if (keywords.length) {
      const hit = mode === 'all'
        ? keywords.every((kw) => haystack.includes(kw))
        : keywords.some((kw) => haystack.includes(kw));
      if (!hit) return false;
    }
    if (excludeKeywords.length && excludeKeywords.some((kw) => haystack.includes(kw))) return false;
    if (locations.length && !locations.some((loc) => locHaystack.includes(loc))) return false;
    return true;
  });
}
