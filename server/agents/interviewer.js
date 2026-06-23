import { loadPrompt } from '../services/promptLoader.js';
import { callLLMJson } from '../services/llmClient.js';

function fallbackQuestions(focus) {
  return {
    basic: [
      '请用 1 分钟介绍这段经历里你具体负责的内容。',
      '这个项目/实习的业务目标是什么？你做的部分解决了什么问题？'
    ],
    detail: [
      `请详细展开“${focus.slice(0, 24)}...”相关实现，具体改了哪些模块？`,
      '你是如何定位问题、验证方案并确认结果的？'
    ],
    pressure: [
      '哪些部分是你独立完成的，哪些部分是在指导下完成的？',
      '如果继续深挖实现细节，你最容易被问住的点是什么？'
    ]
  };
}

export async function generateInterviewQuestions({ goal, retrieved }) {
  const focus = retrieved[0]?.content || '候选人经历片段';
  const fallbackObject = fallbackQuestions(focus);
  const system = await loadPrompt('interviewer', 'You are an interviewer agent.');
  const result = await callLLMJson({
    system,
    user: `目标：${goal}\n检索片段：\n${retrieved.map((r, i) => `${i + 1}. ${r.content}`).join('\n')}`,
    schemaHint: '{basic:string[],detail:string[],pressure:string[]}',
    fallbackObject
  });
  return { questions: { ...fallbackObject, ...result.object }, mode: result.mode };
}
