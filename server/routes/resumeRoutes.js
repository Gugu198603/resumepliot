import { Router } from 'express';
import { deleteResume, getResume, listResumes, updateResume } from '../services/database.js';
import { asyncRoute, HttpError } from '../middleware/http.js';

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
  router.patch('/resumes/:id', asyncRoute(async (req, res) => {
    const resume = await updateResume(req.params.id, { title: req.body?.title });
    if (!resume) throw new HttpError(404, 'RESUME_NOT_FOUND', 'Resume not found');
    res.json({ resume });
  }));
  router.delete('/resumes/:id', asyncRoute(async (req, res) => {
    const removed = await deleteResume(req.params.id);
    if (!removed) throw new HttpError(404, 'RESUME_NOT_FOUND', 'Resume not found');
    res.json({ ok: true, id: req.params.id });
  }));
  return router;
}
