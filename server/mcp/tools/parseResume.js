import { normalizeText, splitSections, detectRisks } from '../../services/resumeParser.js';
import { buildKnowledgeBase } from '../../services/vectorStore.js';

export const parseResumeTool = {
  name: 'parse_resume',
  description: 'Parse arbitrary resume text into sections, risks, and retrieval-ready knowledge chunks.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Resume text content.' }
    },
    required: ['text']
  },
  async handler({ text }) {
    const normalized = normalizeText(text || '');
    const sections = splitSections(normalized);
    const risks = detectRisks(normalized);
    const kb = await buildKnowledgeBase(normalized);
    return {
      text: normalized,
      sections,
      risks,
      kbSize: kb.length,
      chunks: kb.map(({ id, content }) => ({ id, content }))
    };
  }
};
