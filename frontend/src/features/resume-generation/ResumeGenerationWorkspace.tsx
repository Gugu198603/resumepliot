import type { ResumeGenerationPreview, ResumeVersion } from '../../types/domain';
import { GeneratedResumeCard, GeneratedResumeEditor } from './GeneratedResume';
import type { PreviewDensity } from './GeneratedResume';

interface ResumeGenerationWorkspaceProps {
  preview: ResumeGenerationPreview | null;
  adjustment: string;
  versions: ResumeVersion[];
  hasUnsavedChanges: boolean;
  exportNotice: string;
  exportingFormat: 'pdf' | 'docx' | null;
  density: PreviewDensity;
  canGenerate: boolean;
  onAdjustmentChange: (value: string) => void;
  onGenerate: () => void;
  onDensityChange: (density: PreviewDensity) => void;
  onResumeChange: (resume: Record<string, unknown>) => void;
  onExportPdf: () => void;
  onSaveVersion: () => void;
  onExportDocx: () => void;
}

export default function ResumeGenerationWorkspace({
  preview,
  adjustment,
  versions,
  hasUnsavedChanges,
  exportNotice,
  exportingFormat,
  density,
  canGenerate,
  onAdjustmentChange,
  onGenerate,
  onDensityChange,
  onResumeChange,
  onExportPdf,
  onSaveVersion,
  onExportDocx
}: ResumeGenerationWorkspaceProps) {
  const issues = [
    ...(preview?.profile_validation?.issues || []),
    ...(preview?.resume_validation?.issues || [])
  ];
  return (
    <div className="display-section">
      <div className="generation-panel">
        <div className="generation-control">
          <div>
            <h4>简历生成预览</h4>
            <p className="muted">先生成预览，不覆盖原简历；调整要求会作为用户确认上下文参与事实校验。</p>
          </div>
          <button onClick={onGenerate} disabled={!canGenerate}>生成预览</button>
        </div>
        <textarea
          className="generation-adjustment"
          value={adjustment}
          onChange={(event) => onAdjustmentChange(event.target.value)}
          placeholder="输入调整要求，例如：目标岗位：高级前端工程师。突出 React、TypeScript、性能优化，不新增未确认指标。"
        />
        {preview ? (
          <div className="generation-result">
            <div className="generation-status-row">
              <span className={hasUnsavedChanges ? 'chip' : preview.ok ? 'chip ok' : 'chip danger'}>
                {hasUnsavedChanges ? '当前修改待校验' : preview.ok ? '事实校验通过' : '预览被拦截'}
              </span>
              <span className="muted">
                {hasUnsavedChanges
                  ? '保存或导出时会重新校验当前内容'
                  : `资料校验：${preview.profile_validation?.ok ? '通过' : '需处理'} · 简历校验：${preview.resume_validation?.ok ? '通过' : '需处理'}`}
                {versions.length ? ` · 已保存 ${versions.length} 个版本` : ''}
              </span>
            </div>
            {preview.resume ? (
              <div className="pdf-preview-shell">
                <div className="pdf-preview-head">
                  <div>
                    <strong>编辑生成结果</strong>
                    <span>Skill 生成结构化 resume.json，这里渲染为紧凑 ATS 简历。</span>
                  </div>
                  <div className="pdf-preview-actions">
                    <select value={density} onChange={(event) => onDensityChange(event.target.value as PreviewDensity)}>
                      <option value="standard">标准</option>
                      <option value="compact">紧凑</option>
                      <option value="dense">压缩</option>
                    </select>
                    <button className="secondary-button" onClick={onExportPdf} disabled={Boolean(exportingFormat)}>
                      {exportingFormat === 'pdf' ? '正在校验…' : '导出 PDF'}
                    </button>
                    <button className="secondary-button" onClick={onSaveVersion} disabled={Boolean(exportingFormat)}>保存版本</button>
                    <button onClick={onExportDocx} disabled={Boolean(exportingFormat)}>
                      {exportingFormat === 'docx' ? '正在生成…' : '导出 DOCX'}
                    </button>
                  </div>
                </div>
                {exportNotice ? (
                  <p className={/(失败|未通过|拦截|没有找到)/.test(exportNotice) ? 'export-notice error' : 'export-notice'}>
                    {exportNotice}
                  </p>
                ) : null}
                <div className="generated-workspace">
                  <div className="generated-edit-pane">
                    <div className="pane-title">
                      <strong>内容编辑</strong>
                      <span>用于微调生成结果，不会覆盖原始简历。</span>
                    </div>
                    <GeneratedResumeEditor resume={preview.resume} onChange={onResumeChange} />
                  </div>
                  <div className="generated-preview-pane">
                    <div className="pane-title">
                      <strong>PDF 预览</strong>
                      <span>真实分页以浏览器 PDF 预览为准。</span>
                    </div>
                    <GeneratedResumeCard resume={preview.resume} density={density} />
                  </div>
                </div>
              </div>
            ) : null}
            {issues.length ? (
              <div className="validation-list">
                <h5>需要处理的事实问题</h5>
                {issues.map((issue, index) => (
                  <div className="validation-item" key={index}>
                    <strong>{issue.code} · {issue.path}</strong>
                    <p>{issue.message}</p>
                    {issue.value ? <p className="muted">{issue.value}</p> : null}
                    {issue.unsupported_tokens?.length ? <p className="muted">未支持事实：{issue.unsupported_tokens.join('、')}</p> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ) : <p className="empty">点击“生成预览”后，这里会展示 JSON Resume 和事实校验结果。</p>}
      </div>
    </div>
  );
}
