import { useEffect, useMemo, useState } from 'react';
import ResumeDetailPanel from './components/ResumeDetailPanel';
import RunDetailPanel from './components/RunDetailPanel';
import SessionDetailPanel from './components/SessionDetailPanel';

type Section = { title: string; content: string[] };
type ParseResult = { text: string; sections: Section[]; risks: { term: string; reason: string }[]; kbSize: number; vectorProvider?: string };
type Tab = 'workspace' | 'resumes' | 'runs' | 'sessions';

export default function App() {
  const [resumeText, setResumeText] = useState('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [goal, setGoal] = useState('请围绕项目经历生成可深挖的面试问题');
  const [executionPlan, setExecutionPlan] = useState<any[]>([]);
  const [agentOutputs, setAgentOutputs] = useState<any[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [vectorProvider, setVectorProvider] = useState<string>('memory');
  const [resumes, setResumes] = useState<any[]>([]);
  const [runs, setRuns] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [selectedResume, setSelectedResume] = useState<any | null>(null);
  const [selectedRun, setSelectedRun] = useState<any | null>(null);
  const [selectedSession, setSelectedSession] = useState<any | null>(null);
  const [tab, setTab] = useState<Tab>('workspace');

  const stats = useMemo(() => {
    if (!parseResult) return null;
    return [
      ['分块数量', String(parseResult.kbSize)],
      ['风险术语', String(parseResult.risks.length)],
      ['识别模块', String(parseResult.sections.length)],
      ['向量层', parseResult.vectorProvider || vectorProvider]
    ];
  }, [parseResult, vectorProvider]);

  async function parseResume(file?: File) {
    setLoading('正在解析简历...');
    const form = new FormData();
    if (file) form.append('resume', file);
    if (resumeText.trim()) form.append('text', resumeText);
    const res = await fetch('/api/parse', { method: 'POST', body: form });
    const data = await res.json();
    setParseResult(data);
    setResumeText(data.text);
    setVectorProvider(data.vectorProvider || 'memory');
    setLoading(null);
    loadResumes();
  }

  async function runAgents() {
    if (!resumeText.trim()) return;
    setLoading('正在运行 workflow...');
    const res = await fetch('/api/agent-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: resumeText, goal, answer: '', history: [] })
    });
    const data = await res.json();
    setExecutionPlan(data.executionPlan || []);
    setAgentOutputs(data.agentOutputs || []);
    setVectorProvider(data.vectorProvider || 'memory');
    setLoading(null);
    loadRuns();
    loadSessions();
  }

  async function loadResumes() { const res = await fetch('/api/resumes'); const data = await res.json(); setResumes(data.resumes || []); }
  async function loadRuns() { const res = await fetch('/api/runs'); const data = await res.json(); setRuns(data.runs || []); }
  async function loadSessions() { const res = await fetch('/api/sessions'); const data = await res.json(); setSessions(data.sessions || []); }
  async function openResume(id: string) { const res = await fetch(`/api/resumes/${id}`); const data = await res.json(); setSelectedResume(data.resume || null); }
  async function openRun(id: string) { const res = await fetch(`/api/runs/${id}`); const data = await res.json(); setSelectedRun(data.run || null); }
  async function openSession(id: string) { const res = await fetch(`/api/sessions/${id}`); const data = await res.json(); setSelectedSession(data.session || null); }

  useEffect(() => { loadResumes(); loadRuns(); loadSessions(); }, []);

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">ResumePilot</p>
          <h1>ResumePilot Web App</h1>
          <p className="subtitle">现在已经是更像产品原型的 Web App：有 Resume/Run/Session 列表与详情，也有 Session 对话时间线。</p>
        </div>
        {stats && <div className="stats">{stats.map(([label, value]) => <div key={label} className="stat-card"><span>{label}</span><strong>{value}</strong></div>)}</div>}
      </header>

      <section className="card intro-card">
        <div className="tab-row">{['workspace', 'resumes', 'runs', 'sessions'].map((name) => <button key={name} className={tab === name ? 'tab active' : 'tab'} onClick={() => setTab(name as Tab)}>{name}</button>)}</div>
      </section>

      {tab === 'workspace' && (
        <main className="grid grid-wide">
          <section className="card tall">
            <h2>Workspace</h2>
            <textarea value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="粘贴简历文本或上传 PDF/TXT" />
            <div className="row">
              <label className="upload">上传 PDF / TXT<input type="file" accept=".pdf,.txt" onChange={(e) => { const file = e.target.files?.[0]; if (file) parseResume(file); }} /></label>
              <button onClick={() => parseResume()}>解析文本</button>
              <button onClick={runAgents}>运行 Workflow</button>
            </div>
            {parseResult && <pre>{JSON.stringify(parseResult, null, 2)}</pre>}
          </section>
          <section className="card"><h2>Goal</h2><input value={goal} onChange={(e) => setGoal(e.target.value)} /></section>
          <section className="card"><h2>Execution Plan</h2>{executionPlan.length ? <pre>{JSON.stringify(executionPlan, null, 2)}</pre> : <p className="empty">运行后展示。</p>}</section>
          <section className="card full"><h2>Agent Outputs</h2>{agentOutputs.length ? <pre>{JSON.stringify(agentOutputs, null, 2)}</pre> : <p className="empty">运行后展示。</p>}</section>
        </main>
      )}

      {tab === 'resumes' && (
        <main className="grid grid-wide detail-layout">
          <section className="card">
            <h2>Resume 列表页</h2>
            <div className="risk-list">{resumes.length ? resumes.map((resume) => <div className="risk-item" key={resume.id}><strong>{resume.id}</strong><p>{resume.createdAt}</p><p>{(resume.text || '').slice(0, 120)}...</p><button onClick={() => openResume(resume.id)}>查看详情</button></div>) : <p className="empty">还没有简历记录。</p>}</div>
          </section>
          <section className="card tall"><ResumeDetailPanel resume={selectedResume} /></section>
        </main>
      )}

      {tab === 'runs' && (
        <main className="grid grid-wide detail-layout">
          <section className="card">
            <h2>Runs 历史页</h2>
            <div className="risk-list">{runs.length ? runs.map((run) => <div className="risk-item" key={run.id}><strong>{run.goal || 'No goal'}</strong><p>{run.createdAt}</p><p>{run.skill?.name || run.skillId || 'unknown skill'}</p><button onClick={() => openRun(run.id)}>查看详情</button></div>) : <p className="empty">还没有运行记录。</p>}</div>
          </section>
          <section className="card tall"><RunDetailPanel run={selectedRun} /></section>
        </main>
      )}

      {tab === 'sessions' && (
        <main className="grid grid-wide detail-layout">
          <section className="card">
            <h2>Session 结构页</h2>
            <div className="risk-list">{sessions.length ? sessions.map((session) => <div className="risk-item" key={session.id}><strong>{session.title}</strong><p>{session.createdAt}</p><p>runs: {session.runs}</p><button onClick={() => openSession(session.id)}>查看详情</button></div>) : <p className="empty">还没有 session 结构数据。</p>}</div>
          </section>
          <section className="card tall"><SessionDetailPanel session={selectedSession} /></section>
        </main>
      )}

      {loading && <div className="loading">{loading}</div>}
    </div>
  );
}
