const TECH_TOKEN = /(?:[A-Za-z][A-Za-z0-9.+#/-]{1,30}|[\u4e00-\u9fa5]{2,12})/g;
const METRIC_PATTERN = /(?:提升|降低|减少|增长|达到|覆盖|节省|优化|缩短|支持)?\s*\d+(?:\.\d+)?\s*(?:%|倍|万|亿|ms|s|秒|分钟|小时|天|人|个|条|次|QPS|TPS)/gi;
const ACTION_PATTERN = /负责|主导|设计|实现|开发|搭建|优化|重构|推动|落地|排查|解决|验证|发布|维护/;
const STOPWORDS = new Set([
  '以及', '通过', '使用', '进行', '相关', '工作', '项目', '能力', '熟悉', '掌握', '负责', '参与',
  'experience', 'skills', 'work', 'project', 'using', 'with', 'and', 'the', 'for', 'from'
]);

function clean(value = '') {
  return String(value || '').replace(/\s+/g, ' ').trim();
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function evidenceLines(resume = {}) {
  const fromSections = (resume.sections || []).flatMap((section, sectionIndex) =>
    (section.content || []).map((line, lineIndex) => ({
      id: `section-${sectionIndex + 1}-line-${lineIndex + 1}`,
      section: section.title || '未命名模块',
      text: clean(line)
    }))
  ).filter((item) => item.text);
  if (fromSections.length) return fromSections;
  return clean(resume.text).split(/\n+/).map((line, index) => ({
    id: `resume-line-${index + 1}`,
    section: '简历正文',
    text: clean(line)
  })).filter((item) => item.text);
}

function tokensOf(text = '') {
  return unique((clean(text).match(TECH_TOKEN) || [])
    .map((token) => token.toLowerCase())
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token)))
    .slice(0, 120);
}

function skillCandidates(lines = []) {
  const weighted = new Map();
  for (const line of lines) {
    const sectionBoost = /技能|技术|skill/i.test(line.section) ? 3 : 1;
    for (const token of tokensOf(line.text)) {
      if (/^\d+$/.test(token) || token.length > 24) continue;
      weighted.set(token, (weighted.get(token) || 0) + sectionBoost);
    }
  }
  return [...weighted.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 30)
    .map(([name, mentions]) => ({
      name,
      mentions,
      evidenceIds: lines.filter((line) => tokensOf(line.text).includes(name)).slice(0, 5).map((line) => line.id)
    }));
}

export function buildCandidateProfile(resume = {}) {
  const evidence = evidenceLines(resume);
  const claims = evidence.filter((item) => ACTION_PATTERN.test(item.text)).map((item) => ({
    id: `claim-${item.id}`,
    statement: item.text,
    section: item.section,
    evidenceIds: [item.id],
    metrics: item.text.match(METRIC_PATTERN) || [],
    confidence: item.text.match(METRIC_PATTERN) ? 0.95 : 0.78
  }));
  const metrics = unique(claims.flatMap((claim) => claim.metrics));
  const skills = skillCandidates(evidence);
  const weakClaims = claims.filter((claim) => !claim.metrics.length);

  return {
    version: '1.0',
    resumeId: resume.id || null,
    headline: resume.title || evidence[0]?.text || '候选人画像',
    skills,
    claims,
    metrics,
    evidence,
    quality: {
      evidenceCount: evidence.length,
      claimCount: claims.length,
      quantifiedClaimCount: claims.length - weakClaims.length,
      quantifiedClaimRatio: claims.length ? Number(((claims.length - weakClaims.length) / claims.length).toFixed(2)) : 0
    },
    clarificationNeeds: weakClaims.slice(0, 8).map((claim) => ({
      claimId: claim.id,
      question: `“${claim.statement.slice(0, 48)}”的结果如何验证？可以补充规模、前后对比或业务指标吗？`
    }))
  };
}

export function profileText(profile = {}) {
  return (profile.evidence || []).map((item) => item.text).join('\n');
}
