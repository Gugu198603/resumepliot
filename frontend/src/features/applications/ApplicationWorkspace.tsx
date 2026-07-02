import { useState } from 'react';
import type {
  Application,
  ApplicationStatus,
  JobDescription,
  ResumeVersion,
  Session
} from '../../types/domain';
import ApplicationDetailPanel from './ApplicationDetailPanel';

const STATUS_OPTIONS: Array<[ApplicationStatus, string]> = [
  ['saved', '收藏'],
  ['preparing', '准备中'],
  ['applied', '已投递'],
  ['interviewing', '面试中'],
  ['offer', 'Offer'],
  ['rejected', '已拒绝'],
  ['withdrawn', '已放弃']
];
const NEXT_STATUSES: Record<ApplicationStatus, ApplicationStatus[]> = {
  saved: ['preparing', 'withdrawn'],
  preparing: ['saved', 'applied', 'withdrawn'],
  applied: ['preparing', 'interviewing', 'rejected', 'withdrawn'],
  interviewing: ['applied', 'offer', 'rejected', 'withdrawn'],
  offer: ['withdrawn'],
  rejected: ['preparing'],
  withdrawn: ['saved', 'preparing']
};

interface ApplicationWorkspaceProps {
  applications: Application[];
  jobs: JobDescription[];
  versions: ResumeVersion[];
  sessions: Session[];
  onCreate: (input: {
    jobId: string;
    resumeVersionId?: string | null;
    sessionIds?: string[];
    nextAction?: string;
    interviewAt?: string | null;
    reminderAt?: string | null;
    reminderDone?: boolean;
    result?: string;
    notes?: string;
  }) => Promise<unknown>;
  onUpdate: (id: string, patch: {
    status?: ApplicationStatus;
    resumeVersionId?: string | null;
    sessionIds?: string[];
    nextAction?: string;
  }) => Promise<unknown>;
  onDelete: (id: string) => Promise<unknown>;
}

export default function ApplicationWorkspace({
  applications,
  jobs,
  versions,
  sessions,
  onCreate,
  onUpdate,
  onDelete
}: ApplicationWorkspaceProps) {
  const [jobId, setJobId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [sessionId, setSessionId] = useState('');
  const [nextAction, setNextAction] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const selectedApplication = applications.find((application) => application.id === selectedId) || null;

  async function submit() {
    if (!jobId) return;
    await onCreate({
      jobId,
      resumeVersionId: versionId || null,
      sessionIds: sessionId ? [sessionId] : [],
      nextAction
    });
    setJobId('');
    setVersionId('');
    setSessionId('');
    setNextAction('');
  }

  return (
    <main className="application-page">
      <section className="card application-create">
        <div>
          <p className="eyebrow">求职闭环</p>
          <h2>新增求职申请</h2>
          <p className="muted">把岗位、定向简历和面试练习绑定到同一条求职进度。</p>
        </div>
        <div className="application-form">
          <select value={jobId} onChange={(event) => setJobId(event.target.value)}>
            <option value="">选择目标岗位</option>
            {jobs.map((job) => <option key={job.id} value={job.id}>{job.title || '未命名岗位'}{job.company ? ` · ${job.company}` : ''}</option>)}
          </select>
          <select value={versionId} onChange={(event) => setVersionId(event.target.value)}>
            <option value="">暂不绑定简历版本</option>
            {versions.map((version) => <option key={version.id} value={version.id}>{version.label || `版本 ${version.versionNumber}`}</option>)}
          </select>
          <select value={sessionId} onChange={(event) => setSessionId(event.target.value)}>
            <option value="">暂不绑定面试记录</option>
            {sessions.map((session) => <option key={session.id} value={session.id}>{session.title}</option>)}
          </select>
          <input value={nextAction} onChange={(event) => setNextAction(event.target.value)} placeholder="下一步，例如：周五前完成定向简历" />
          <button onClick={submit} disabled={!jobId}>创建申请</button>
        </div>
      </section>

      <section className="application-board">
        {STATUS_OPTIONS.map(([status, label]) => {
          const items = applications.filter((application) => application.status === status);
          return (
            <div className="application-column" key={status}>
              <header><strong>{label}</strong><span>{items.length}</span></header>
              <div className="application-list">
                {items.map((application) => (
                  <article className="application-card" key={application.id}>
                    <div>
                      <h3>{application.job?.title || '未命名岗位'}</h3>
                      <p>{application.job?.company || '公司未填写'}</p>
                    </div>
                    <label>
                      状态
                      <select value={application.status} onChange={(event) => onUpdate(application.id, { status: event.target.value as ApplicationStatus })}>
                        {STATUS_OPTIONS
                          .filter(([value]) => value === application.status || NEXT_STATUSES[application.status].includes(value))
                          .map(([value, text]) => <option key={value} value={value}>{text}</option>)}
                      </select>
                    </label>
                    <label>
                      下一步
                      <input
                        defaultValue={application.nextAction || ''}
                        onBlur={(event) => onUpdate(application.id, { nextAction: event.target.value })}
                        placeholder="填写下一步行动"
                      />
                    </label>
                    <div className="application-links">
                      <span>{application.resumeVersion ? `简历：${application.resumeVersion.label}` : '未绑定简历版本'}</span>
                      <span>{application.sessions?.length || 0} 场面试练习</span>
                    </div>
                    <ReminderBadge application={application} />
                    <button className="secondary-button" onClick={() => setSelectedId(application.id)}>编辑详情</button>
                    <button className="danger-button" onClick={() => onDelete(application.id)}>删除</button>
                  </article>
                ))}
                {!items.length ? <p className="empty">暂无记录</p> : null}
              </div>
            </div>
          );
        })}
      </section>
      {selectedApplication ? (
        <ApplicationDetailPanel
          key={selectedApplication.id}
          application={selectedApplication}
          versions={versions}
          sessions={sessions}
          onClose={() => setSelectedId(null)}
          onSave={(patch) => onUpdate(selectedApplication.id, patch)}
        />
      ) : null}
    </main>
  );
}

function ReminderBadge({ application }: { application: Application }) {
  if (!application.reminderAt) return null;
  if (application.reminderDone) return <span className="application-reminder done">提醒已完成</span>;
  const reminder = new Date(application.reminderAt);
  const delta = reminder.getTime() - Date.now();
  const state = delta < 0 ? 'overdue' : delta <= 24 * 60 * 60 * 1000 ? 'soon' : 'scheduled';
  const label = state === 'overdue'
    ? `已逾期 · ${reminder.toLocaleString()}`
    : state === 'soon'
      ? `24 小时内 · ${reminder.toLocaleString()}`
      : `提醒 · ${reminder.toLocaleString()}`;
  return <span className={`application-reminder ${state}`}>{label}</span>;
}
