import { chunkText, embedBatch, embedOne, similarity } from './vectorStore.shared.js';

export async function buildKnowledgeBase(text) {
  const chunks = chunkText(text);
  if (!chunks.length) return [];
  const vectors = await embedBatch(chunks);
  return chunks.map((chunk, index) => ({ id: index + 1, content: chunk, embedding: vectors[index] }));
}

export async function retrieveTopK(kb, query, topK = 3) {
  if (!kb.length) return [];
  const queryEmbedding = await embedOne(query);
  return kb
    .map((chunk) => ({ ...chunk, score: similarity(chunk.embedding, queryEmbedding) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map(({ id, content, score }) => ({ id, content, score: Number(score.toFixed(3)) }));
}

export async function upsertMemoryPoint() {
  return null;
}

export async function searchMemoryPoints() {
  return [];
}

export async function deleteVectorNamespace(namespace) {
  return { deleted: true, namespace, noop: true };
}

export const provider = 'memory';
