export type PreviewDensity = 'standard' | 'compact' | 'dense';

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function asText(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function asRecordList(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value) ? value.map(asRecord).filter((item) => Object.keys(item).length) : [];
}

function asTextList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.map((item) => typeof item === 'string' ? item.trim() : asText(asRecord(item).text)).filter(Boolean)
    : [];
}

function normalizedText(value = '') {
  return value.replace(/\s+/g, '').replace(/[。；;,.，、：:]/g, '');
}

function uniqueHighlights(value: unknown, lead = '') {
  const leadKey = normalizedText(lead);
  const seen = new Set<string>();
  return asTextList(value).filter((line) => {
    const key = normalizedText(line);
    if (!key || (leadKey && key === leadKey) || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function periodOf(item: Record<string, unknown>) {
  return [asText(item.startDate), asText(item.endDate)].filter(Boolean).join(' - ');
}

function updateArrayItem(resume: Record<string, unknown>, key: string, index: number, patch: Record<string, unknown>) {
  const list = Array.isArray(resume[key]) ? [...resume[key] as Record<string, unknown>[]] : [];
  list[index] = { ...asRecord(list[index]), ...patch };
  return { ...resume, [key]: list };
}

export function GeneratedResumeEditor({ resume, onChange }: { resume: Record<string, unknown>; onChange: (resume: Record<string, unknown>) => void }) {
  const basics = asRecord(resume.basics);
  const work = asRecordList(resume.work);
  const projects = asRecordList(resume.projects);
  const skills = asRecordList(resume.skills);

  return (
    <div className="generated-editor">
      <div className="generated-editor-section">
        <h5>基础信息</h5>
        <label>姓名</label>
        <input value={asText(basics.name)} onChange={(event) => onChange({ ...resume, basics: { ...basics, name: event.target.value } })} />
        <label>定位</label>
        <input value={asText(basics.label)} onChange={(event) => onChange({ ...resume, basics: { ...basics, label: event.target.value } })} />
        <label>个人简介</label>
        <textarea value={asText(basics.summary)} onChange={(event) => onChange({ ...resume, basics: { ...basics, summary: event.target.value } })} />
      </div>
      {skills.length ? (
        <div className="generated-editor-section">
          <h5>技能</h5>
          {skills.map((item, index) => (
            <div className="generated-editor-item" key={`skill-edit-${index}`}>
              <label>{asText(item.name) || `技能 ${index + 1}`}</label>
              <textarea value={asTextList(item.keywords).join('、')} onChange={(event) => onChange(updateArrayItem(resume, 'skills', index, { keywords: event.target.value.split(/[、,\n]/).map((line) => line.trim()).filter(Boolean) }))} placeholder="用顿号、逗号或换行分隔" />
            </div>
          ))}
        </div>
      ) : null}
      {work.map((item, index) => (
        <div className="generated-editor-section" key={`work-edit-${index}`}>
          <h5>工作经历 {index + 1}</h5>
          <label>{[asText(item.name), asText(item.position)].filter(Boolean).join(' · ') || `工作经历 ${index + 1}`}</label>
          <input value={asText(item.summary)} onChange={(event) => onChange(updateArrayItem(resume, 'work', index, { summary: event.target.value }))} placeholder="经历摘要" />
          <textarea value={asTextList(item.highlights).join('\n')} onChange={(event) => onChange(updateArrayItem(resume, 'work', index, { highlights: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean) }))} placeholder="每行一个要点" />
        </div>
      ))}
      {projects.map((item, index) => (
        <div className="generated-editor-section" key={`project-edit-${index}`}>
          <h5>项目经历 {index + 1}</h5>
          <label>{asText(item.name) || `项目经历 ${index + 1}`}</label>
          <input value={asText(item.description)} onChange={(event) => onChange(updateArrayItem(resume, 'projects', index, { description: event.target.value }))} placeholder="项目摘要" />
          <textarea value={asTextList(item.highlights).join('\n')} onChange={(event) => onChange(updateArrayItem(resume, 'projects', index, { highlights: event.target.value.split('\n').map((line) => line.trim()).filter(Boolean) }))} placeholder="每行一个要点" />
        </div>
      ))}
    </div>
  );
}

export function GeneratedResumeCard({ resume, density }: { resume: Record<string, unknown>; density: PreviewDensity }) {
  const basics = asRecord(resume.basics);
  const work = asRecordList(resume.work);
  const projects = asRecordList(resume.projects);
  const skills = asRecordList(resume.skills);
  const education = asRecordList(resume.education);

  return (
    <div className={`generated-resume-pages density-${density}`}>
      <div className="generated-resume-card">
        <div className="generated-resume-head">
          <div><h5>{asText(basics.name) || '未命名候选人'}</h5>{asText(basics.label) ? <p>{asText(basics.label)}</p> : null}</div>
          <div className="generated-contact">{[asText(basics.email), asText(basics.phone)].filter(Boolean).map((item) => <span key={item}>{item}</span>)}</div>
        </div>
        {asText(basics.summary) ? <section className="generated-section"><h6>个人简介</h6><p>{asText(basics.summary)}</p></section> : null}
        {skills.length ? <section className="generated-section"><h6>技能</h6><div className="generated-skill-list">{skills.map((item, index) => <div className="generated-skill" key={`${asText(item.name)}-${index}`}><strong>{asText(item.name) || '技能'}</strong><div className="chip-wrap">{asTextList(item.keywords).map((keyword) => <span className="chip" key={keyword}>{keyword}</span>)}</div></div>)}</div></section> : null}
        {education.length ? <section className="generated-section"><h6>教育经历</h6>{education.map((item, index) => <article className="generated-item" key={`${asText(item.institution)}-${index}`}><div className="generated-item-title"><strong>{[asText(item.institution), asText(item.area), asText(item.studyType)].filter(Boolean).join(' · ') || '教育经历'}</strong>{periodOf(item) ? <span>{periodOf(item)}</span> : null}</div></article>)}</section> : null}
        {work.length ? <section className="generated-section"><h6>工作经历</h6>{work.map((item, index) => <article className="generated-item" key={`${asText(item.name)}-${index}`}><div className="generated-item-title"><strong>{[asText(item.name), asText(item.position)].filter(Boolean).join(' · ') || '未命名经历'}</strong>{periodOf(item) ? <span>{periodOf(item)}</span> : null}</div>{asText(item.summary) ? <p className="generated-summary">{asText(item.summary)}</p> : null}{uniqueHighlights(item.highlights, asText(item.summary)).length ? <ul>{uniqueHighlights(item.highlights, asText(item.summary)).map((line, idx) => <li key={idx}>{line}</li>)}</ul> : null}</article>)}</section> : null}
        {projects.length ? <section className="generated-section"><h6>项目经历</h6>{projects.map((item, index) => <article className="generated-item" key={`${asText(item.name)}-${index}`}><div className="generated-item-title"><strong>{asText(item.name) || '未命名项目'}</strong>{periodOf(item) ? <span>{periodOf(item)}</span> : null}</div>{asText(item.description) ? <p className="generated-summary">{asText(item.description)}</p> : null}{uniqueHighlights(item.highlights, asText(item.description)).length ? <ul>{uniqueHighlights(item.highlights, asText(item.description)).map((line, idx) => <li key={idx}>{line}</li>)}</ul> : null}</article>)}</section> : null}
      </div>
    </div>
  );
}
