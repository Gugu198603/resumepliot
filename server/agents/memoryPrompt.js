function truncate(text = '', limit = 280) {
  const clean = String(text || '').replace(/\s+/g, ' ').trim();
  return clean.length > limit ? `${clean.slice(0, limit)}...` : clean;
}

export function formatMemoryContext(memoryContext = {}, { limit = 8 } = {}) {
  const safeContext = memoryContext || {};
  const items = Array.isArray(safeContext.items) ? safeContext.items : [];
  if (!items.length) return '无可用长期记忆。';

  return items.slice(0, limit).map((item, index) => {
    const scope = item.scope || 'unknown';
    const type = item.type || 'memory';
    const title = item.title ? `${item.title}: ` : '';
    const score = item.retrievalScore != null ? ` score=${item.retrievalScore}` : '';
    return `${index + 1}. [${scope}/${type}${score}] ${title}${truncate(item.content)}`;
  }).join('\n');
}
