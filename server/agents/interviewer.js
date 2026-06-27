import { loadPrompt } from '../services/promptLoader.js';
import { callLLMJson } from '../services/llmClient.js';
import { formatMemoryContext } from './memoryPrompt.js';

const DEPTH_STAGES = [
  { label: '背景澄清', hint: '先厘清这段经历的背景、目标与候选人具体职责。' },
  { label: '方案细节', hint: '深入实现方案、关键技术选型与权衡取舍。' },
  { label: '验证与结果', hint: '追问如何验证、量化结果以及遇到的问题如何解决。' },
  { label: '反思与拓展', hint: '考察复盘、可改进点以及迁移到其他场景的能力。' }
];

function stageForDepth(depth = 0) {
  return DEPTH_STAGES[Math.min(depth, DEPTH_STAGES.length - 1)];
}

function fallbackQuestions(focus, previousAnswer = '', depth = 0) {
  const stage = stageForDepth(depth);
  const snippet = String(previousAnswer || '').slice(0, 28);
  const followup = previousAnswer
    ? `你刚提到“${snippet}...”，请继续围绕「${stage.label}」展开：${stage.hint}`
    : `请围绕“${String(focus).slice(0, 24)}...”从「${stage.label}」入手展开。`;

  return {
    basic: [
      `请用 1 分钟介绍这段经历里你具体负责的内容。`,
      '这个项目/实习的业务目标是什么？你做的部分解决了什么问题？'
    ],
    detail: [
      followup,
      depth >= 2
        ? '你是如何量化这段经历的结果的？有没有可对比的前后数据？'
        : '你是如何定位问题、验证方案并确认结果的？'
    ],
    pressure: [
      depth >= 3
        ? '如果重新做一次，你会在哪些设计上做不同的选择？为什么？'
        : '哪些部分是你独立完成的，哪些部分是在指导下完成的？',
      '如果继续深挖实现细节，你最容易被问住的点是什么？'
    ]
  };
}

export async function generateInterviewQuestions({ goal, retrieved, previousAnswer = '', previousQuestion = '', depth = 0, askedQuestions = [], memoryContext = null }) {
  const focus = retrieved[0]?.content || '候选人经历片段';
  const stage = stageForDepth(depth);
  const fallbackObject = fallbackQuestions(focus, previousAnswer, depth);
  const system = await loadPrompt('interviewer', 'You are an interviewer agent.');
  const askedBlock = askedQuestions.length
    ? `\n已问过的问题（不要重复，请基于回答继续深入）：\n${askedQuestions.map((q, i) => `${i + 1}. ${q}`).join('\n')}`
    : '';
  const result = await callLLMJson({
    system,
    user: `目标：${goal}\n当前追问阶段：第 ${depth + 1} 轮「${stage.label}」——${stage.hint}\n上一轮问题：${previousQuestion}\n上一轮回答：${previousAnswer}${askedBlock}\n长期记忆：\n${formatMemoryContext(memoryContext, { limit: 8 })}\n检索片段：\n${retrieved.map((r, i) => `${i + 1}. ${r.content}`).join('\n')}\n\n请生成连续追问：detail[0] 必须是基于上一轮回答、聚焦当前阶段的递进追问，且不与已问问题重复。`,
    schemaHint: '{basic:string[],detail:string[],pressure:string[]}',
    fallbackObject
  });
  return { questions: { ...fallbackObject, ...result.object }, mode: result.mode, llm: result.meta, depth, stage: stage.label };
}
