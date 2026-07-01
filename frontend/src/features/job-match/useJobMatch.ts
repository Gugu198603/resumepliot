import { useState } from 'react';
import { resumePilotApi } from '../../services/resumePilotApi';
import type { JdMatchResult, JobDescription, JobMatch } from '../../types/domain';

interface UseJobMatchOptions {
  initialText?: string;
  initialUrl?: string;
  initialJobId?: string;
  resumeText: string;
  resumeId: string | null;
  setLoading: (message: string | null) => void;
}

export function useJobMatch({
  initialText = '',
  initialUrl = '',
  initialJobId = '',
  resumeText,
  resumeId,
  setLoading
}: UseJobMatchOptions) {
  const [jdText, setJdText] = useState(initialText);
  const [jdUrl, setJdUrl] = useState(initialUrl);
  const [selectedJobId, setSelectedJobId] = useState(initialJobId);
  const [result, setResult] = useState<JdMatchResult | null>(null);
  const [history, setHistory] = useState<JobMatch[]>([]);
  const [jobs, setJobs] = useState<JobDescription[]>([]);

  async function loadHistory() {
    setHistory(await resumePilotApi.listJobMatches());
  }

  async function loadJobs() {
    setJobs(await resumePilotApi.listJobs());
  }

  function pickJob(jobId: string) {
    setSelectedJobId(jobId);
    const job = jobs.find((item) => item.id === jobId);
    if (job?.text) setJdText(job.text);
  }

  function changeText(value: string) {
    setJdText(value);
    setSelectedJobId('');
  }

  async function match() {
    if ((!jdText.trim() && !selectedJobId) || !resumeText.trim()) return;
    setLoading('正在对比岗位描述...');
    try {
      const response = await fetch('/api/jd-match', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          text: resumeText,
          resumeId,
          ...(selectedJobId ? { jobId: selectedJobId } : { jdText })
        })
      });
      const data = await response.json();
      setResult(data.error ? null : data);
      await loadHistory();
    } finally {
      setLoading(null);
    }
  }

  async function fetchFromUrl() {
    if (!jdUrl.trim()) return;
    setLoading('正在抓取岗位 JD...');
    try {
      const response = await fetch('/api/jobs/fetch', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ source: 'url', config: { url: jdUrl.trim() } })
      });
      const data = await response.json();
      const job = data.jobs?.[0];
      if (job?.text) setJdText(job.text);
      if (data.errors?.length) {
        window.alert(`抓取失败：${data.errors[0].error}\n该页面可能需要 JS 渲染或有反爬，建议手动粘贴 JD。`);
      }
    } finally {
      setLoading(null);
    }
  }

  return {
    jdText,
    setJdText,
    jdUrl,
    setJdUrl,
    selectedJobId,
    result,
    history,
    jobs,
    canMatch: Boolean((jdText.trim() || selectedJobId) && resumeText.trim()),
    loadHistory,
    loadJobs,
    pickJob,
    changeText,
    match,
    fetchFromUrl
  };
}
