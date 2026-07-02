import { handleMcpRequest } from '../mcp/runtime.js';
import { callExternalTool } from '../mcp/externalClient.js';

export const AGENT_TOOL_POLICY = Object.freeze({
  parser: ['parse_resume'],
  retriever: ['search_resume_chunks'],
  critic: ['evaluate_answer'],
  writer: ['rewrite_resume']
});

function gatewayError(code, message, details = null) {
  const error = new Error(message);
  error.code = code;
  error.details = details;
  return error;
}

function withTimeout(promise, timeoutMs, toolName) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(gatewayError(
      'TOOL_TIMEOUT',
      `Tool ${toolName} exceeded timeout ${timeoutMs}ms.`
    )), timeoutMs);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

export async function invokeTool({
  agent,
  name,
  args = {},
  allowedTools = AGENT_TOOL_POLICY[agent] || [],
  timeoutMs = Number(process.env.TOOL_TIMEOUT_MS || 30_000),
  onAudit,
  requestHandler = handleMcpRequest,
  externalToolCaller = callExternalTool
}) {
  if (!allowedTools.includes(name)) {
    throw gatewayError('TOOL_FORBIDDEN', `Agent ${agent || 'unknown'} is not allowed to call ${name}.`, {
      agent,
      name,
      allowedTools
    });
  }
  const startedAt = Date.now();
  await onAudit?.({
    type: 'tool_call_start',
    agent,
    name,
    status: 'running',
    args: summarizeArgs(args)
  });
  try {
    const response = name.includes('::')
      ? { result: { structuredContent: await withTimeout(externalToolCaller(name, args), timeoutMs, name) } }
      : await withTimeout(requestHandler({
          jsonrpc: '2.0',
          id: `${agent || 'agent'}:${name}:${startedAt}`,
          method: 'tools/call',
          params: { name, arguments: args }
        }), timeoutMs, name);
    if (response?.error) {
      throw gatewayError('TOOL_CALL_FAILED', response.error.message, {
        mcpCode: response.error.code,
        data: response.error.data || null
      });
    }
    const result = response?.result?.structuredContent ?? null;
    await onAudit?.({
      type: 'tool_call_success',
      agent,
      name,
      status: 'succeeded',
      latencyMs: Date.now() - startedAt,
      result: summarizeResult(result)
    });
    return result;
  } catch (error) {
    await onAudit?.({
      type: 'tool_call_error',
      agent,
      name,
      status: 'failed',
      latencyMs: Date.now() - startedAt,
      errorCode: error.code || 'TOOL_CALL_FAILED',
      errorMessage: error.message
    });
    throw error;
  }
}

function summarizeArgs(args) {
  return Object.fromEntries(Object.entries(args || {}).map(([key, value]) => {
    if (typeof value === 'string') return [key, value.length > 160 ? `${value.slice(0, 160)}...` : value];
    if (Array.isArray(value)) return [key, { type: 'array', length: value.length }];
    if (value && typeof value === 'object') return [key, { type: 'object', keys: Object.keys(value).slice(0, 12) }];
    return [key, value];
  }));
}

function summarizeResult(result) {
  if (Array.isArray(result)) return { type: 'array', length: result.length };
  if (result && typeof result === 'object') return { type: 'object', keys: Object.keys(result).slice(0, 16) };
  return result;
}
