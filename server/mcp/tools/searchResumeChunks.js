import { retrieveContext } from '../../agents/retriever.js';

export const searchResumeChunksTool = {
  name: 'search_resume_chunks',
  description: 'Search the most relevant resume chunks for a given query using the configured vector provider.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Resume text content.' },
      query: { type: 'string', description: 'Search query.' },
      topK: { type: 'number', description: 'Number of chunks to return.' },
      resumeId: { type: 'string', description: 'Optional persisted resume id.' },
      sessionTurns: { type: 'array', description: 'Optional prior interview turns.', items: { type: 'object' } }
    },
    required: ['text', 'query']
  },
  async handler({ text, query, topK = 3, resumeId = null, sessionTurns = [] }) {
    const result = await retrieveContext({ text, query, topK, resumeId, sessionTurns });
    return {
      query: result.query,
      topK: result.topK,
      retrieved: result.retrieved,
      resumeResults: result.resumeResults,
      historyResults: result.historyResults,
      resumeId: result.resumeId,
      kbSource: result.kbSource
    };
  }
};
