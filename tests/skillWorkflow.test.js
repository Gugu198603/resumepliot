import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSkillWorkflow, resolveExecutionPlan } from '../server/services/skillWorkflow.js';

test('parseSkillWorkflow maps skill steps to agents', () => {
  const plan = parseSkillWorkflow(`# Skill\n\n## Workflow\n1. Parse the resume.\n2. Use retrieval to fetch chunks.\n3. Generate interview questions.\n4. Critique the answer.\n5. Rewrite the answer.\n\n## Output principles\n- Be grounded.`);
  assert.deepEqual(plan.map((step) => step.agent), ['parser', 'retriever', 'interviewer', 'critic', 'writer']);
});

test('resolveExecutionPlan falls back to default minimal plan', () => {
  const plan = resolveExecutionPlan({ content: '# Empty Skill' });
  assert.equal(plan.length, 3);
  assert.deepEqual(plan.map((step) => step.agent), ['parser', 'planner', 'retriever']);
});
