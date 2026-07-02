import { rewriteArtifacts } from '../../agents/writer.js';

export const rewriteResumeTool = {
  name: 'rewrite_resume',
  description: 'Rewrite resume text into concise/detailed forms and optionally improve an interview answer.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Resume text content.' },
      answer: { type: 'string', description: 'Optional interview answer to improve.' },
      feedback: {
        type: 'array',
        items: { type: 'string' },
        description: 'Optional critique feedback.'
      },
      memoryContext: { type: 'object', description: 'Optional retrieved long-term memory context.' }
    },
    required: ['text']
  },
  async handler({ text, answer = '', feedback = [], memoryContext = null }) {
    return await rewriteArtifacts({ text, answer, feedback, memoryContext });
  }
};
