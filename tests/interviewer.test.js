import test from 'node:test';
import assert from 'node:assert/strict';

delete process.env.OPENAI_API_KEY;
const { generateInterviewQuestions } = await import('../server/agents/interviewer.js');

const retrieved = [{ content: 'RAG 检索系统优化项目' }];

test('first round focuses on background stage and uses focus snippet', async () => {
  const { questions, stage, depth } = await generateInterviewQuestions({ goal: '面试训练', retrieved, depth: 0 });
  assert.equal(depth, 0);
  assert.equal(stage, '背景澄清');
  assert.ok(questions.detail[0].includes('背景澄清'));
});

test('later rounds advance stage and build on previous answer', async () => {
  const { questions, stage } = await generateInterviewQuestions({
    goal: '面试训练',
    retrieved,
    previousAnswer: '我用 BGE-M3 做了向量召回并接入 Qdrant',
    depth: 2,
    askedQuestions: ['请介绍背景', '方案细节如何']
  });
  assert.equal(stage, '验证与结果');
  assert.ok(questions.detail[0].includes('验证与结果'));
  assert.ok(questions.detail[0].includes('BGE-M3'), 'follow-up references the previous answer snippet');
  assert.ok(questions.detail[1].includes('量化'), 'depth>=2 asks for quantified results');
});

test('depth beyond stage list clamps to last stage', async () => {
  const { stage } = await generateInterviewQuestions({ goal: 'g', retrieved, depth: 9, previousAnswer: 'x' });
  assert.equal(stage, '反思与拓展');
});
