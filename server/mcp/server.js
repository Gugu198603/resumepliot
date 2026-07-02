import { parseResumeTool } from './tools/parseResume.js';
import { searchResumeChunksTool } from './tools/searchResumeChunks.js';
import { evaluateAnswerTool } from './tools/evaluateAnswer.js';
import { rewriteResumeTool } from './tools/rewriteResume.js';

export const tools = [
  parseResumeTool,
  searchResumeChunksTool,
  evaluateAnswerTool,
  rewriteResumeTool
];

export function listTools() {
  return tools.map(({ name, description, inputSchema }) => ({ name, description, inputSchema }));
}

function validateValue(value, schema, path = 'arguments') {
  if (!schema) return;
  if (schema.type === 'object' && (value === null || typeof value !== 'object' || Array.isArray(value))) {
    throw new Error(`${path} must be an object.`);
  }
  if (schema.type === 'array' && !Array.isArray(value)) throw new Error(`${path} must be an array.`);
  if (schema.type === 'string' && typeof value !== 'string') throw new Error(`${path} must be a string.`);
  if (schema.type === 'number' && !Number.isFinite(value)) throw new Error(`${path} must be a number.`);
  if (schema.type === 'boolean' && typeof value !== 'boolean') throw new Error(`${path} must be a boolean.`);
  if (schema.type === 'object') {
    for (const key of schema.required || []) {
      if (value?.[key] === undefined || value?.[key] === null || value?.[key] === '') {
        throw new Error(`${path}.${key} is required.`);
      }
    }
    for (const [key, childSchema] of Object.entries(schema.properties || {})) {
      if (value?.[key] !== undefined) validateValue(value[key], childSchema, `${path}.${key}`);
    }
  }
}

export async function callTool(name, args) {
  const tool = tools.find((item) => item.name === name);
  if (!tool) {
    throw new Error(`Unknown MCP tool: ${name}`);
  }
  validateValue(args || {}, tool.inputSchema);
  return await tool.handler(args || {});
}
