import { retrieveContext } from '../agents/retriever.js';

export const DEFAULT_GOLDEN_QUERIES = [
  { id: 'rag', query: 'RAG 向量检索 召回', expectedTerms: ['rag', '向量', '检索', '召回'] },
  { id: 'frontend', query: '前端 React Vite 性能优化', expectedTerms: ['react', 'vite', '性能', '优化'] },
  { id: 'agent', query: 'agent 多轮面试 追问 评估', expectedTerms: ['agent', '面试', '追问', '评估'] }
];

function normalize(text = '') {
  return String(text).toLowerCase();
}

function evaluateHit(retrieved = [], expectedTerms = []) {
  const terms = expectedTerms.map(normalize).filter(Boolean);
  if (!terms.length) return { matched: true, matchedTerms: [] };
  const content = normalize(retrieved.map((item) => item.content || '').join('\n'));
  const matchedTerms = terms.filter((term) => content.includes(term));
  return {
    matched: matchedTerms.length > 0,
    matchedTerms
  };
}

export async function evaluateRag({ resume, text = '', queries = DEFAULT_GOLDEN_QUERIES, topK = 3 } = {}) {
  const sourceText = resume?.text || text || '';
  const resumeId = resume?.id || null;
  const cases = [];

  for (const item of queries) {
    const retrieval = await retrieveContext({
      text: sourceText,
      query: item.query,
      topK,
      resumeId
    });
    const hit = evaluateHit(retrieval.retrieved, item.expectedTerms || []);
    cases.push({
      id: item.id || item.query,
      query: item.query,
      expectedTerms: item.expectedTerms || [],
      matched: hit.matched,
      matchedTerms: hit.matchedTerms,
      topScore: retrieval.retrieved[0]?.score || 0,
      retrieved: retrieval.retrieved.map((chunk) => ({
        id: chunk.id,
        source: chunk.source,
        score: chunk.score,
        pointId: chunk.pointId || null,
        content: chunk.content
      })),
      retrievalMeta: {
        query: retrieval.query,
        topK: retrieval.topK,
        kbSource: retrieval.kbSource,
        resumeId: retrieval.resumeId
      }
    });
  }

  const total = cases.length;
  const hits = cases.filter((item) => item.matched).length;
  const avgTopScore = total ? cases.reduce((sum, item) => sum + item.topScore, 0) / total : 0;

  return {
    resumeId,
    total,
    hits,
    hitRate: total ? Number((hits / total).toFixed(3)) : 0,
    avgTopScore: Number(avgTopScore.toFixed(3)),
    cases
  };
}
