import type {
  Application,
  ApplicationStatus,
  Dashboard,
  JobDescription,
  JobMatch,
  LlmMetrics,
  LlmReadiness,
  QdrantReadiness,
  Resume,
  Run,
  Session
} from '../types/domain';
import { getJson, sendJson } from './apiClient';

export const resumePilotApi = {
  listResumes: async () => (await getJson<{ resumes: Resume[] }>('/api/resumes')).resumes || [],
  getResume: async (id: string) => (await getJson<{ resume: Resume }>(`/api/resumes/${id}`)).resume || null,
  renameResume: (id: string, title: string) => sendJson<{ resume: Resume }>(`/api/resumes/${id}`, 'PATCH', { title }),
  deleteResume: (id: string) => sendJson<{ ok: boolean }>(`/api/resumes/${id}`, 'DELETE'),
  listRuns: async () => (await getJson<{ runs: Run[] }>('/api/runs')).runs || [],
  getRun: async (id: string) => (await getJson<{ run: Run }>(`/api/runs/${id}`)).run || null,
  listSessions: async () => (await getJson<{ sessions: Session[] }>('/api/sessions')).sessions || [],
  getSession: async (id: string) => (await getJson<{ session: Session }>(`/api/sessions/${id}`)).session || null,
  createSession: async (input: { title: string; goal: string; resumeId: string | null }) =>
    (await sendJson<{ session: Session }>('/api/sessions', 'POST', input)).session,
  listJobs: async () => (await getJson<{ jobs: JobDescription[] }>('/api/jobs')).jobs || [],
  listJobMatches: async () => (await getJson<{ matches: JobMatch[] }>('/api/job-matches')).matches || [],
  listApplications: async () => (await getJson<{ applications: Application[] }>('/api/applications')).applications || [],
  createApplication: async (input: {
    jobId: string;
    resumeVersionId?: string | null;
    sessionIds?: string[];
    status?: ApplicationStatus;
    nextAction?: string;
    notes?: string;
  }) => (await sendJson<{ application: Application }>('/api/applications', 'POST', input)).application,
  updateApplication: async (id: string, patch: Partial<Pick<Application,
    'resumeVersionId' | 'sessionIds' | 'status' | 'appliedAt' | 'interviewAt' | 'nextAction' | 'result' | 'notes'
  >>) => (await sendJson<{ application: Application }>(`/api/applications/${id}`, 'PATCH', patch)).application,
  deleteApplication: (id: string) => sendJson<{ ok: boolean }>(`/api/applications/${id}`, 'DELETE'),
  dashboard: () => getJson<Dashboard>('/api/dashboard'),
  qdrantReadiness: () => getJson<QdrantReadiness>('/api/qdrant-readiness'),
  llmReadiness: () => getJson<LlmReadiness>('/api/llm-readiness'),
  llmMetrics: () => getJson<LlmMetrics>('/api/llm-metrics')
};
