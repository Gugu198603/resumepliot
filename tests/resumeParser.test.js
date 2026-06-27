import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeText, splitSections, detectRisks, rewriteResume } from '../server/services/resumeParser.js';

test('normalizeText trims and collapses excessive blank lines', () => {
  assert.equal(normalizeText('  A\r\n\n\nB  '), 'A\nB');
});

test('normalizeText removes PDF layout whitespace and page breaks', () => {
  assert.equal(normalizeText(' A\u00a0\u00a0  B\f\n\n C  '), 'A B\nC');
});

test('normalizeText strips PDF private-use bullet glyphs', () => {
  assert.equal(normalizeText('数据分析看板\n■性能优化\n•项目经历'), '数据分析看板\n性能优化\n项目经历');
});

test('splitSections extracts common resume sections', () => {
  const sections = splitSections('教育背景\n本科 计算机\n项目经历\n使用 RAG 构建检索系统');
  assert.equal(sections.length, 2);
  assert.equal(sections[0].title, '教育背景');
  assert.deepEqual(sections[1].content, ['使用 RAG 构建检索系统']);
});

test('splitSections infers common resume headings and avoids unlabeled sections', () => {
  const sections = splitSections('熟练掌握 React 和 Vite\n教育背景\n本科 信息系统\n个人技能\nTypeScript');
  assert.equal(sections[0].title, '个人技能');
  assert.equal(sections[1].title, '教育背景');
  assert.equal(sections[2].title, '个人技能');
  assert.ok(!sections.some((section) => section.title === '未分类'));
});

test('splitSections classifies out-of-order PDF column text by content', () => {
  const sections = splitSections([
    '姓名：张三',
    '求职意向：前端实习生',
    '工作经验',
    '基本信息',
    '前端开发实习生某某公司2024.11-2025.2',
    '负责 React 组件开发和性能优化。',
    '求职简历',
    'PERSONALRESUME',
    'Web前端画布实时协作项目2025.4-2025.5',
    '技术栈：React+Yjs+Node.js'
  ].join('\n'));
  assert.equal(sections[0].title, '基本信息');
  assert.equal(sections[1].title, '工作经验');
  assert.equal(sections[2].title, '项目经验');
  assert.ok(!sections[2].content.includes('PERSONALRESUME'));
});

test('detectRisks extracts technical terms from resume text dynamically', () => {
  const risks = detectRisks('技术栈：React+Vite+TypeScript\n做过 RAG 向量检索项目');
  assert.ok(risks.some((risk) => risk.term === 'RAG'));
  assert.ok(risks.some((risk) => risk.term === 'TypeScript'));
  assert.ok(risks.some((risk) => risk.term === 'React'));
});

test('rewriteResume returns concise and detailed artifacts', () => {
  const out = rewriteResume('项目经历\n负责检索模块\n负责评估模块');
  assert.match(out.concise, /项目经历/);
  assert.match(out.detailed, /负责检索模块/);
});
