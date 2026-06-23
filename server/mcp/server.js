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

export async function callTool(name, args) {
  const tool = tools.find((item) => item.name === name);
  if (!tool) {
    throw new Error(`Unknown MCP tool: ${name}`);
  }
  return await tool.handler(args || {});
}
