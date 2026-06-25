import { createHash } from 'crypto';
import { embedBatch, embedOne, chunkText } from './vectorStore.shared.js';

const QDRANT_URL = process.env.QDRANT_URL || 'http://localhost:6333';
const QDRANT_COLLECTION = process.env.QDRANT_COLLECTION || 'resume_chunks';
const QDRANT_API_KEY = process.env.QDRANT_API_KEY || '';
const VECTOR_SIZE = Number(process.env.QDRANT_VECTOR_SIZE || 1024);

function headers() {
  return {
    'Content-Type': 'application/json',
    ...(QDRANT_API_KEY ? { 'api-key': QDRANT_API_KEY } : {})
  };
}

async function qdrantFetch(path, options = {}) {
  const res = await fetch(`${QDRANT_URL}${path}`, {
    ...options,
    headers: {
      ...headers(),
      ...(options.headers || {})
    }
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Qdrant request failed (${res.status}): ${text}`);
  }
  return await res.json();
}

async function ensureCollection() {
  try {
    await qdrantFetch(`/collections/${QDRANT_COLLECTION}`);
    return;
  } catch {}

  await qdrantFetch(`/collections/${QDRANT_COLLECTION}`, {
    method: 'PUT',
    body: JSON.stringify({
      vectors: {
        size: VECTOR_SIZE,
        distance: 'Cosine'
      }
    })
  });
}

function buildPointId(namespace, idx) {
  const hex = createHash('md5').update(`${namespace}:${idx}`).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
}

export async function buildKnowledgeBase(text, namespace = `resume_${Date.now()}`) {
  const chunks = chunkText(text);
  if (!chunks.length) return [];
  const vectors = await embedBatch(chunks);
  await ensureCollection();

  const points = chunks.map((chunk, index) => ({
    id: buildPointId(namespace, index + 1),
    vector: vectors[index],
    payload: {
      namespace,
      chunkId: index + 1,
      content: chunk
    }
  }));

  await qdrantFetch(`/collections/${QDRANT_COLLECTION}/points?wait=true`, {
    method: 'PUT',
    body: JSON.stringify({ points })
  });

  return points.map((point) => ({
    id: point.payload.chunkId,
    content: point.payload.content,
    pointId: point.id,
    namespace
  }));
}

export async function retrieveTopK(kb, query, topK = 3) {
  if (!kb.length) return [];
  const namespace = kb[0]?.namespace;
  const queryVector = await embedOne(query);

  const result = await qdrantFetch(`/collections/${QDRANT_COLLECTION}/points/search`, {
    method: 'POST',
    body: JSON.stringify({
      vector: queryVector,
      limit: topK,
      with_payload: true,
      filter: namespace
        ? {
            must: [
              {
                key: 'namespace',
                match: { value: namespace }
              }
            ]
          }
        : undefined
    })
  });

  return (result.result || []).map((item) => ({
    id: item.payload?.chunkId,
    content: item.payload?.content,
    score: Number((item.score || 0).toFixed(3)),
    pointId: item.id
  }));
}

export async function debugCollectionInfo() {
  return await qdrantFetch(`/collections/${QDRANT_COLLECTION}`);
}

export const provider = 'qdrant';
