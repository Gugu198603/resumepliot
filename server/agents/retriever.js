import { buildKnowledgeBase, retrieveTopK } from '../services/vectorStore.js';
import { getResume } from '../services/database.js';

function sessionTurnsToText(turns = []) {
  return turns.map((turn, idx) => {
    return `Turn ${idx + 1}\nQuestion: ${turn.question || ''}\nAnswer: ${turn.answer || ''}\nCritique: ${Array.isArray(turn.critique) ? turn.critique.join('；') : (turn.critique || '')}\nImproved: ${turn.improvedAnswer || ''}`;
  }).join('\n\n');
}

export async function retrieveContext({ text, query, topK = 3, sessionTurns = [], resumeId = null }) {
  const persistedResume = resumeId ? await getResume(resumeId) : null;
  const resumeText = persistedResume?.text || text || '';
  const persistedChunks = Array.isArray(persistedResume?.chunks) ? persistedResume.chunks : [];
  const canReusePersistedKb = persistedChunks.length && persistedChunks.every((chunk) => Array.isArray(chunk.embedding) || chunk.pointId || chunk.namespace);
  const resumeKb = canReusePersistedKb ? persistedChunks : await buildKnowledgeBase(resumeText, resumeId || undefined);
  const historyText = sessionTurnsToText(sessionTurns);
  const historyKb = historyText ? await buildKnowledgeBase(historyText) : [];

  const fallbackQuery = query || resumeText.slice(0, 100);
  const resumeResults = await retrieveTopK(resumeKb, fallbackQuery, topK);
  const historyResults = historyKb.length ? await retrieveTopK(historyKb, fallbackQuery, Math.max(1, Math.floor(topK / 2))) : [];

  const taggedResume = resumeResults.map((item) => ({ ...item, source: 'resume' }));
  const taggedHistory = historyResults.map((item) => ({ ...item, source: 'session_history' }));

  const merged = [...taggedResume, ...taggedHistory]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK + 1);

  return {
    query: fallbackQuery,
    topK,
    kb: resumeKb,
    historyKb,
    retrieved: merged,
    resumeResults: taggedResume,
    historyResults: taggedHistory,
    resumeId: persistedResume?.id || resumeId,
    kbSource: canReusePersistedKb ? 'persisted' : 'rebuilt'
  };
}
