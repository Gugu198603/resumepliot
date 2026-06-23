import { buildKnowledgeBase, retrieveTopK } from '../services/vectorStore.js';

function sessionTurnsToText(turns = []) {
  return turns.map((turn, idx) => {
    return `Turn ${idx + 1}\nQuestion: ${turn.question || ''}\nAnswer: ${turn.answer || ''}\nCritique: ${Array.isArray(turn.critique) ? turn.critique.join('；') : (turn.critique || '')}\nImproved: ${turn.improvedAnswer || ''}`;
  }).join('\n\n');
}

export async function retrieveContext({ text, query, topK = 3, sessionTurns = [] }) {
  const resumeKb = await buildKnowledgeBase(text || '');
  const historyText = sessionTurnsToText(sessionTurns);
  const historyKb = historyText ? await buildKnowledgeBase(historyText) : [];

  const resumeResults = await retrieveTopK(resumeKb, query || text.slice(0, 100), topK);
  const historyResults = historyKb.length ? await retrieveTopK(historyKb, query || text.slice(0, 100), Math.max(1, Math.floor(topK / 2))) : [];

  const taggedResume = resumeResults.map((item) => ({ ...item, source: 'resume' }));
  const taggedHistory = historyResults.map((item) => ({ ...item, source: 'session_history' }));

  const merged = [...taggedResume, ...taggedHistory]
    .sort((a, b) => b.score - a.score)
    .slice(0, topK + 1);

  return {
    kb: resumeKb,
    historyKb,
    retrieved: merged,
    resumeResults: taggedResume,
    historyResults: taggedHistory
  };
}
