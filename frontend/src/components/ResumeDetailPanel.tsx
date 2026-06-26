import type { Resume, Risk, Section } from '../types/domain';

export default function ResumeDetailPanel({ resume }: { resume: Resume | null }) {
  if (!resume) return <p className="empty">点击左侧某条简历查看详情。</p>;

  const riskCount = Array.isArray(resume.risks) ? resume.risks.length : 0;
  const sectionCount = Array.isArray(resume.sections) ? resume.sections.length : 0;

  return (
    <div className="detail-stack">
      <div className="detail-header">
        <h3>Resume Detail</h3>
        <p>{resume.createdAt}</p>
      </div>
      <div className="detail-grid two-col">
        <div className="detail-card"><span>ID</span><strong>{resume.id}</strong></div>
        <div className="detail-card"><span>Sections</span><strong>{sectionCount}</strong></div>
        <div className="detail-card"><span>Risks</span><strong>{riskCount}</strong></div>
        <div className="detail-card"><span>KB Size</span><strong>{resume.kbSize || '-'}</strong></div>
      </div>
      <div className="detail-block">
        <h4>Resume Text Preview</h4>
        <pre>{resume.text || ''}</pre>
      </div>
      <div className="detail-block">
        <h4>Risk Terms</h4>
        {riskCount ? (
          <div className="chip-wrap">
            {(resume.risks || []).map((risk: Risk) => <span key={risk.term} className="chip danger">{risk.term}</span>)}
          </div>
        ) : <p className="empty">暂无风险术语。</p>}
      </div>
      <div className="detail-block">
        <h4>Sections</h4>
        <div className="section-list compact">
          {(resume.sections || []).map((section: Section) => (
            <div className="section-item" key={section.title}>
              <h5>{section.title}</h5>
              <ul>{(section.content || []).slice(0, 6).map((item: string, idx: number) => <li key={idx}>{item}</li>)}</ul>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
