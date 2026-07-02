import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { callTool, tools } from './server.js';

const toolInputSchemas = {
  parse_resume: {
    text: z.string(),
    buildKb: z.boolean().optional()
  },
  search_resume_chunks: {
    text: z.string(),
    query: z.string(),
    topK: z.number().positive().optional(),
    resumeId: z.string().optional(),
    sessionTurns: z.array(z.record(z.unknown())).optional()
  },
  evaluate_answer: {
    question: z.string(),
    answer: z.string(),
    retrieved: z.array(z.record(z.unknown())).optional(),
    memoryContext: z.record(z.unknown()).nullable().optional()
  },
  rewrite_resume: {
    text: z.string(),
    answer: z.string().optional(),
    feedback: z.array(z.string()).optional(),
    memoryContext: z.record(z.unknown()).nullable().optional()
  }
};

export function createResumePilotMcpServer() {
  const server = new McpServer({
    name: 'resumepilot-mcp',
    version: '0.3.0'
  });

  for (const tool of tools) {
    server.registerTool(tool.name, {
      description: tool.description,
      inputSchema: toolInputSchemas[tool.name],
      annotations: {
        readOnlyHint: tool.name !== 'rewrite_resume',
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false
      }
    }, async (args) => {
      const result = await callTool(tool.name, args);
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        structuredContent: result
      };
    });
  }

  return server;
}
