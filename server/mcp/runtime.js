import { listTools, callTool } from './server.js';

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26'];

export async function handleMcpRequest(message) {
  const { method, params = {}, id = null } = message || {};

  try {
    if (method === 'initialize') {
      const requested = params.protocolVersion;
      const protocolVersion = SUPPORTED_PROTOCOL_VERSIONS.includes(requested)
        ? requested
        : SUPPORTED_PROTOCOL_VERSIONS[0];
      return {
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion,
          capabilities: { tools: { listChanged: false } },
          serverInfo: { name: 'resumepilot-mcp', version: '0.2.0' }
        }
      };
    }
    if (method === 'notifications/initialized') return null;
    if (method === 'tools/list') {
      return {
        jsonrpc: '2.0',
        id,
        result: { tools: listTools() }
      };
    }

    if (method === 'tools/call') {
      const { name, arguments: args } = params;
      const result = await callTool(name, args || {});
      return {
        jsonrpc: '2.0',
        id,
        result: {
          content: [{ type: 'text', text: JSON.stringify(result) }],
          structuredContent: result,
          isError: false
        }
      };
    }

    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32601,
        message: `Unsupported method: ${method}`
      }
    };
  } catch (error) {
    return {
      jsonrpc: '2.0',
      id,
      error: {
        code: -32000,
        message: error.message,
        data: { code: error.code || 'MCP_TOOL_ERROR' }
      }
    };
  }
}
