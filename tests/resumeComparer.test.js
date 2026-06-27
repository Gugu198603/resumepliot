import test from 'node:test';
import assert from 'node:assert/strict';

const { buildResumeComparison } = await import('../server/agents/resumeComparer.js');

test('buildResumeComparison computes metrics, common and unique keywords', () => {
  const resumes = [
    {
      id: 'r1',
      title: 'Backend 简历',
      text: 'python kubernetes docker microservice',
      sections: [{ title: 'exp' }, { title: 'edu' }],
      risks: [{ term: '精通' }, { term: '架构师' }],
      kbSize: 5,
      createdAt: '2026-01-01'
    },
    {
      id: 'r2',
      title: 'Frontend 简历',
      text: 'python react typescript webpack',
      sections: [{ title: 'exp' }],
      risks: [{ term: '精通' }],
      kbSize: 3,
      createdAt: '2026-02-01'
    }
  ];

  const result = buildResumeComparison(resumes);
  assert.equal(result.items.length, 2);

  assert.ok(result.commonKeywords.includes('python'), 'python is shared by both resumes');

  const r1 = result.items.find((i) => i.id === 'r1');
  const r2 = result.items.find((i) => i.id === 'r2');
  assert.ok(r1.uniqueKeywords.includes('kubernetes'), 'kubernetes is unique to r1');
  assert.ok(!r1.uniqueKeywords.includes('python'), 'shared keyword is not unique');
  assert.ok(r2.uniqueKeywords.includes('react'), 'react is unique to r2');

  assert.equal(r1.metrics.sections, 2);
  assert.equal(r1.metrics.risks, 2);
  assert.equal(r1.metrics.kbSize, 5);
  assert.deepEqual(r1.riskTerms, ['精通', '架构师']);
});

test('buildResumeComparison tolerates string risks and missing fields', () => {
  const result = buildResumeComparison([
    { id: 'a', text: 'go rust', risks: ['夸大'] },
    { id: 'b', text: 'go java' }
  ]);
  assert.equal(result.items[0].metrics.sections, 0);
  assert.deepEqual(result.items[0].riskTerms, ['夸大']);
  assert.ok(result.commonKeywords.includes('go'));
});
