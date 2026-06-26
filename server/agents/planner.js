import { loadPrompt } from '../services/promptLoader.js';
import { callLLMJson } from '../services/llmClient.js';

export async function planNextStep({ goal, history = [], sections = [] }) {
  const lowerGoal = (goal || '').toLowerCase();
  const nextAgent = history.length === 0 ? 'retriever' : history.length < 2 ? 'interviewer' : 'critic';

  let stage = 'general';
  if (/rewrite|改写|resume/.test(lowerGoal)) stage = 'rewrite';
  else if (/evaluate|评分|评估|review/.test(lowerGoal)) stage = 'evaluate';
  else if (/question|追问|interview|面试/.test(lowerGoal)) stage = 'interview';

  const fallbackObject = {
    currentStage: stage,
    nextAgent,
    sectionHints: sections.slice(0, 3).map((s) => s.title),
    reason: '根据当前目标和历史轮次选择下一位 specialist agent。'
  };

  const system = await loadPrompt('planner', 'You are a planner agent.');
  const result = await callLLMJson({
    system,
    user: `目标：${goal}\n历史轮次：${history.length}\n已识别模块：${sections.map((s) => s.title).join(', ')}`,
    schemaHint: '{currentStage:string,nextAgent:string,reason:string,sectionHints:string[]}',
    fallbackObject
  });
  return { ...fallbackObject, ...result.object, mode: result.mode, llm: result.meta };
}
