import { chunkText, embedBatch, similarity } from '../services/vectorStore.js';
import { loadPrompt } from '../services/promptLoader.js';
import { callLLMJson } from '../services/llmClient.js';

const MATCH_THRESHOLD = 0.45;

const KEYWORD_STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'you', 'our', 'your', 'are', 'will', 'have', 'has', 'that', 'this',
  'from', 'their', 'they', 'work', 'team', 'years', 'year', 'experience', 'ability', 'strong', 'good',
  'plus', 'etc', 'using', 'use', 'used', 'including', 'include', 'required', 'requirements',
  'responsibilities', 'skills', 'knowledge', 'understanding', 'role', 'job', 'position', 'candidate',
  'candidates', 'must', 'should', 'would', 'able', 'across', 'within', 'into', 'who', 'what', 'when',
  'where', 'how', 'why', 'all', 'any', 'can', 'not', 'but', 'out', 'per', 'via', 'new', 'one', 'two',
  'more', 'most', 'such', 'also', 'well', 'here', 'there', 'about', 'than', 'then', 'them', 'these',
  'those', 'being', 'we', 'to', 'in', 'of', 'on', 'at', 'as', 'is', 'it', 'be', 'by', 'or', 'an'
]);

export function splitRequirements(jdText = '') {
  return jdText
    .split(/\n+/)
    .map((line) => line.replace(/^[\s\d.、,，)）-]+/, '').trim())
    .filter((line) => line.length >= 4);
}

export function extractKeywords(text = '', limit = 40) {
  const tokens = String(text).toLowerCase().match(/[a-z][a-z0-9+#.]+/g) || [];
  const seen = new Set();
  const out = [];
  for (const raw of tokens) {
    const token = raw.replace(/\.+$/, '');
    if (token.length < 2 || KEYWORD_STOPWORDS.has(token) || seen.has(token)) continue;
    seen.add(token);
    out.push(token);
    if (out.length >= limit) break;
  }
  return out;
}

export function buildKeywordDiff(resumeText = '', jdText = '') {
  const resumeKw = new Set(extractKeywords(resumeText, 300));
  const matchedKeywords = [];
  const missingKeywords = [];
  for (const kw of extractKeywords(jdText, 80)) {
    (resumeKw.has(kw) ? matchedKeywords : missingKeywords).push(kw);
  }
  return { matchedKeywords: matchedKeywords.slice(0, 15), missingKeywords: missingKeywords.slice(0, 15) };
}

export function buildHeuristicSummary({ matchScore = 0, matched = [], gaps = [], missingKeywords = [] }) {
  const level = matchScore >= 75 ? '高度匹配' : matchScore >= 50 ? '中等匹配' : '匹配度偏低';
  const parts = [
    `综合匹配度 ${matchScore}/100，整体${level}。`,
    `已覆盖 ${matched.length} 项要求，存在 ${gaps.length} 项缺口。`
  ];
  parts.push(missingKeywords.length
    ? `简历较少出现的关键词：${missingKeywords.slice(0, 6).join('、')}，建议在项目或技能描述中补充对应经验。`
    : '关键技能词覆盖较全，可进一步用量化结果强化已匹配亮点。');
  return parts.join('');
}

export async function matchJobDescription({ resumeText = '', resumeChunks = [], jdText = '', candidateProfile = null }) {
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
      gapReport: { summary: '暂无足够内容生成差距报告，请提供简历与岗位描述。', matchedKeywords: [], missingKeywords: [] },
      mode: 'fallback',
      llm: { mode: 'fallback', model: null, latencyMs: 0, usage: null, error: 'empty resume or jd input' }
    };
  }

  const vectors = await embedBatch([...resumeContents, ...jdChunks]);
  const resumeVecs = vectors.slice(0, resumeContents.length);
  const jdVecs = vectors.slice(resumeContents.length);

  const coverage = jdChunks.map((requirement, i) => {
    const ranked = resumeVecs
      .map((rv, resumeIndex) => ({ resumeIndex, score: similarity(jdVecs[i], rv) }))
      .sort((a, b) => b.score - a.score);
    const best = ranked[0] || { resumeIndex: -1, score: 0 };
    const evidence = best.resumeIndex >= 0 ? resumeContents[best.resumeIndex] : '';
    const strength = best.score >= 0.68 ? 'strong' : best.score >= MATCH_THRESHOLD ? 'partial' : 'missing';
    return {
      requirement,
      score: Number(best.score.toFixed(3)),
      covered: best.score >= MATCH_THRESHOLD,
      strength,
      evidence: best.score >= 0.3 ? evidence : '',
      evidenceIndex: best.resumeIndex >= 0 ? best.resumeIndex : null,
      evidenceReason: best.score >= MATCH_THRESHOLD
        ? '简历中存在语义相关的事实片段。'
        : '未找到足够强的简历证据，不能仅凭关键词视为具备该能力。'
    };
  });

  const semanticScore = coverage.reduce((sum, c) => sum + Math.min(1, Math.max(0, c.score)), 0) / coverage.length;
  const evidenceScore = coverage.reduce((sum, c) => sum + (c.strength === 'strong' ? 1 : c.strength === 'partial' ? 0.6 : 0), 0) / coverage.length;
  const matchScore = Math.round((semanticScore * 0.45 + evidenceScore * 0.55) * 100);
  const matched = coverage.filter((c) => c.covered).map((c) => c.requirement);
  const gaps = coverage.filter((c) => !c.covered).map((c) => c.requirement);
  const keywordDiff = buildKeywordDiff(resumeContents.join('\n'), jdText);

  const fallbackObject = {
    matchScore,
    matched,
    gaps,
    suggestions: gaps.length
      ? gaps.slice(0, 3).map((g) => `简历未充分体现「${g.slice(0, 40)}」，建议补充相关项目或量化结果。`)
      : ['简历与岗位要求覆盖度较高，可进一步用数据强化已匹配的亮点。'],
    summary: buildHeuristicSummary({ matchScore, matched, gaps, missingKeywords: keywordDiff.missingKeywords })
  };

  const system = await loadPrompt('jdMatcher', 'You are a job-description matching agent.');
  const result = await callLLMJson({
    system,
    user: `岗位要求片段：\n${jdChunks.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n简历内容片段：\n${resumeContents.map((c, i) => `${i + 1}. ${c}`).join('\n')}\n\n向量匹配度参考：${matchScore}/100，已覆盖 ${matched.length} 项，缺口 ${gaps.length} 项。\nsummary 用中文写一段 2-3 句的岗位-简历差距总结，指出强项、主要缺口与补强方向。`,
    schemaHint: '{matchScore:number, matched:string[], gaps:string[], suggestions:string[], summary:string}',
    fallbackObject
  });

  return {
    matchScore: typeof result.object.matchScore === 'number' ? result.object.matchScore : matchScore,
    coverage,
    matched: result.object.matched || fallbackObject.matched,
    gaps: result.object.gaps || fallbackObject.gaps,
    suggestions: result.object.suggestions || fallbackObject.suggestions,
    gapReport: {
      summary: result.object.summary || fallbackObject.summary,
      matchedKeywords: keywordDiff.matchedKeywords,
      missingKeywords: keywordDiff.missingKeywords
    },
    evidenceSummary: {
      strong: coverage.filter((item) => item.strength === 'strong').length,
      partial: coverage.filter((item) => item.strength === 'partial').length,
      missing: coverage.filter((item) => item.strength === 'missing').length,
      evidenceBackedScore: Math.round(evidenceScore * 100),
      profileQuality: candidateProfile?.quality || null
    },
    mode: result.mode,
    llm: result.meta
  };
}
