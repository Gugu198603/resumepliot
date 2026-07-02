import { Router } from 'express';
import { asyncRoute, HttpError } from '../middleware/http.js';
import {
  createApplication,
  deleteApplication,
  getApplication,
  getJobDescription,
  getResumeVersion,
  getSession,
  listApplications,
  updateApplication
} from '../services/database.js';
import {
  normalizeApplicationStatus,
  validateApplicationTransition
} from '../services/applicationWorkflow.js';

export const applicationRouter = Router();

function normalizeIds(value) {
  return Array.isArray(value) ? [...new Set(value.map(String).map((item) => item.trim()).filter(Boolean))] : [];
}

function normalizeDate(value, field) {
  if (value === undefined || value === null || value === '') return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw new HttpError(400, 'INVALID_DATE', `${field} 不是有效日期。`);
  return date.toISOString();
}

async function validateReferences({ jobId, resumeVersionId, sessionIds = [] }) {
  const job = await getJobDescription(jobId);
  if (!job) throw new HttpError(404, 'JOB_NOT_FOUND', 'Job not found');
  if (resumeVersionId && !(await getResumeVersion(resumeVersionId))) {
    throw new HttpError(404, 'RESUME_VERSION_NOT_FOUND', 'Resume version not found');
  }
  const sessions = await Promise.all(sessionIds.map((id) => getSession(id)));
  if (sessions.some((session) => !session)) {
    throw new HttpError(404, 'SESSION_NOT_FOUND', 'One or more interview sessions were not found');
  }
}

applicationRouter.get('/applications', asyncRoute(async (_req, res) => {
  res.json({ applications: await listApplications() });
}));

applicationRouter.get('/application-reminders', asyncRoute(async (req, res) => {
  const dueBefore = req.query?.dueBefore ? new Date(String(req.query.dueBefore)) : new Date(Date.now() + 24 * 60 * 60 * 1000);
  if (Number.isNaN(dueBefore.getTime())) throw new HttpError(400, 'INVALID_DATE', 'dueBefore 不是有效日期。');
  const reminders = (await listApplications())
    .filter((application) => application.reminderAt && !application.reminderDone)
    .filter((application) => new Date(application.reminderAt).getTime() <= dueBefore.getTime())
    .sort((a, b) => new Date(a.reminderAt).getTime() - new Date(b.reminderAt).getTime());
  res.json({ reminders, dueBefore: dueBefore.toISOString() });
}));

applicationRouter.get('/applications/:id', asyncRoute(async (req, res) => {
  const application = await getApplication(req.params.id);
  if (!application) throw new HttpError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
  res.json({ application });
}));

applicationRouter.post('/applications', asyncRoute(async (req, res) => {
  const jobId = String(req.body?.jobId || '').trim();
  if (!jobId) throw new HttpError(400, 'JOB_ID_REQUIRED', 'jobId is required');
  const resumeVersionId = String(req.body?.resumeVersionId || '').trim() || null;
  const sessionIds = normalizeIds(req.body?.sessionIds);
  await validateReferences({ jobId, resumeVersionId, sessionIds });
  const application = await createApplication({
    jobId,
    resumeVersionId,
    sessionIds,
    status: normalizeApplicationStatus(req.body?.status),
    appliedAt: normalizeDate(req.body?.appliedAt, 'appliedAt'),
    interviewAt: normalizeDate(req.body?.interviewAt, 'interviewAt'),
    reminderAt: normalizeDate(req.body?.reminderAt, 'reminderAt'),
    reminderDone: Boolean(req.body?.reminderDone),
    nextAction: String(req.body?.nextAction || '').trim(),
    result: String(req.body?.result || '').trim(),
    notes: String(req.body?.notes || '').trim()
  });
  res.status(201).json({ application });
}));

applicationRouter.patch('/applications/:id', asyncRoute(async (req, res) => {
  const current = await getApplication(req.params.id);
  if (!current) throw new HttpError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
  const patch = {};
  if (req.body?.status !== undefined) {
    const transition = validateApplicationTransition(current.status, req.body.status);
    if (!transition.ok) throw new HttpError(409, transition.code, transition.message);
    patch.status = transition.status;
    if (transition.status === 'applied' && !current.appliedAt && req.body?.appliedAt === undefined) {
      patch.appliedAt = new Date().toISOString();
    }
  }
  if (req.body?.resumeVersionId !== undefined) {
    patch.resumeVersionId = String(req.body.resumeVersionId || '').trim() || null;
  }
  if (req.body?.sessionIds !== undefined) patch.sessionIds = normalizeIds(req.body.sessionIds);
  if (req.body?.appliedAt !== undefined) patch.appliedAt = normalizeDate(req.body.appliedAt, 'appliedAt');
  if (req.body?.interviewAt !== undefined) patch.interviewAt = normalizeDate(req.body.interviewAt, 'interviewAt');
  if (req.body?.reminderAt !== undefined) patch.reminderAt = normalizeDate(req.body.reminderAt, 'reminderAt');
  if (req.body?.reminderDone !== undefined) patch.reminderDone = Boolean(req.body.reminderDone);
  for (const field of ['nextAction', 'result', 'notes']) {
    if (req.body?.[field] !== undefined) patch[field] = String(req.body[field] || '').trim();
  }
  await validateReferences({
    jobId: current.jobId,
    resumeVersionId: patch.resumeVersionId === undefined ? current.resumeVersionId : patch.resumeVersionId,
    sessionIds: patch.sessionIds === undefined ? current.sessionIds : patch.sessionIds
  });
  res.json({ application: await updateApplication(req.params.id, patch) });
}));

applicationRouter.delete('/applications/:id', asyncRoute(async (req, res) => {
  if (!(await deleteApplication(req.params.id))) {
    throw new HttpError(404, 'APPLICATION_NOT_FOUND', 'Application not found');
  }
  res.json({ ok: true, id: req.params.id });
}));
