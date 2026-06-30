import { Router } from 'express';
import {
  getResume,
  getSession,
  saveResumeVersion,
  listResumeVersions,
  getResumeVersion
} from '../services/database.js';
import { buildCandidateProfile } from '../services/candidateProfile.js';
import { buildInterviewReport } from '../services/interviewReport.js';
import { diffResumeVersions } from '../services/resumeDiff.js';
import { createResumeDocx } from '../services/docxExport.js';
import { asyncRoute, HttpError, requireFields } from '../middleware/http.js';

export const productRouter = Router();

productRouter.get('/resumes/:id/profile', asyncRoute(async (req, res) => {
  const resume = await getResume(req.params.id);
  if (!resume) throw new HttpError(404, 'RESUME_NOT_FOUND', 'Resume not found');
  res.json({ profile: buildCandidateProfile(resume) });
}));

productRouter.get('/sessions/:id/report', asyncRoute(async (req, res) => {
  const session = await getSession(req.params.id);
  if (!session) throw new HttpError(404, 'SESSION_NOT_FOUND', 'Session not found');
  res.json({ report: buildInterviewReport(session) });
}));

productRouter.get('/resumes/:id/versions', asyncRoute(async (req, res) => {
  const resume = await getResume(req.params.id);
  if (!resume) throw new HttpError(404, 'RESUME_NOT_FOUND', 'Resume not found');
  res.json({ versions: await listResumeVersions(req.params.id) });
}));

productRouter.post('/resumes/:id/versions', requireFields(['content']), asyncRoute(async (req, res) => {
  const resume = await getResume(req.params.id);
  if (!resume) throw new HttpError(404, 'RESUME_NOT_FOUND', 'Resume not found');
  if (typeof req.body.content !== 'object' || Array.isArray(req.body.content)) {
    throw new HttpError(400, 'VALIDATION_ERROR', 'content 必须是对象。');
  }
  const version = await saveResumeVersion({
    resumeId: resume.id,
    jobId: req.body.jobId || null,
    label: req.body.label || null,
    content: req.body.content,
    candidateProfile: buildCandidateProfile(resume),
    matchScore: req.body.matchScore
  });
  res.status(201).json({ version });
}));

productRouter.get('/resume-versions/:id/diff', asyncRoute(async (req, res) => {
  const current = await getResumeVersion(req.params.id);
  if (!current) throw new HttpError(404, 'VERSION_NOT_FOUND', 'Resume version not found');
  const base = req.query.baseId ? await getResumeVersion(String(req.query.baseId)) : null;
  const resume = await getResume(current.resumeId);
  const before = base?.content || { originalText: resume?.text || '' };
  res.json({ current, base, diff: diffResumeVersions(before, current.content) });
}));

productRouter.get('/resume-versions/:id/export.docx', asyncRoute(async (req, res) => {
  const version = await getResumeVersion(req.params.id);
  if (!version) throw new HttpError(404, 'VERSION_NOT_FOUND', 'Resume version not found');
  res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document');
  res.setHeader('Content-Disposition', `attachment; filename="resume-v${version.versionNumber}.docx"`);
  res.send(createResumeDocx(version.content));
}));
