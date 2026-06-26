import { chunkText, embedBatch, similarity } from '../services/vectorStore.js';
import { loadPrompt } from '../services/promptLoader.js';
import { callLLMJson } from '../services/llmClient.js';

const MATCH_THRESHOLD = 0.45;

export function splitRequirements(jdText = '') {
  return jdText
    .split(/\n+/)
    .map((line) => line.replace(/^[\s\d.、,，)）-]+/, '').trim())
    .filter((line) => line.length >= 4);
}

export async function matchJobDescription({ resumeText = '', resumeChunks = [], jdText = '' }) {
  const jdChunks = splitRequirements(jdText);
  const resumeContents = (resumeChunks.length
    ? resumeChunks.map((c) => c.content)
    : chunkText(resumeText)
  ).filter(Boolean);

  if (!jdChunks.length || !resumeContents.length) {
    return {
      matchScore: 0,
      coverage: [],
      matched: [],
      gaps: jdChunks,
      suggestions: ['请提供有效的简历内容与岗位描述后再进行对比。'],
      mode: 'fallback',
      llm: { mode: 'fallback', model: null, latencyMs: 0, usage: null, error: 'empty resume or jd input' }
    };
  }

  const vectors = await embedBatch([...resumeContents, ...jdChunks]);
  const resumeVecs = vectors.slice(0, resumeContents.length);
  const jdVecs = vectors.slice(resumeContents.length);

  const coverage = jdChunks.map((requirement, i) => {
    const best = resumeVecs.reduce((max, rv) => Math.max(max, similarity(jdVecs[i], rv)), 0);
    return { requirement, score: Number(best.toFixed(3)), covered: best >= MATCH_THRESHOLD };
  });

  const matchScore = Math.round(
    (coverage.reduce((sum, c) => sum + Math.min(1, Math.max(0, c.score)), 0) / coverage.length) * 100
  );
  const matched = coverage.filter((c) => c.covered).map((c) => c.requirement);
  const gaps = coverage.filter((c) => !c.covered).map((c) => c.requirement);

  const fallbackObject = {
    matchScore,
    matched,
    gaps,
    suggestions: gaps.length
      ? gaps.slice(0, 3).map((g) => `简历未充分体现「${g.slice(0, 40)}」，建议补充相关项目或量化结果。`)
      : ['简历与岗位要求覆盖度较高，可进一步用数据强化已匹配的亮点。']
  };

  const system = await loadPrompt('jdMatcher', 'You are a job-description matching agent.');
  const result = await callLLMJson({
    system,
    user: `岗位要求片段：\n${jdChunks.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n简历内容片段：\n${resumeContents.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n向量匹配度参考：${matchScore}/100，已覆盖 ${matched.length} 项，缺口 ${gaps.length} 项。`,
    schemaHint: '{matchScore:number, matched:string[], gaps:string[], suggestions:string[]}',
    fallbackObject
  });

  return {
    matchScore: typeof result.object.matchScore === 'number' ? result.object.matchScore : matchScore,
    coverage,
    matched: result.object.matched || fallbackObject.matched,
    gaps: result.object.gaps || fallbackObject.gaps,
    suggestions: result.object.suggestions || fallbackObject.suggestions,
    mode: result.mode,
    llm: result.meta
  };
}
