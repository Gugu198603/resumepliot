import { createHash } from 'crypto';
import { Router } from 'express';
import multer from 'multer';
import pdfParse from 'pdf-parse';
import { buildResumeComparison } from '../agents/resumeComparer.js';
import { matchJobDescription } from '../agents/jdMatcher.js';
import { rewriteArtifacts } from '../agents/writer.js';
import {
  getJobDescription,
  getResume,
  listResumes,
  saveResumeCorrectionEvent,
  saveResumeRecord,
  updateResume
} from '../services/database.js';
import { makeId } from '../services/idFactory.js';
import { logger } from '../services/logger.js';
import { generateResumePreview } from '../services/resumeGeneration.js';
import { detectRisks, normalizeText, rewriteResume, splitSections } from '../services/resumeParser.js';
import { buildKnowledgeBase, provider as vectorProvider } from '../services/vectorStore.js';

const router = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_RESUME_UPLOAD_BYTES || 8 * 1024 * 1024), files: 1 },
  fileFilter(_req, file, callback) {
    const allowed = new Set(['application/pdf', 'text/plain', 'text/markdown']);
    const accepted = allowed.has(file.mimetype);
    callback(accepted ? null : new Error('仅支持 PDF、TXT 或 Markdown 简历。'), accepted);
  }
});

function stripChunkForResponse(chunk) {
  const { embedding, ...safeChunk } = chunk;
  return safeChunk;
}

export function resumeFingerprint(text = '') {
  const canonical = String(text || '')
    .replace(/\s+/g, '')
    .replace(/[，。；：、,. ;:]/g, '')
    .trim()
    .toLowerCase();
  return canonical ? createHash('sha256').update(canonical).digest('hex') : '';
}

export function mergeDuplicateResumes(resumes = []) {
  const grouped = new Map();
  for (const resume of resumes) {
    const key = resumeFingerprint(resume.text || '');
    if (!key) {
      grouped.set(resume.id, { ...resume, duplicateCount: 1, duplicateIds: [resume.id] });
      continue;
    }
    const existing = grouped.get(key);
    if (!existing) {
      grouped.set(key, { ...resume, duplicateCount: 1, duplicateIds: [resume.id] });
      continue;
    }
    existing.duplicateCount += 1;
    existing.duplicateIds.push(resume.id);
  }
  return [...grouped.values()];
}

function normalizeCorrectionSections(sections = []) {
  return Array.isArray(sections)
    ? sections.map((section) => ({
        title: String(section?.title || '未命名模块').trim() || '未命名模块',
        content: Array.isArray(section?.content)
          ? section.content.map((line) => String(line || '').trim()).filter(Boolean)
          : String(section?.content || '').split('\n').map((line) => line.trim()).filter(Boolean)
      })).filter((section) => section.content.length)
    : [];
}

function sectionsToText(sections = []) {
  return sections.map((section) => [section.title, ...(section.content || [])].filter(Boolean).join('\n')).join('\n');
}

function previewText(value = '', limit = 80) {
  const text = String(value || '').replace(/\s+/g, ' ').trim();
  return text.length > limit ? `${text.slice(0, limit)}...` : text;
}

function buildCorrectionDiff(beforeSections = [], afterSections = []) {
  const max = Math.max(beforeSections.length, afterSections.length);
  return Array.from({ length: max }, (_, index) => {
    const before = beforeSections[index] || null;
    const after = afterSections[index] || null;
    return {
      index,
      beforeTitle: before?.title || null,
      afterTitle: after?.title || null,
      titleChanged: Boolean(before && after && before.title !== after.title),
      beforeLineCount: before?.content?.length || 0,
      afterLineCount: after?.content?.length || 0,
      lineDelta: (after?.content?.length || 0) - (before?.content?.length || 0),
      beforePreview: previewText((before?.content || [])[0] || ''),
      afterPreview: previewText((after?.content || [])[0] || ''),
      changeKind: before && after ? 'updated' : before ? 'removed' : 'added'
    };
  });
}

router.post('/resumes/compare', async (req, res) => {
  try {
    const ids = Array.isArray(req.body?.ids) ? req.body.ids.filter(Boolean) : [];
    if (ids.length < 2) return res.status(400).json({ error: 'At least two resume ids are required.' });
    const resumes = (await Promise.all(ids.map((id) => getResume(id)))).filter(Boolean);
    if (resumes.length < 2) return res.status(404).json({ error: 'Could not load at least two resumes.' });
    const comparison = buildResumeComparison(resumes);
    let jdContent = req.body?.jdText || '';
    let job = null;
    if (req.body?.jobId) {
      job = await getJobDescription(req.body.jobId);
      if (job) jdContent = job.text || '';
    }
    const jobMatchScores = jdContent.trim()
      ? await Promise.all(resumes.map(async (resume) => {
          const result = await matchJobDescription({
            resumeText: resume.text || '',
            resumeChunks: resume.chunks || [],
            jdText: jdContent
          });
          return { id: resume.id, matchScore: result.matchScore, mode: result.mode };
        }))
      : null;
    return res.json({ ...comparison, jobMatchScores, jobId: job?.id || null });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

router.post('/resumes/:id/corrections', async (req, res) => {
  try {
    const current = await getResume(req.params.id);
    if (!current) return res.status(404).json({ error: 'Resume not found' });
    const sections = normalizeCorrectionSections(req.body?.sections || []);
    if (!sections.length) return res.status(400).json({ error: 'sections is required' });
    const errorTypes = Array.isArray(req.body?.errorTypes) ? req.body.errorTypes : [];
    const beforeSections = current.sections || [];
    const moduleDiff = buildCorrectionDiff(beforeSections, sections);
    logger.info('resume_correction.request', {
      resumeId: current.id,
      errorTypes,
      beforeSectionCount: beforeSections.length,
      afterSectionCount: sections.length,
      moduleDiff
    });
    const text = typeof req.body?.text === 'string' && req.body.text.trim()
      ? normalizeText(req.body.text)
      : sectionsToText(sections);
    const risks = detectRisks(text);
    const kb = await buildKnowledgeBase(text, current.id);
    const chunks = kb.map((chunk) => ({ ...chunk, resumeId: current.id }));
    const correction = await saveResumeCorrectionEvent({
      resumeId: current.id,
      beforeSections,
      afterSections: sections,
      errorTypes
    });
    const resume = await updateResume(current.id, {
      text,
      sections,
      risks,
      kbSize: kb.length,
      chunks,
      vectorProvider
    });
    logger.info('resume_correction.saved', {
      resumeId: current.id,
      correctionId: correction.id,
      summary: correction.summary,
      rebuiltKbSize: kb.length
    });
    return res.json({ resume, correction });
  } catch (error) {
    logger.error('resume_correction.error', { resumeId: req.params.id, error: error.message });
    return res.status(500).json({ error: error.message });
  }
});

router.post('/resumes/:id/generation-preview', async (req, res) => {
  try {
    const resume = await getResume(req.params.id);
    if (!resume) return res.status(404).json({ error: 'Resume not found' });
    const adjustment = String(req.body?.adjustment || '').trim();
    let jobDescription = String(req.body?.jdText || req.body?.jobDescription || '').trim();
    if (req.body?.jobId && !jobDescription) {
      const job = await getJobDescription(req.body.jobId);
      if (!job) return res.status(404).json({ error: 'Job not found' });
      jobDescription = job.text || '';
    }
    const result = await generateResumePreview({ resume, adjustment, jobDescription });
    return res.status(result.ok ? 200 : 422).json({
      resumeId: resume.id,
      adjustment,
      jobOptimizationAvailable: Boolean(jobDescription),
      ...result
    });
  } catch (error) {
    logger.error('resume_generation_preview.error', { resumeId: req.params.id, error: error.message });
    return res.status(500).json({ error: error.message });
  }
});

router.post('/parse', upload.single('resume'), async (req, res) => {
  try {
    let text = req.body.text || '';
    if (req.file) {
      text = req.file.mimetype.includes('pdf')
        ? (await pdfParse(req.file.buffer)).text || text
        : req.file.buffer.toString('utf8');
    }
    text = normalizeText(text);
    const fingerprint = resumeFingerprint(text);
    const duplicate = fingerprint
      ? (await listResumes()).find((resume) => resumeFingerprint(resume.text || '') === fingerprint)
      : null;
    if (duplicate) {
      const sections = splitSections(text);
      const risks = detectRisks(text);
      const parsedChanged = JSON.stringify(duplicate.sections || []) !== JSON.stringify(sections);
      const resume = parsedChanged ? await updateResume(duplicate.id, { sections, risks }) : duplicate;
      return res.json({
        resumeId: resume.id,
        text: resume.text || '',
        sections: resume.sections || [],
        risks: resume.risks || [],
        kbSize: resume.kbSize || 0,
        chunks: (resume.chunks || []).map(stripChunkForResponse),
        vectorProvider: resume.vectorProvider || vectorProvider,
        duplicateOf: resume.id,
        reusedExisting: true
      });
    }
    const sections = splitSections(text);
    const risks = detectRisks(text);
    const resumeId = makeId('resume');
    const kb = await buildKnowledgeBase(text, resumeId);
    const chunks = kb.map((chunk) => ({ ...chunk, resumeId }));
    const record = await saveResumeRecord({
      id: resumeId,
      text,
      sections,
      risks,
      kbSize: kb.length,
      chunks,
      vectorProvider
    });
    return res.json({
      resumeId: record.id,
      text,
      sections,
      risks,
      kbSize: kb.length,
      chunks: chunks.map(stripChunkForResponse),
      vectorProvider,
      reusedExisting: false
    });
  } catch (error) {
    logger.error('resume_parse.error', { error: error.message });
    return res.status(500).json({ error: error.message });
  }
});

router.post('/rewrite', async (req, res) => {
  try {
    const { text, answer = '', feedback = [] } = req.body;
    const base = rewriteResume(text || '');
    const enhanced = await rewriteArtifacts({ text: text || '', answer, feedback });
    return res.json({ ...base, improvedAnswer: enhanced.improvedAnswer, mode: enhanced.mode });
  } catch (error) {
    return res.status(500).json({ error: error.message });
  }
});

export const resumeAnalysisRouter = router;
