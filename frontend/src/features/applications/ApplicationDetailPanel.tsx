import { useState } from 'react';
import type { Application, ResumeVersion, Session } from '../../types/domain';

type ApplicationPatch = Partial<Pick<Application,
  'resumeVersionId' | 'sessionIds' | 'interviewAt' | 'reminderAt' | 'reminderDone' | 'nextAction' | 'result' | 'notes'
>>;

function toLocalDateTime(value?: string | null) {
  if (!value) return '';
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function toIso(value: string) {
  return value ? new Date(value).toISOString() : null;
}

export default function ApplicationDetailPanel({
  application,
  versions,
  sessions,
  onClose,
  onSave
}: {
  application: Application;
  versions: ResumeVersion[];
  sessions: Session[];
  onClose: () => void;
  onSave: (patch: ApplicationPatch) => Promise<unknown>;
}) {
  const [resumeVersionId, setResumeVersionId] = useState(application.resumeVersionId || '');
  const [sessionIds, setSessionIds] = useState(application.sessionIds || []);
  const [interviewAt, setInterviewAt] = useState(toLocalDateTime(application.interviewAt));
  const [reminderAt, setReminderAt] = useState(toLocalDateTime(application.reminderAt));
  const [reminderDone, setReminderDone] = useState(Boolean(application.reminderDone));
  const [nextAction, setNextAction] = useState(application.nextAction || '');
  const [result, setResult] = useState(application.result || '');
  const [notes, setNotes] = useState(application.notes || '');
  const [saving, setSaving] = useState(false);

  function toggleSession(id: string) {
    setSessionIds((current) => current.includes(id)
      ? current.filter((item) => item !== id)
      : [...current, id]);
  }

  async function save() {
    setSaving(true);
    try {
      await onSave({
        resumeVersionId: resumeVersionId || null,
        sessionIds,
        interviewAt: toIso(interviewAt),
        reminderAt: toIso(reminderAt),
        reminderDone,
        nextAction,
        result,
        notes
      });
      onClose();
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="application-detail-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="application-detail-panel" role="dialog" aria-modal="true" aria-labelledby="application-detail-title">
        <header>
          <div>
            <p className="eyebrow">求职申请详情</p>
            <h2 id="application-detail-title">{application.job?.title || '未命名岗位'}</h2>
            <p>{application.job?.company || '公司未填写'}</p>
          </div>
          <button className="secondary-button" onClick={onClose}>关闭</button>
        </header>

        <div className="application-detail-form">
          <label>
            定向简历版本
            <select value={resumeVersionId} onChange={(event) => setResumeVersionId(event.target.value)}>
              <option value="">暂不绑定</option>
              {versions.map((version) => (
                <option key={version.id} value={version.id}>{version.label || `版本 ${version.versionNumber}`}</option>
              ))}
            </select>
          </label>
          <label>
            面试时间
            <input type="datetime-local" value={interviewAt} onChange={(event) => setInterviewAt(event.target.value)} />
          </label>
          <label>
            提醒时间
            <input type="datetime-local" value={reminderAt} onChange={(event) => {
              setReminderAt(event.target.value);
              setReminderDone(false);
            }} />
          </label>
          <label className="application-reminder-check">
            <input type="checkbox" checked={reminderDone} onChange={(event) => setReminderDone(event.target.checked)} />
            提醒事项已完成
          </label>
          <label className="wide">
            下一步行动
            <input value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="例如：准备系统设计案例并确认面试时间" />
          </label>
          <fieldset className="wide">
            <legend>关联面试练习</legend>
            <div className="application-session-options">
              {sessions.map((session) => (
                <label key={session.id}>
                  <input type="checkbox" checked={sessionIds.includes(session.id)} onChange={() => toggleSession(session.id)} />
                  <span>{session.title}</span>
                </label>
              ))}
              {!sessions.length ? <p className="empty">还没有面试练习记录。</p> : null}
            </div>
          </fieldset>
          <label className="wide">
            当前结果
            <textarea value={result} onChange={(event) => setResult(event.target.value)} placeholder="例如：通过一面，等待二面安排" />
          </label>
          <label className="wide">
            备注
            <textarea value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="记录联系人、面试反馈、薪资范围或后续沟通信息" />
          </label>
        </div>

        <footer>
          <button className="secondary-button" onClick={onClose}>取消</button>
          <button onClick={save} disabled={saving}>{saving ? '保存中…' : '保存详情'}</button>
        </footer>
      </section>
    </div>
  );
}
