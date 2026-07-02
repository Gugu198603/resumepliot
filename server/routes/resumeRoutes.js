import { Router } from 'express';
import { deleteResume, getResume, listKnowledgeBaseVersions, listResumes, updateResume } from '../services/database.js';
import { asyncRoute, HttpError } from '../middleware/http.js';
import { deleteResumeVectorData } from '../services/knowledgeBaseVersion.js';

export function createResumeRouter({ mergeDuplicateResumes }) {
  const router = Router();

  router.get('/resumes', asyncRoute(async (_req, res) => {
    res.json({ resumes: mergeDuplicateResumes(await listResumes()) });
  }));
  router.get('/resumes/:id', asyncRoute(async (req, res) => {
    const resume = await getResume(req.params.id);
    if (!resume) throw new HttpError(404, 'RESUME_NOT_FOUND', 'Resume not found');
    res.json({ resume });
  }));
  router.get('/resumes/:id/knowledge-base-versions', asyncRoute(async (req, res) => {
    const resume = await getResume(req.params.id);
    if (!resume) throw new HttpError(404, 'RESUME_NOT_FOUND', 'Resume not found');
    res.json({
      resumeId: resume.id,
      activeVersionId: resume.knowledgeBaseVersionId || null,
      versions: await listKnowledgeBaseVersions({ resumeId: resume.id })
    });
  }));
  router.patch('/resumes/:id', asyncRoute(async (req, res) => {
    const resume = await updateResume(req.params.id, { title: req.body?.title });
    if (!resume) throw new HttpError(404, 'RESUME_NOT_FOUND', 'Resume not found');
    res.json({ resume });
  }));
  router.delete('/resumes/:id', asyncRoute(async (req, res) => {
    const existing = await getResume(req.params.id);
    if (!existing) throw new HttpError(404, 'RESUME_NOT_FOUND', 'Resume not found');
    const vectorCleanup = await deleteResumeVectorData(req.params.id);
    const removed = await deleteResume(req.params.id);
    if (!removed) throw new HttpError(404, 'RESUME_NOT_FOUND', 'Resume not found');
    res.json({ ok: true, id: req.params.id, vectorCleanup });
  }));
  return router;
}
