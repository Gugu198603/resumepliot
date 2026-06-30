const DIMENSIONS = [
  ['specificity', '具体性'],
  ['technicalDepth', '技术深度'],
  ['credibility', '事实可信度'],
  ['starCompleteness', 'STAR 完整度'],
  ['resultQuantification', '结果量化'],
  ['clarity', '表达清晰度'],
  ['jobRelevance', '岗位相关性']
];

function clampScore(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.max(0, Math.min(10, Number(number.toFixed(1)))) : fallback;
}

export function scoreInterviewAnswer({ answer = '', semanticMatch = 0, baseScores = {} } = {}) {
  const text = String(answer || '').trim();
  const hasSituation = /背景|当时|场景|目标|需求|问题|situation|task/i.test(text);
  const hasAction = /我|负责|设计|实现|开发|优化|排查|推动|action/i.test(text);
  const hasResult = /结果|最终|提升|降低|减少|增长|达到|上线|result/i.test(text);
  const hasMetric = /\d+(?:\.\d+)?\s*(?:%|倍|万|亿|ms|秒|分钟|小时|天|人|个|条|次|QPS|TPS)/i.test(text);
  const sentenceCount = text.split(/[。！？!?\n]+/).filter(Boolean).length;
  const specificity = clampScore(baseScores.specificity, Math.min(10, 2 + text.length / 35));
  const technicalDepth = clampScore(baseScores.technicalDepth, Math.min(10, 3 + (text.match(/[A-Za-z][A-Za-z0-9.+#/-]{1,}/g) || []).length / 3));
  const credibility = clampScore(baseScores.credibility, semanticMatch >= 0.45 ? 8 : 5);
  const starCompleteness = clampScore([hasSituation, hasAction, hasResult].filter(Boolean).length * 3 + (hasMetric ? 1 : 0));
  const resultQuantification = clampScore(hasMetric ? 9 : hasResult ? 5 : 2);
  const clarity = clampScore(text.length ? 5 + Math.min(3, sentenceCount / 2) - (text.length > 800 ? 1 : 0) : 0);
  const jobRelevance = clampScore(semanticMatch ? semanticMatch * 10 : credibility - 1);
  const scores = { specificity, technicalDepth, credibility, starCompleteness, resultQuantification, clarity, jobRelevance };
  const overall = Number((Object.values(scores).reduce((sum, score) => sum + score, 0) / Object.keys(scores).length).toFixed(1));
  return { overall, scores };
}

export function buildInterviewReport(session = {}) {
  const answeredTurns = (session.turns || []).filter((turn) => String(turn.answer || '').trim());
  const scoredTurns = answeredTurns.map((turn, index) => {
    const assessment = turn.assessment || scoreInterviewAnswer({
      answer: turn.answer,
      semanticMatch: turn.scores?.semanticMatch,
      baseScores: turn.scores || {}
    });
    return {
      turn: index + 1,
      question: turn.question || '',
      answer: turn.answer || '',
      feedback: turn.critique || [],
      ...assessment
    };
  });
  const dimensions = Object.fromEntries(DIMENSIONS.map(([key, label]) => {
    const average = scoredTurns.length
      ? scoredTurns.reduce((sum, turn) => sum + clampScore(turn.scores?.[key]), 0) / scoredTurns.length
      : 0;
    return [key, { label, score: Number(average.toFixed(1)) }];
  }));
  const overall = scoredTurns.length
    ? Number((scoredTurns.reduce((sum, turn) => sum + turn.overall, 0) / scoredTurns.length).toFixed(1))
    : 0;
  const weakest = Object.entries(dimensions).sort((a, b) => a[1].score - b[1].score).slice(0, 3);
  return {
    sessionId: session.id || null,
    answeredTurns: scoredTurns.length,
    overall,
    dimensions,
    weakestDimensions: weakest.map(([key, value]) => ({ key, ...value })),
    recommendations: weakest.map(([, value]) => `${value.label}当前 ${value.score}/10，下一轮回答优先补充对应证据。`),
    turns: scoredTurns
  };
}
