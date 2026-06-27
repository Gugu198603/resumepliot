import { rewriteResume } from '../services/resumeParser.js';
import { loadPrompt } from '../services/promptLoader.js';
import { callLLMJson } from '../services/llmClient.js';
import { formatMemoryContext } from './memoryPrompt.js';

export async function rewriteArtifacts({ text, answer = '', feedback = [], memoryContext = null }) {
  const base = rewriteResume(text);
  const fallbackObject = {
    concise: base.concise,
    detailed: base.detailed,
    improvedAnswer: answer
  };

  const system = await loadPrompt('writer', 'You are a writer agent.');
  const result = await callLLMJson({
    system,
    user: `简历原文：\n${text}\n\n原回答：${answer}\n\n反馈：${feedback.join('；')}\n\n长期记忆：\n${formatMemoryContext(memoryContext, { limit: 8 })}`,
    schemaHint: '{concise:string,detailed:string,improvedAnswer:string}',
    fallbackObject
  });

  return { ...fallbackObject, ...result.object, mode: result.mode, llm: result.meta };
}
