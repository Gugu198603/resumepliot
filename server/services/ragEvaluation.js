import { retrieveContext } from '../agents/retriever.js';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';
import { buildKnowledgeBase, deleteVectorNamespace, retrieveTopK } from './vectorStore.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const defaultDatasetFile = path.resolve(__dirname, '../../datasets/rag-golden.v1.json');

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

export async function loadGoldenDataset(file = process.env.RAG_GOLDEN_DATASET || defaultDatasetFile) {
  const dataset = JSON.parse(await fs.readFile(file, 'utf8'));
  if (!dataset?.id || !dataset?.version || !Array.isArray(dataset.cases) || !dataset.cases.length) {
    throw new Error('RAG golden dataset requires id, version and non-empty cases.');
  }
  return dataset;
}

export function scoreGoldenCase(retrieved = [], relevantTerms = []) {
  const terms = relevantTerms.map(normalize).filter(Boolean);
  const chunks = retrieved.map((item) => normalize(item.content || ''));
  const matchedTerms = terms.filter((term) => chunks.some((chunk) => chunk.includes(term)));
  const firstRelevantRank = chunks.findIndex((chunk) => terms.some((term) => chunk.includes(term)));
  return {
    hit: firstRelevantRank >= 0,
    matchedTerms,
    recallAtK: terms.length ? matchedTerms.length / terms.length : 1,
    reciprocalRank: firstRelevantRank >= 0 ? 1 / (firstRelevantRank + 1) : 0
  };
}

export async function evaluateGoldenDataset({ dataset, retrieve = null } = {}) {
  const source = dataset || await loadGoldenDataset();
  const cases = [];
  for (const item of source.cases) {
    const namespace = `golden:${source.version}:${item.id}`;
    let retrieved;
    try {
      if (retrieve) {
        retrieved = await retrieve(item);
      } else {
        const kb = await buildKnowledgeBase(item.corpus || '', namespace);
        retrieved = await retrieveTopK(kb, item.query, item.topK || 3);
      }
      const score = scoreGoldenCase(retrieved, item.relevantTerms || []);
      cases.push({
        id: item.id,
        query: item.query,
        topK: item.topK || 3,
        relevantTerms: item.relevantTerms || [],
        ...score,
        recallAtK: Number(score.recallAtK.toFixed(3)),
        reciprocalRank: Number(score.reciprocalRank.toFixed(3)),
        retrieved
      });
    } finally {
      if (!retrieve) await deleteVectorNamespace(namespace).catch(() => {});
    }
  }
  const total = cases.length;
  const metrics = {
    hitRate: total ? cases.filter((item) => item.hit).length / total : 0,
    recallAtK: total ? cases.reduce((sum, item) => sum + item.recallAtK, 0) / total : 0,
    mrrAtK: total ? cases.reduce((sum, item) => sum + item.reciprocalRank, 0) / total : 0
  };
  for (const key of Object.keys(metrics)) metrics[key] = Number(metrics[key].toFixed(3));
  const thresholds = source.thresholds || {};
  const failures = Object.entries(thresholds)
    .filter(([key, threshold]) => Number(metrics[key] || 0) < Number(threshold))
    .map(([key, threshold]) => ({ metric: key, actual: metrics[key] || 0, threshold }));
  return {
    dataset: { id: source.id, version: source.version },
    total,
    metrics,
    thresholds,
    passed: failures.length === 0,
    failures,
    cases
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
