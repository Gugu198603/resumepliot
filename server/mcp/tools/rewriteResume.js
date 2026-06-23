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
      }
    },
    required: ['text']
  },
  async handler({ text, answer = '', feedback = [] }) {
    return await rewriteArtifacts({ text, answer, feedback });
  }
};
