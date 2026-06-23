import { buildKnowledgeBase, retrieveTopK } from '../../services/vectorStore.js';

export const searchResumeChunksTool = {
  name: 'search_resume_chunks',
  description: 'Search the most relevant resume chunks for a given query using the configured vector provider.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Resume text content.' },
      query: { type: 'string', description: 'Search query.' },
      topK: { type: 'number', description: 'Number of chunks to return.' }
    },
    required: ['text', 'query']
  },
  async handler({ text, query, topK = 3 }) {
    const kb = await buildKnowledgeBase(text || '');
    const retrieved = await retrieveTopK(kb, query || '', topK);
    return { retrieved };
  }
};
