import { listTools, callTool } from './server.js';

export async function handleMcpRequest(message) {
  const { method, params = {}, id = null } = message || {};

  try {
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
        result
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
        message: error.message
      }
    };
  }
}
