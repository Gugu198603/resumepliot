import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

const connections = new Map();

export function parseExternalMcpServers(raw = process.env.MCP_EXTERNAL_SERVERS || '[]') {
  let configs;
  try {
    configs = typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch (error) {
    throw new Error(`MCP_EXTERNAL_SERVERS must be valid JSON: ${error.message}`);
  }
  if (!Array.isArray(configs)) throw new Error('MCP_EXTERNAL_SERVERS must be a JSON array.');
  const ids = new Set();
  return configs.map((config, index) => {
    const id = String(config?.id || '').trim();
    const transport = String(config?.transport || '').trim();
    if (!id || !/^[a-zA-Z0-9_-]+$/.test(id)) throw new Error(`External MCP server at index ${index} has an invalid id.`);
    if (ids.has(id)) throw new Error(`Duplicate external MCP server id: ${id}`);
    ids.add(id);
    if (!['stdio', 'streamable-http'].includes(transport)) {
      throw new Error(`External MCP server ${id} has unsupported transport: ${transport}`);
    }
    if (transport === 'stdio' && !String(config.command || '').trim()) {
      throw new Error(`External MCP stdio server ${id} requires command.`);
    }
    if (transport === 'streamable-http') {
      const url = new URL(config.url);
      if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`External MCP server ${id} requires an HTTP(S) URL.`);
    }
    return {
      id,
      transport,
      command: config.command,
      args: Array.isArray(config.args) ? config.args.map(String) : [],
      cwd: config.cwd || undefined,
      env: config.env && typeof config.env === 'object' ? config.env : {},
      url: config.url || null,
      headers: config.headers && typeof config.headers === 'object' ? config.headers : {}
    };
  });
}

function createTransport(config) {
  if (config.transport === 'stdio') {
    return new StdioClientTransport({
      command: config.command,
      args: config.args,
      cwd: config.cwd,
      env: { ...process.env, ...config.env },
      stderr: 'pipe'
    });
  }
  return new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: config.headers }
  });
}

export async function connectExternalMcpServer(config) {
  const cached = connections.get(config.id);
  if (cached) return cached;
  const client = new Client({ name: 'resumepilot-gateway', version: '0.3.0' });
  const transport = createTransport(config);
  try {
    await client.connect(transport);
  } catch (error) {
    await transport.close?.().catch?.(() => {});
    throw error;
  }
  const connection = { config, client, transport };
  connections.set(config.id, connection);
  return connection;
}

export async function listExternalTools(configs = parseExternalMcpServers()) {
  const results = [];
  for (const config of configs) {
    const { client } = await connectExternalMcpServer(config);
    const response = await client.listTools();
    results.push(...response.tools.map((tool) => ({
      ...tool,
      name: `${config.id}::${tool.name}`,
      serverId: config.id,
      remoteName: tool.name
    })));
  }
  return results;
}

export async function callExternalTool(qualifiedName, args = {}, configs = parseExternalMcpServers()) {
  const separator = qualifiedName.indexOf('::');
  if (separator < 1) throw new Error(`External MCP tool must be qualified as serverId::toolName: ${qualifiedName}`);
  const serverId = qualifiedName.slice(0, separator);
  const toolName = qualifiedName.slice(separator + 2);
  const config = configs.find((item) => item.id === serverId);
  if (!config) throw new Error(`External MCP server is not configured: ${serverId}`);
  const { client } = await connectExternalMcpServer(config);
  const result = await client.callTool({ name: toolName, arguments: args });
  if (result.isError) {
    const message = result.content?.find((item) => item.type === 'text')?.text || `External MCP tool failed: ${qualifiedName}`;
    throw new Error(message);
  }
  if (result.structuredContent !== undefined) return result.structuredContent;
  const text = result.content?.find((item) => item.type === 'text')?.text;
  if (!text) return result.content || null;
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export async function closeExternalMcpConnections() {
  const active = [...connections.values()];
  connections.clear();
  await Promise.allSettled(active.map(({ client }) => client.close()));
}
