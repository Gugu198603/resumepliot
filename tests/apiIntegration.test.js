import test, { after, before, describe } from 'node:test';
import assert from 'node:assert/strict';
import os from 'os';
import path from 'path';

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
  assert.match(body, /event: run_complete/);
});
});
