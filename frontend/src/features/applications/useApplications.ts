import { useState } from 'react';
import { resumePilotApi } from '../../services/resumePilotApi';
import type { Application, ApplicationStatus } from '../../types/domain';

export function useApplications(setLoading: (message: string | null) => void) {
  const [applications, setApplications] = useState<Application[]>([]);

  async function load() {
    setApplications(await resumePilotApi.listApplications());
  }

  async function create(input: {
    jobId: string;
    resumeVersionId?: string | null;
    sessionIds?: string[];
    nextAction?: string;
    notes?: string;
    interviewAt?: string | null;
    reminderAt?: string | null;
    reminderDone?: boolean;
    result?: string;
  }) {
    setLoading('正在创建求职申请...');
    try {
      const application = await resumePilotApi.createApplication(input);
      setApplications((current) => [application, ...current]);
      return application;
    } finally {
      setLoading(null);
    }
  }

  async function update(id: string, patch: {
    status?: ApplicationStatus;
    resumeVersionId?: string | null;
    sessionIds?: string[];
    nextAction?: string;
    notes?: string;
  }) {
    const application = await resumePilotApi.updateApplication(id, patch);
    setApplications((current) => current.map((item) => item.id === id ? application : item));
  }

  async function remove(id: string) {
    await resumePilotApi.deleteApplication(id);
    setApplications((current) => current.filter((item) => item.id !== id));
  }

  return { applications, load, create, update, remove };
}
