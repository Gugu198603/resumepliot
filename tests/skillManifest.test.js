import test from 'node:test';
import assert from 'node:assert/strict';
import { loadSkills, validateSkillManifest } from '../server/services/skillLoader.js';
import { routeSkill } from '../server/router/skillRouter.js';

test('all skills expose valid versioned manifests and tool policies', async () => {
  const skills = await loadSkills();
  assert.ok(skills.length >= 4);
  for (const skill of skills) {
    assert.match(skill.version, /^\d+\.\d+\.\d+/);
    assert.ok(skill.triggers.length);
    assert.ok(Array.isArray(skill.allowedTools));
    assert.equal(skill.inputSchema.type, 'object');
    assert.equal(skill.outputSchema.type, 'object');
  }
});

test('skill router selects by trigger and exposes confidence and version', async () => {
  const result = await routeSkill({ goal: '请根据我的经历做一次模拟面试' });
  assert.equal(result.selectedSkill.id, 'interview-training');
  assert.equal(result.selectedSkill.version, '1.0.0');
  assert.ok(result.selectedSkill.confidence >= 0.45);
  assert.equal(result.rejected, false);
  assert.equal(result.classifier.available, true);
  assert.equal(result.classifier.modelVersion, '1.0.0');
});

test('skill router classifies paraphrases that do not contain manifest triggers', async () => {
  const result = await routeSkill({ goal: '从系统设计角度追问我的项目' });
  assert.equal(result.selectedSkill.id, 'interview-training');
  assert.equal(result.selectedSkill.routingSource, 'classifier');
  assert.equal(result.classifier.predictedLabel, 'interview-training');
});

test('skill router rejects unrelated goals below confidence threshold', async () => {
  const result = await routeSkill({ goal: '搜索最新的前端工程师职位' });
  assert.equal(result.selectedSkill, null);
  assert.equal(result.rejected, true);
  assert.equal(result.classifier.label, 'unknown');
});

test('manifest validation rejects invalid versions and directory mismatch', () => {
  assert.throws(() => validateSkillManifest({
    id: 'demo',
    name: 'Demo',
    version: 'latest',
    description: 'demo',
    triggers: ['demo'],
    allowedTools: [],
    routing: { minConfidence: 0.5 },
    inputSchema: { type: 'object' },
    outputSchema: { type: 'object' }
  }, 'demo'), /semantic versioning/);
});
