import { useEffect, useState } from 'react';
import type { Resume, Risk, Section } from '../types/domain';
import { buildSectionBlocks } from '../utils/sectionBlocks';

const ERROR_TYPE_OPTIONS = [
  { value: 'section_title_wrong', label: '模块标题错误' },
  { value: 'content_split_wrong', label: '段落切分错误' },
  { value: 'content_missing', label: '内容缺失' },
  { value: 'noise_text', label: '噪声文本' }
];

function cloneSections(sections: Section[] = []) {
  return sections.map((section) => ({ title: section.title || '', content: [...(section.content || [])] }));
}

export default function ResumeDetailPanel({ resume, onCorrectionSaved }: { resume: Resume | null; onCorrectionSaved?: (resume: Resume) => void }) {
  const [editing, setEditing] = useState(false);
  const [draftSections, setDraftSections] = useState<Section[]>([]);
  const [errorTypes, setErrorTypes] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDraftSections(cloneSections(resume?.sections || []));
    setErrorTypes([]);
    setEditing(false);
  }, [resume?.id]);

  if (!resume) return <p className="empty">点击左侧某条简历查看详情。</p>;

  const riskCount = Array.isArray(resume.risks) ? resume.risks.length : 0;
  const sectionCount = Array.isArray(resume.sections) ? resume.sections.length : 0;

  function updateSection(index: number, patch: Partial<Section>) {
    setDraftSections((prev) => prev.map((section, idx) => idx === index ? { ...section, ...patch } : section));
  }

  function toggleErrorType(type: string) {
    setErrorTypes((prev) => prev.includes(type) ? prev.filter((item) => item !== type) : [...prev, type]);
  }

  async function saveCorrection() {
    setSaving(true);
    const res = await fetch(`/api/resumes/${resume.id}/corrections`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sections: draftSections, errorTypes })
    });
    const data = await res.json();
    setSaving(false);
    if (data.resume) {
      onCorrectionSaved?.(data.resume);
      setEditing(false);
    } else {
      alert(data.error || '保存纠偏失败');
    }
  }

  return (
    <div className="detail-stack">
      <div className="detail-header">
        <h3>简历详情</h3>
        <p>{resume.createdAt}</p>
        <button className="secondary-button correction-entry" onClick={() => { setDraftSections(cloneSections(resume.sections || [])); setEditing(true); }}>编辑解析结果</button>
      </div>
      <div className="detail-grid two-col">
        <div className="detail-card"><span>ID</span><strong>{resume.id}</strong></div>
        <div className="detail-card"><span>识别模块</span><strong>{sectionCount}</strong></div>
        <div className="detail-card"><span>风险提示</span><strong>{riskCount}</strong></div>
        <div className="detail-card"><span>诊断分块</span><strong>{resume.kbSize || '-'}</strong></div>
      </div>
      <div className="detail-block">
        <h4>风险提示</h4>
        {riskCount ? (
          <div className="chip-wrap">
            {(resume.risks || []).map((risk: Risk) => <span key={risk.term} className="chip danger">{risk.term}</span>)}
          </div>
        ) : <p className="empty">暂无风险术语。</p>}
      </div>
      <div className="detail-block scroll-block">
        <h4>识别模块</h4>
        <div className="section-list compact">
          {(resume.sections || []).map((section: Section) => (
            <div className="section-item" key={section.title}>
              <h5>{section.title}</h5>
              <div className="section-content">{buildSectionBlocks(section.content || []).map((block, idx: number) => <p className={`section-block ${block.kind}`} key={idx}>{block.text}</p>)}</div>
            </div>
          ))}
        </div>
      </div>
      {editing && (
        <div className="correction-modal">
          <div className="correction-panel">
            <div className="correction-head">
              <div>
                <h3>修正解析结果</h3>
                <p>用于修正当前简历的解析模块。保存后会记录一次人工纠偏事件，并重建检索分块。</p>
              </div>
              <button className="icon-button" onClick={() => setEditing(false)} aria-label="关闭编辑器">×</button>
            </div>
            <div className="correction-body">
              <aside className="correction-side">
                <span className="section-kicker">错误类型</span>
                <div className="correction-types">
                  {ERROR_TYPE_OPTIONS.map((item) => (
                    <label key={item.value} className={errorTypes.includes(item.value) ? 'correction-type active' : 'correction-type'}>
                      <input type="checkbox" checked={errorTypes.includes(item.value)} onChange={() => toggleErrorType(item.value)} />
                      {item.label}
                    </label>
                  ))}
                </div>
                <p className="muted">勾选错误类型有助于后续统计解析质量；不确定时可以只修改内容后直接保存。</p>
              </aside>
              <div className="correction-main">
                <div className="correction-main-head">
                  <strong>解析模块</strong>
                  <button className="secondary-button" onClick={() => setDraftSections((prev) => [...prev, { title: '新模块', content: [] }])}>新增模块</button>
                </div>
                <div className="correction-sections">
                  {draftSections.map((section, index) => (
                    <div className="correction-section" key={index}>
                      <label>模块标题</label>
                      <input value={section.title} onChange={(event) => updateSection(index, { title: event.target.value })} placeholder="模块标题" />
                      <label>模块内容</label>
                      <textarea value={(section.content || []).join('\n')} onChange={(event) => updateSection(index, { content: event.target.value.split('\n') })} placeholder="每行一段内容" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
            <div className="correction-actions">
              <button className="secondary-button" onClick={() => setEditing(false)}>取消</button>
              <button onClick={saveCorrection} disabled={saving}>{saving ? '保存中...' : '保存纠偏'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
