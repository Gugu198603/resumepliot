import { critiqueAnswer } from '../../agents/critic.js';

export const evaluateAnswerTool = {
  name: 'evaluate_answer',
  description: 'Evaluate an interview answer against a question and retrieved resume chunks.',
  inputSchema: {
    type: 'object',
    properties: {
      question: { type: 'string', description: 'Interview question.' },
      answer: { type: 'string', description: 'Candidate answer.' },
      retrieved: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            id: { type: 'number' },
            content: { type: 'string' },
            score: { type: 'number' }
          },
          required: ['content']
        }
      }
    },
    required: ['question', 'answer']
  },
  async handler({ question, answer, retrieved = [] }) {
    return await critiqueAnswer({ question, answer, retrieved });
  }
};
