import { embedBatch, similarity } from '../services/vectorStore.js';
import { loadPrompt } from '../services/promptLoader.js';
import { callLLMJson } from '../services/llmClient.js';
import { formatMemoryContext } from './memoryPrompt.js';
import { scoreInterviewAnswer } from '../services/interviewReport.js';

export async function critiqueAnswer({ answer, retrieved = [], question = '', memoryContext = null }) {
  const len = answer.trim().length;
  const detailScore = Math.min(10, Math.floor(len / 35) + 2);

  let bestScore = 0;
  if (len > 0 && retrieved.length) {
    const texts = retrieved.map((r) => r.content);
    const [answerVec, ...chunkVecs] = await embedBatch([answer, ...texts]);
    bestScore = chunkVecs.reduce((m, v) => Math.max(m, similarity(answerVec, v)), 0);
  }
  const isRelevant = bestScore > 0.45;

  const fallbackObject = {
    feedback: [
      len < 80 ? '回答偏短，建议补充背景、动作、难点、结果。' : '回答长度尚可，但还可以补充更具体的动作。',
      isRelevant ? '回答和原经历语义相关性较高。' : '回答和原经历关联偏弱，建议多引用实际做过的内容。',
      '建议补充一个实际问题、一个你亲手修改过的模块、一个验证结果。'
    ]
  };

  const system = await loadPrompt('critic', 'You are a critic agent.');
  const result = await callLLMJson({
    system,
    user: `问题：${question}\n回答：${answer}\n长期记忆：\n${formatMemoryContext(memoryContext, { limit: 8 })}\n检索片段：\n${retrieved.map((r, i) => `${i + 1}. ${r.content}`).join('\n')}`,
    schemaHint: '{feedback:string[]}',
    fallbackObject
  });

  const scores = {
      specificity: detailScore,
      technicalDepth: Math.max(3, Math.min(10, detailScore - 1)),
      credibility: isRelevant ? 8 : 5,
      semanticMatch: Number(bestScore.toFixed(3))
    };
  const assessment = scoreInterviewAnswer({ answer, semanticMatch: bestScore, baseScores: scores });
  return {
    scores,
    assessment,
    feedback: result.object.feedback || fallbackObject.feedback,
    mode: result.mode,
    llm: result.meta
  };
}
