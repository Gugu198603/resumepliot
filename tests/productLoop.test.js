import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCandidateProfile } from '../server/services/candidateProfile.js';
import { scoreInterviewAnswer, buildInterviewReport } from '../server/services/interviewReport.js';
import { diffResumeVersions } from '../server/services/resumeDiff.js';
import { createResumeDocx } from '../server/services/docxExport.js';

test('candidate profile links claims and metrics to source evidence', () => {
  const profile = buildCandidateProfile({
    id: 'resume-1',
    title: '后端工程师',
    sections: [
      { title: '项目经历', content: ['主导订单服务重构，将接口延迟降低 35%。', '负责 Node.js 服务开发。'] },
      { title: '技能', content: ['Node.js、Redis、PostgreSQL'] }
    ]
  });
  assert.equal(profile.resumeId, 'resume-1');
  assert.ok(profile.claims.length >= 2);
  assert.ok(profile.metrics.includes('降低 35%') || profile.metrics.includes('35%'));
  assert.ok(profile.claims.every((claim) => claim.evidenceIds.length));
  assert.ok(profile.quality.quantifiedClaimRatio > 0);
});

test('interview scoring rewards STAR structure and quantified results', () => {
  const strong = scoreInterviewAnswer({
    answer: '当时订单接口延迟较高，目标是降低峰值耗时。我负责定位慢查询并重构缓存策略，最终延迟降低 35%，上线后持续监控一周。',
    semanticMatch: 0.8
  });
  const weak = scoreInterviewAnswer({ answer: '我参与过这个项目，效果不错。', semanticMatch: 0.2 });
  assert.ok(strong.overall > weak.overall);
  assert.ok(strong.scores.starCompleteness >= 9);
  assert.ok(strong.scores.resultQuantification >= 9);
});

test('interview report aggregates saved turn assessments', () => {
  const report = buildInterviewReport({
    id: 'session-1',
    turns: [
      { question: '做了什么？', answer: '我完成了重构，延迟降低 30%。', assessment: { overall: 8, scores: { specificity: 8, technicalDepth: 7, credibility: 9, starCompleteness: 8, resultQuantification: 9, clarity: 8, jobRelevance: 8 } } }
    ]
  });
  assert.equal(report.answeredTurns, 1);
  assert.equal(report.overall, 8);
  assert.equal(report.dimensions.resultQuantification.score, 9);
});

test('resume version diff reports added, removed and changed fields', () => {
  const diff = diffResumeVersions(
    { basics: { name: 'Alice', label: 'Engineer' }, skills: ['JS'] },
    { basics: { name: 'Alice', label: 'Senior Engineer' }, projects: ['Pilot'] }
  );
  assert.equal(diff.changed, 3);
  assert.equal(diff.added, 1);
  assert.equal(diff.removed, 1);
  assert.equal(diff.updated, 1);
});

test('DOCX export creates an OOXML zip package', () => {
  const buffer = createResumeDocx({ basics: { name: 'Alice', label: 'Engineer' }, skills: [{ name: '技术', keywords: ['Node.js'] }] });
  assert.equal(buffer.subarray(0, 2).toString(), 'PK');
  assert.ok(buffer.includes(Buffer.from('word/document.xml')));
  assert.ok(buffer.length > 500);
});
