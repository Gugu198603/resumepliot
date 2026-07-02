import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

process.env.APP_DB_PROVIDER = 'json';
process.env.APP_DB_FILE = path.join(os.tmpdir(), `resumepilot-api-${process.pid}.json`);
process.env.OPENAI_API_KEY = '';
process.env.RATE_LIMIT_MAX = '1000';

describe('HTTP and SSE integration', { skip: process.env.RUN_HTTP_INTEGRATION !== 'true' }, () => {
  let server;
  let baseUrl;

  before(async () => {
    const { app } = await import('../server/index.js');
    await new Promise((resolve, reject) => {
      server = app.listen(0, '127.0.0.1', () => {
        baseUrl = `http://127.0.0.1:${server.address().port}`;
        resolve();
      });
      server.on('error', reject);
    });
  });

  after(async () => {
    if (server) await new Promise((resolve) => server.close(resolve));
  });

test('health endpoint exposes security and rate-limit headers', async () => {
  const response = await fetch(`${baseUrl}/api/health`);
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  assert.equal(response.headers.get('x-ratelimit-limit'), '1000');
  assert.equal((await response.json()).ok, true);
});

test('Streamable HTTP MCP transport negotiates and calls a tool', async () => {
  const client = new Client({ name: 'http-integration-test', version: '1.0.0' });
  const transport = new StreamableHTTPClientTransport(new URL(`${baseUrl}/api/mcp`));
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.ok(listed.tools.some((tool) => tool.name === 'parse_resume'));
    const result = await client.callTool({
      name: 'parse_resume',
      arguments: { text: '技能\\nNode.js', buildKb: false }
    });
    assert.equal(result.structuredContent.kbSize, 0);
  } finally {
    await client.close();
  }
});

test('profile endpoint returns a structured not-found response', async () => {
  const response = await fetch(`${baseUrl}/api/resumes/missing/profile`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.match(body.error, /not found/i);
});

test('unknown API routes use the centralized error contract', async () => {
  const response = await fetch(`${baseUrl}/api/does-not-exist`);
  assert.equal(response.status, 404);
  const body = await response.json();
  assert.equal(body.code, 'NOT_FOUND');
});

test('Skill Router classifies paraphrases and rejects out-of-domain requests', async () => {
  const modelResponse = await fetch(`${baseUrl}/api/skill-router/model`);
  assert.equal(modelResponse.status, 200);
  const model = await modelResponse.json();
  assert.equal(model.version, '1.0.0');
  assert.equal(model.dataset.version, '1.0.0');
  const embeddingResponse = await fetch(`${baseUrl}/api/skill-router/embedding-experiment`);
  assert.equal(embeddingResponse.status, 200);
  const embeddingExperiment = await embeddingResponse.json();
  assert.equal(embeddingExperiment.encoder.dimension, 1024);
  assert.equal(embeddingExperiment.prototype.testMetrics.accuracy, 0.9);
  assert.equal(embeddingExperiment.fineTunedHead.testMetrics.unknownRecall, 1);

  const knownResponse = await fetch(`${baseUrl}/api/skill-route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal: '从系统设计角度追问我的项目' })
  });
  const known = await knownResponse.json();
  assert.equal(known.selectedSkill.id, 'interview-training');
  assert.equal(known.selectedSkill.routingSource, 'classifier');

  const unknownResponse = await fetch(`${baseUrl}/api/skill-route`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ goal: '搜索最新的前端工程师职位' })
  });
  const unknown = await unknownResponse.json();
  assert.equal(unknown.selectedSkill, null);
  assert.equal(unknown.classifier.label, 'unknown');
});

test('agent SSE endpoint emits lifecycle events', { timeout: 30_000 }, async () => {
  const response = await fetch(`${baseUrl}/api/agent-run/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: '项目经历\n负责 Node.js 订单服务重构，接口延迟降低 30%。\n技能\nNode.js Redis PostgreSQL',
      goal: '围绕项目经历生成一道面试题',
      startNewSession: true
    })
  });
  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') || '', /text\/event-stream/);
  const body = await response.text();
  assert.match(body, /event: run_created/);
  assert.match(body, /tool_call_start/);
  assert.match(body, /tool_call_success/);
  assert.match(body, /parse_resume/);
  assert.match(body, /search_resume_chunks/);
  assert.match(body, /event: run_complete/);
});

test('a later agent run recalls the previous run memory from the same session', { timeout: 30_000 }, async () => {
  const firstResponse = await fetch(`${baseUrl}/api/agent-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: '项目经历\n负责 Redis 缓存优化，接口延迟降低 30%。',
      goal: '围绕缓存优化进行模拟面试',
      startNewSession: true
    })
  });
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json();
  assert.ok(first.sessionId);
  assert.equal(first.memoryWrite?.memory?.sessionId, first.sessionId);

  const secondResponse = await fetch(`${baseUrl}/api/agent-run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: '项目经历\n负责 Redis 缓存优化，接口延迟降低 30%。',
      goal: '继续追问缓存优化的技术细节',
      sessionId: first.sessionId,
      answer: '我使用 Redis 缓存热点数据，并通过压测确认接口延迟降低 30%。'
    })
  });
  assert.equal(secondResponse.status, 200);
  const second = await secondResponse.json();
  assert.equal(second.sessionId, first.sessionId);
  assert.equal(second.memoryContext.items.some((item) => item.id === first.memoryWrite.memory.id), true);
  assert.equal(second.memoryContext.buckets.some((bucket) => bucket.label === 'run_session' && bucket.count > 0), true);
  const successfulTools = second.runEvents
    .filter((event) => event.type === 'tool_call_success')
    .map((event) => event.payload?.toolName);
  assert.equal(successfulTools.includes('evaluate_answer'), true);
  assert.equal(successfulTools.includes('rewrite_resume'), true);
});

test('session JSON and SSE transports share the interview execution workflow', { timeout: 30_000 }, async () => {
  const createResponse = await fetch(`${baseUrl}/api/sessions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title: '模块化面试', goal: '深挖项目经历' })
  });
  assert.equal(createResponse.status, 201);
  const { session } = await createResponse.json();
  const continueResponse = await fetch(`${baseUrl}/api/sessions/${session.id}/continue/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text: '负责 ResumePilot 的 Node.js 服务开发，接口延迟降低 30%。',
      answer: '我负责服务拆分和缓存优化，最终接口延迟降低 30%。'
    })
  });
  assert.equal(continueResponse.status, 200);
  const stream = await continueResponse.text();
  assert.match(stream, /event: process_event/);
  assert.match(stream, /event: run_complete/);
  const sessionResponse = await fetch(`${baseUrl}/api/sessions/${session.id}`);
  const updated = await sessionResponse.json();
  assert.equal(updated.session.turns.length, 2);
  assert.ok(updated.session.turns[0].assessment?.overall > 0);
});

test('application API creates and advances a job application', async () => {
  const jobResponse = await fetch(`${baseUrl}/api/jobs/fetch`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      source: 'manual',
      config: { items: [{ title: 'Backend Engineer', company: 'Acme', text: 'Node.js PostgreSQL' }] }
    })
  });
  assert.equal(jobResponse.status, 200);
  const job = (await jobResponse.json()).jobs[0];
  const createResponse = await fetch(`${baseUrl}/api/applications`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jobId: job.id, status: 'preparing', nextAction: '完成定向简历' })
  });
  assert.equal(createResponse.status, 201);
  const created = (await createResponse.json()).application;
  assert.equal(created.job.title, 'Backend Engineer');

  const updateResponse = await fetch(`${baseUrl}/api/applications/${created.id}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      status: 'applied',
      interviewAt: '2026-07-03T10:00:00.000Z',
      reminderAt: '2026-07-02T10:00:00.000Z',
      notes: '等待招聘方确认'
    })
  });
  assert.equal(updateResponse.status, 200);
  const updated = (await updateResponse.json()).application;
  assert.equal(updated.status, 'applied');
  assert.ok(updated.appliedAt);
  assert.equal(updated.notes, '等待招聘方确认');
  assert.equal(updated.interviewAt, '2026-07-03T10:00:00.000Z');

  const reminderResponse = await fetch(`${baseUrl}/api/application-reminders?dueBefore=2026-07-02T12:00:00.000Z`);
  assert.equal(reminderResponse.status, 200);
  const reminders = (await reminderResponse.json()).reminders;
  assert.equal(reminders.some((item) => item.id === created.id), true);
});

test('DOCX export validates and snapshots the exact submitted content', { timeout: 30_000 }, async () => {
  const form = new FormData();
  form.append('text', 'Alice\n基本信息\nAlice\n项目经历\n负责 ResumePilot，使用 Node.js 实现简历导出。');
  const parseResponse = await fetch(`${baseUrl}/api/parse`, { method: 'POST', body: form });
  assert.equal(parseResponse.status, 200);
  const parsed = await parseResponse.json();
  assert.equal(parsed.knowledgeBaseVersion, 1);
  assert.ok(parsed.knowledgeBaseVersionId);
  const kbVersionsResponse = await fetch(`${baseUrl}/api/resumes/${parsed.resumeId}/knowledge-base-versions`);
  assert.equal(kbVersionsResponse.status, 200);
  const kbVersions = await kbVersionsResponse.json();
  assert.equal(kbVersions.versions.length, 1);
  assert.equal(kbVersions.versions[0].status, 'active');

  const content = {
    basics: { name: 'Alice' },
    projects: [{ name: 'ResumePilot', highlights: ['使用 Node.js 实现简历导出'] }]
  };
  const exportResponse = await fetch(`${baseUrl}/api/resumes/${parsed.resumeId}/exports/docx`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content })
  });
  assert.equal(exportResponse.status, 200);
  assert.match(exportResponse.headers.get('content-type') || '', /wordprocessingml/);
  assert.ok(exportResponse.headers.get('x-resume-version-id'));
  const bytes = Buffer.from(await exportResponse.arrayBuffer());
  assert.equal(bytes.subarray(0, 2).toString(), 'PK');
  assert.ok(bytes.includes(Buffer.from('word/styles.xml')));
});
});
