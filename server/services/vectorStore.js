const providerName = process.env.VECTOR_STORE_PROVIDER || 'memory';

let providerModule;
if (providerName === 'qdrant') {
  providerModule = await import('./vectorStore.qdrant.js');
} else {
  providerModule = await import('./vectorStore.memory.js');
}

export const provider = providerModule.provider;
export const buildKnowledgeBase = providerModule.buildKnowledgeBase;
export const retrieveTopK = providerModule.retrieveTopK;
export const upsertMemoryPoint = providerModule.upsertMemoryPoint;
export const searchMemoryPoints = providerModule.searchMemoryPoints;
export const deleteVectorNamespace = providerModule.deleteVectorNamespace;
export const deleteVectorPoints = providerModule.deleteVectorPoints;
export { embedBatch, embedOne, similarity, chunkText } from './vectorStore.shared.js';
