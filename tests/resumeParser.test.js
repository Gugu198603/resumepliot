import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, splitSections, detectRisks, rewriteResume } from '../server/services/resumeParser.js';

test('normalizeText trims and collapses excessive blank lines', () => {
  assert.equal(normalizeText('  A\r\n\n\nB  '), 'A\n\nB');
});

test('splitSections extracts common resume sections', () => {
  const sections = splitSections('教育背景\n本科 计算机\n项目经历\n使用 RAG 构建检索系统');
  assert.equal(sections.length, 2);
  assert.equal(sections[0].title, '教育背景');
  assert.deepEqual(sections[1].content, ['使用 RAG 构建检索系统']);
});

test('detectRisks finds technical terms case-insensitively', () => {
  const risks = detectRisks('做过 rag 和 TypeScript 项目');
  assert.ok(risks.some((risk) => risk.term === 'RAG'));
  assert.ok(risks.some((risk) => risk.term === 'TypeScript'));
});

test('rewriteResume returns concise and detailed artifacts', () => {
  const out = rewriteResume('项目经历\n负责检索模块\n负责评估模块');
  assert.match(out.concise, /项目经历/);
  assert.match(out.detailed, /负责检索模块/);
});
