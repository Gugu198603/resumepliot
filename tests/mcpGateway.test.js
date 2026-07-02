import test from 'node:test';
import assert from 'node:assert/strict';
import { handleMcpRequest } from '../server/mcp/runtime.js';
import { invokeTool } from '../server/tools/toolGateway.js';

test('MCP initialize negotiates capabilities and protocol version', async () => {
  const response = await handleMcpRequest({
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: { protocolVersion: '2025-06-18', clientInfo: { name: 'test', version: '1' } }
  });
  assert.equal(response.result.protocolVersion, '2025-06-18');
  assert.equal(response.result.serverInfo.name, 'resumepilot-mcp');
  assert.equal(response.result.capabilities.tools.listChanged, false);
});

test('MCP tool call returns standard content and structured output', async () => {
  const response = await handleMcpRequest({
    jsonrpc: '2.0',
    id: 2,
    method: 'tools/call',
    params: {
      name: 'parse_resume',
      arguments: { text: '技能\nNode.js', buildKb: false }
    }
  });
  assert.equal(response.result.content[0].type, 'text');
  assert.equal(response.result.structuredContent.sections.length > 0, true);
  assert.equal(response.result.isError, false);
});

test('MCP validates required tool arguments', async () => {
  const response = await handleMcpRequest({
    jsonrpc: '2.0',
    id: 3,
    method: 'tools/call',
    params: { name: 'parse_resume', arguments: {} }
  });
  assert.equal(response.error.code, -32000);
  assert.match(response.error.message, /text is required/i);
});

test('Tool Gateway enforces agent allowlists and emits audit events', async () => {
  const audit = [];
  await assert.rejects(
    invokeTool({
      agent: 'parser',
      name: 'rewrite_resume',
      args: { text: 'x' },
      onAudit: (event) => audit.push(event)
    }),
    (error) => error.code === 'TOOL_FORBIDDEN'
  );
  const result = await invokeTool({
    agent: 'parser',
    name: 'parse_resume',
    args: { text: '项目经历\nResumePilot', buildKb: false },
    onAudit: (event) => audit.push(event)
  });
  assert.equal(result.sections.length > 0, true);
  assert.deepEqual(audit.slice(-2).map((item) => item.type), ['tool_call_start', 'tool_call_success']);
});

test('Tool Gateway stops waiting after its timeout budget', async () => {
  await assert.rejects(
    invokeTool({
      agent: 'parser',
      name: 'parse_resume',
      args: { text: 'x' },
      timeoutMs: 5,
      requestHandler: () => new Promise(() => {})
    }),
    (error) => error.code === 'TOOL_TIMEOUT'
  );
});

test('Tool Gateway dispatches qualified external tools only when explicitly allowed', async () => {
  const calls = [];
  const result = await invokeTool({
    agent: 'retriever',
    name: 'search::query',
    args: { q: 'ResumePilot' },
    allowedTools: ['search::query'],
    externalToolCaller: async (name, args) => {
      calls.push({ name, args });
      return { matches: 2 };
    }
  });
  assert.deepEqual(result, { matches: 2 });
  assert.deepEqual(calls, [{ name: 'search::query', args: { q: 'ResumePilot' } }]);
});
