import { htmlToText, normalizeJob } from './normalize.js';
import dns from 'dns/promises';
import net from 'net';

export const id = 'url';

const DEFAULT_TIMEOUT_MS = 15000;
const MAX_BYTES = 2_000_000;

function isPrivateIp(address = '') {
  if (net.isIPv4(address)) {
    const [a, b] = address.split('.').map(Number);
    return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168);
  }
  if (net.isIPv6(address)) {
    const value = address.toLowerCase();
    return value === '::1' || value.startsWith('fc') || value.startsWith('fd') || value.startsWith('fe80:');
  }
  return true;
}

export async function assertSafePublicUrl(value) {
  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error('岗位链接格式无效。');
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error('岗位链接只支持 http/https。');
  if (parsed.username || parsed.password) throw new Error('岗位链接不能包含认证信息。');
  if (parsed.hostname === 'localhost' || parsed.hostname.endsWith('.local')) throw new Error('不允许抓取本地地址。');
  const addresses = await dns.lookup(parsed.hostname, { all: true });
  if (!addresses.length || addresses.some((item) => isPrivateIp(item.address))) {
    throw new Error('不允许抓取内网或保留地址。');
  }
  return parsed.toString();
}

function extractTitle(html = '') {
  const ogTitle = html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)["']/i);
  if (ogTitle) return ogTitle[1].trim();
  const title = html.match(/<title[^>]*>([\s\S]*?)<\/title>/i);
  return title ? title[1].trim() : null;
}

export async function fetchOne(url, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
  const safeUrl = await assertSafePublicUrl(url);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(safeUrl, {
      signal: controller.signal,
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; ResumePilotBot/0.1)' }
    });
    if (!res.ok) throw new Error(`Fetch ${safeUrl} responded ${res.status}`);
    const html = (await res.text()).slice(0, MAX_BYTES);
    const text = htmlToText(html);
    if (text.length < 40) throw new Error('Extracted text too short; page may require JS rendering.');
    return normalizeJob({ source: 'url', sourceUrl: safeUrl, title: extractTitle(html), text });
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
