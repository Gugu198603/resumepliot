import { normalizeText, splitSections, detectRisks } from '../../services/resumeParser.js';
import { buildKnowledgeBase } from '../../services/vectorStore.js';

export const parseResumeTool = {
  name: 'parse_resume',
  description: 'Parse arbitrary resume text into sections, risks, and retrieval-ready knowledge chunks.',
  inputSchema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'Resume text content.' },
      buildKb: { type: 'boolean', description: 'Whether to build retrieval chunks during parsing.' }
    },
    required: ['text']
  },
  async handler({ text, buildKb = true }) {
    const normalized = normalizeText(text || '');
    const sections = splitSections(normalized);
    const risks = detectRisks(normalized);
    const kb = buildKb ? await buildKnowledgeBase(normalized) : [];
    return {
      text: normalized,
      sections,
      risks,
      kbSize: kb.length,
      chunks: kb.map(({ id, content }) => ({ id, content }))
    };
  }
};
