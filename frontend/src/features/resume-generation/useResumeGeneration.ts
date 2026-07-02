import { useEffect, useMemo, useState } from 'react';
import { resumePilotApi } from '../../services/resumePilotApi';
import type { JdMatchResult, JobDescription, ResumeGenerationPreview, ResumeVersion } from '../../types/domain';
import type { PreviewDensity } from './GeneratedResume';
import { openResumePrintWindow, printResumeElement } from './printResume';

interface UseResumeGenerationOptions {
  initialAdjustment?: string;
  resumeId: string | null;
  selectedJobId: string;
  jdText: string;
  jdResult: JdMatchResult | null;
  jobs: JobDescription[];
  setLoading: (message: string | null) => void;
  showGenerated: () => void;
}

export function useResumeGeneration({
  initialAdjustment = '',
  resumeId,
  selectedJobId,
  jdText,
  jdResult,
  jobs,
  setLoading,
  showGenerated
}: UseResumeGenerationOptions) {
  const [adjustment, setAdjustment] = useState(initialAdjustment);
  const [preview, setPreview] = useState<ResumeGenerationPreview | null>(null);
  const [versions, setVersions] = useState<ResumeVersion[]>([]);
  const [savedSnapshot, setSavedSnapshot] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState('');
  const [exportingFormat, setExportingFormat] = useState<'pdf' | 'docx' | null>(null);
  const [density, setDensity] = useState<PreviewDensity>('compact');
  const currentSnapshot = useMemo(
    () => preview?.resume ? JSON.stringify(preview.resume) : null,
    [preview?.resume]
  );
  const hasUnsavedChanges = Boolean(currentSnapshot && currentSnapshot !== savedSnapshot);

  useEffect(() => {
    let cancelled = false;
    if (!resumeId) {
      setVersions([]);
      return;
    }
    resumePilotApi.listResumeVersions(resumeId).then((items) => {
      if (!cancelled) setVersions(items);
    });
    return () => {
      cancelled = true;
    };
  }, [resumeId]);

  function exportPayload(label: string) {
    return {
      content: preview?.resume,
      adjustment,
      jobId: selectedJobId || null,
      matchScore: jdResult?.matchScore ?? null,
      label
    };
  }

  function updateValidation(data: Record<string, any>, ok: boolean) {
    setPreview((current) => current ? {
      ...current,
      ok,
      profile_validation: data.profile_validation || data.validation?.profile_validation || current.profile_validation,
      resume_validation: data.resume_validation || data.validation?.resume_validation || current.resume_validation
    } : current);
  }

  async function generate() {
    if (!resumeId) return;
    setLoading('正在生成简历预览...');
    try {
      const response = await fetch(`/api/resumes/${resumeId}/generation-preview`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          adjustment,
          ...(selectedJobId ? { jobId: selectedJobId } : jdText.trim() ? { jdText } : {})
        })
      });
      setPreview(await response.json());
      setSavedSnapshot(null);
      setExportNotice('');
      showGenerated();
    } finally {
      setLoading(null);
    }
  }

  function updateResume(resume: Record<string, unknown>) {
    setPreview((current) => current ? { ...current, resume } : current);
  }

  async function saveVersion() {
    if (!resumeId || !preview?.resume) return;
    setLoading('正在保存简历版本...');
    setExportNotice('');
    try {
      const label = selectedJobId
        ? `岗位定向版 · ${jobs.find((job) => job.id === selectedJobId)?.title || '目标岗位'}`
        : undefined;
      const response = await fetch(`/api/resumes/${resumeId}/versions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...exportPayload(label || ''), label })
      });
      const data = await response.json();
      if (data.version) {
        setVersions((current) => [data.version, ...current]);
        setSavedSnapshot(JSON.stringify(preview.resume));
        updateValidation(data, true);
        setExportNotice(`已保存为版本 v${data.version.versionNumber}。`);
      } else {
        updateValidation(data, false);
        setExportNotice(data.error || '保存失败，请处理事实校验问题。');
      }
    } finally {
      setLoading(null);
    }
  }

  async function exportPdf() {
    if (!resumeId || !preview?.resume) return;
    setExportingFormat('pdf');
    setExportNotice('');
    const printWindow = openResumePrintWindow();
    if (!printWindow) {
      setExportNotice('浏览器拦截了 PDF 预览窗口，请允许本站打开弹窗后重试。');
      setExportingFormat(null);
      return;
    }
    try {
      const label = selectedJobId
        ? `PDF 导出 · ${jobs.find((job) => job.id === selectedJobId)?.title || '目标岗位'}`
        : 'PDF 导出快照';
      const response = await fetch(`/api/resumes/${resumeId}/exports/validate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...exportPayload(label), saveSnapshot: true })
      });
      const validation = await response.json();
      if (!response.ok || !validation.ok) {
        printWindow.close();
        updateValidation(validation, false);
        setExportNotice(validation.error || '当前编辑内容未通过事实校验，暂不能导出 PDF。');
        return;
      }
      if (validation.version) {
        setVersions((current) => [validation.version, ...current]);
        setSavedSnapshot(JSON.stringify(preview.resume));
      }
      updateValidation(validation, true);
      const resumeNode = document.querySelector('.generated-resume-card');
      if (!resumeNode) {
        printWindow.close();
        setExportNotice('没有找到可导出的简历预览。');
        return;
      }
      await printResumeElement(printWindow, resumeNode);
      setExportNotice('PDF 预览已打开，打印面板中选择“另存为 PDF”。');
    } catch (error) {
      printWindow.close();
      setExportNotice(error instanceof Error ? error.message : 'PDF 导出失败。');
    } finally {
      setExportingFormat(null);
    }
  }

  async function exportDocx() {
    if (!resumeId || !preview?.resume) return;
    setExportingFormat('docx');
    setExportNotice('');
    try {
      const label = selectedJobId
        ? `岗位定向导出 · ${jobs.find((job) => job.id === selectedJobId)?.title || '目标岗位'}`
        : '导出快照';
      const response = await fetch(`/api/resumes/${resumeId}/exports/docx`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(exportPayload(label))
      });
      if (!response.ok) {
        const data = await response.json();
        updateValidation(data, false);
        setExportNotice(data.error || 'DOCX 导出失败。');
        return;
      }
      const disposition = response.headers.get('content-disposition') || '';
      const encodedName = disposition.match(/filename\*=UTF-8''([^;]+)/i)?.[1];
      const filename = encodedName ? decodeURIComponent(encodedName) : 'resume.docx';
      const blobUrl = URL.createObjectURL(await response.blob());
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = filename;
      link.click();
      window.setTimeout(() => URL.revokeObjectURL(blobUrl), 1000);
      setSavedSnapshot(JSON.stringify(preview.resume));
      setPreview((current) => current ? {
        ...current,
        ok: true,
        profile_validation: { ok: true, issues: [] },
        resume_validation: { ok: true, issues: [] }
      } : current);
      setExportNotice('DOCX 已按当前编辑内容导出，并保存了同内容版本快照。');
    } catch (error) {
      setExportNotice(error instanceof Error ? error.message : 'DOCX 导出失败。');
    } finally {
      setExportingFormat(null);
    }
  }

  return {
    adjustment,
    setAdjustment,
    preview,
    versions,
    exportNotice,
    exportingFormat,
    density,
    setDensity,
    hasUnsavedChanges,
    generate,
    updateResume,
    saveVersion,
    exportPdf,
    exportDocx
  };
}
