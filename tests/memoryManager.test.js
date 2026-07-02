import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

const dbFile = path.join(await fs.mkdtemp(path.join(os.tmpdir(), 'resumepilot-memory-')), 'app-db.json');
process.env.APP_DB_PROVIDER = 'json';
process.env.APP_DB_FILE = dbFile;
process.env.MEMORY_PROMOTION_HIT_THRESHOLD = '3';

const { retrieveMemory, writeMemory } = await import(`../server/services/memoryManager.js?test=${Date.now()}`);

test('memory write deduplicates the same scoped source', async () => {
  const input = {
    scope: 'run',
    type: 'summary',
    resumeId: 'resume_memory',
    sessionId: 'session_memory',
    sourceKind: 'test',
    sourceId: 'run_1',
    content: '负责 Redis 缓存优化，接口延迟降低 30%。'
  };
  const first = await writeMemory(input);
  const second = await writeMemory(input);
  assert.equal(second.id, first.id);
  const rows = await retrieveMemory({ scopes: ['run'], resumeId: input.resumeId, touch: false });
  assert.equal(rows.length, 1);
});

test('run memory is promoted after repeated retrieval', async () => {
  const input = {
    scope: 'run',
    type: 'summary',
    resumeId: 'resume_promote',
    sessionId: 'session_promote',
    sourceKind: 'test',
    sourceId: 'run_promote',
    content: '候选人负责订单服务缓存优化。'
  };
  await writeMemory(input);
  await retrieveMemory({ scopes: ['run'], resumeId: input.resumeId });
  await retrieveMemory({ scopes: ['run'], resumeId: input.resumeId });
  await retrieveMemory({ scopes: ['run'], resumeId: input.resumeId });

  const resumeMemories = await retrieveMemory({
    scopes: ['resume'],
    resumeId: input.resumeId,
    touch: false
  });
  const sessionMemories = await retrieveMemory({
    scopes: ['session'],
    sessionId: input.sessionId,
    touch: false
  });
  assert.equal(resumeMemories.some((item) => item.sourceKind === 'memory_promotion'), true);
  assert.equal(sessionMemories.some((item) => item.sourceKind === 'memory_promotion'), true);
});

test('expired memory is excluded unless explicitly requested', async () => {
  await writeMemory({
    scope: 'resume',
    type: 'fact',
    resumeId: 'resume_expired',
    sourceKind: 'test',
    sourceId: 'expired',
    content: '这条记忆已经过期。',
    expiresAt: new Date(Date.now() - 60_000).toISOString()
  });
  const active = await retrieveMemory({ scopes: ['resume'], resumeId: 'resume_expired', touch: false });
  const all = await retrieveMemory({
    scopes: ['resume'],
    resumeId: 'resume_expired',
    includeExpired: true,
    touch: false
  });
  assert.equal(active.length, 0);
  assert.equal(all.length, 1);
});
