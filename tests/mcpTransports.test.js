import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import {
  callExternalTool,
  closeExternalMcpConnections,
  listExternalTools,
  parseExternalMcpServers
} from '../server/mcp/externalClient.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const stdioServer = path.join(root, 'server/mcp/stdio.js');

test('official stdio transport lists and calls ResumePilot tools', async () => {
  const client = new Client({ name: 'stdio-test', version: '1.0.0' });
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [stdioServer],
    cwd: root,
    stderr: 'pipe'
  });
  try {
    await client.connect(transport);
    const listed = await client.listTools();
    assert.ok(listed.tools.some((tool) => tool.name === 'parse_resume'));
    const result = await client.callTool({
      name: 'parse_resume',
      arguments: { text: '技能\\nNode.js', buildKb: false }
    });
    assert.equal(result.isError, undefined);
    assert.equal(result.structuredContent.kbSize, 0);
  } finally {
    await client.close();
  }
});

test('external MCP manager qualifies tools and connects over stdio', async () => {
  const configs = parseExternalMcpServers([{
    id: 'local-resume',
    transport: 'stdio',
    command: process.execPath,
    args: [stdioServer],
    cwd: root
  }]);
  try {
    const tools = await listExternalTools(configs);
    assert.ok(tools.some((tool) => tool.name === 'local-resume::parse_resume'));
    const result = await callExternalTool('local-resume::parse_resume', {
      text: '项目\\nResumePilot',
      buildKb: false
    }, configs);
    assert.equal(result.kbSize, 0);
  } finally {
    await closeExternalMcpConnections();
  }
});

test('external MCP configuration rejects unsafe or incomplete entries', () => {
  assert.throws(
    () => parseExternalMcpServers([{ id: '../bad', transport: 'stdio', command: 'node' }]),
    /invalid id/
  );
  assert.throws(
    () => parseExternalMcpServers([{ id: 'missing', transport: 'streamable-http' }]),
    /Invalid URL|requires/
  );
});
