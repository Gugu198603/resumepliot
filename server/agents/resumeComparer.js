import { extractKeywords } from './jdMatcher.js';

function resumeText(resume) {
  return resume?.text || '';
}

function metricsFor(resume) {
  return {
    sections: Array.isArray(resume?.sections) ? resume.sections.length : 0,
    risks: Array.isArray(resume?.risks) ? resume.risks.length : 0,
    kbSize: Number(resume?.kbSize || 0),
    chars: resumeText(resume).length
  };
}

function riskTermsFor(resume) {
  return (Array.isArray(resume?.risks) ? resume.risks : [])
    .map((risk) => (typeof risk === 'string' ? risk : risk?.term))
    .filter(Boolean);
}

export function buildResumeComparison(resumes = []) {
  const valid = resumes.filter(Boolean);
  const keywordSets = valid.map((resume) => new Set(extractKeywords(resumeText(resume), 200)));

  const commonKeywords = keywordSets.length
    ? [...keywordSets[0]].filter((kw) => keywordSets.every((set) => set.has(kw))).slice(0, 20)
    : [];

  const items = valid.map((resume, idx) => {
    const own = keywordSets[idx];
    const others = keywordSets.filter((_, i) => i !== idx);
    const uniqueKeywords = [...own]
      .filter((kw) => others.every((set) => !set.has(kw)))
      .slice(0, 20);
    return {
      id: resume.id,
      title: resume.title || resume.id,
      createdAt: resume.createdAt || null,
      metrics: metricsFor(resume),
      uniqueKeywords,
      riskTerms: riskTermsFor(resume).slice(0, 20)
    };
  });

  return { items, commonKeywords };
}
