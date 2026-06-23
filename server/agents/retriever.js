import { buildKnowledgeBase, retrieveTopK } from '../services/vectorStore.js';

export async function retrieveContext({ text, query, topK = 3 }) {
  const kb = await buildKnowledgeBase(text);
  const retrieved = await retrieveTopK(kb, query || text.slice(0, 100), topK);
  return { kb, retrieved };
}
