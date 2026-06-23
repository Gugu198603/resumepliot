import { useEffect, useMemo, useState } from 'react';
import ResumeDetailPanel from './components/ResumeDetailPanel';
import RunDetailPanel from './components/RunDetailPanel';
import SessionDetailPanel from './components/SessionDetailPanel';

type Section = { title: string; content: string[] };
type ParseResult = { text: string; sections: Section[]; risks: { term: string; reason: string }[]; kbSize: number; vectorProvider?: string };
type Tab = 'workspace' | 'resumes' | 'runs' | 'sessions' | 'dashboard';

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
  const [dashboard, setDashboard] = useState<any | null>(null);
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
    loadDashboard();
  }

  async function runAgents() {
    if (!resumeText.trim()) return;
    setLoading('正在运行 workflow...');
    const res = await fetch('/api/agent-run', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: resumeText, goal, answer: '', history: [], sessionId: selectedSession?.id || null })
    });
    const data = await res.json();
    setExecutionPlan(data.executionPlan || []);
    setAgentOutputs(data.agentOutputs || []);
    setVectorProvider(data.vectorProvider || 'memory');
    setLoading(null);
    await loadRuns();
    await loadSessions();
    await loadDashboard();
    if (data.sessionId) openSession(data.sessionId);
  }

  async function continueSession(payload: { text: string; answer: string }) {
    if (!selectedSession?.id) return;
    setLoading('正在继续对话...');
    const res = await fetch(`/api/sessions/${selectedSession.id}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const data = await res.json();
    setSelectedSession(data.session || null);
    setLoading(null);
    await loadSessions();
    await loadDashboard();
  }

  async function loadResumes() { const res = await fetch('/api/resumes'); const data = await res.json(); setResumes(data.resumes || []); }
  async function loadRuns() { const res = await fetch('/api/runs'); const data = await res.json(); setRuns(data.runs || []); }
  async function loadSessions() { const res = await fetch('/api/sessions'); const data = await res.json(); setSessions(data.sessions || []); }
  async function loadDashboard() { const res = await fetch('/api/dashboard'); setDashboard(await res.json()); }
  async function openResume(id: string) { const res = await fetch(`/api/resumes/${id}`); const data = await res.json(); setSelectedResume(data.resume || null); }
  async function openRun(id: string) { const res = await fetch(`/api/runs/${id}`); const data = await res.json(); setSelectedRun(data.run || null); }
  async function openSession(id: string) { const res = await fetch(`/api/sessions/${id}`); const data = await res.json(); setSelectedSession(data.session || null); }

  async function createSession() {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: goal, goal })
    });
    const data = await res.json();
    await loadSessions();
    setSelectedSession(data.session || null);
    setTab('sessions');
  }

  useEffect(() => { loadResumes(); loadRuns(); loadSessions(); loadDashboard(); }, []);

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">ResumePilot</p>
          <h1>ResumePilot Web App</h1>
          <p className="subtitle">现在已加入 Dashboard，可可视化 retrieval / session / run 质量指标。</p>
        </div>
        {stats && <div className="stats">{stats.map(([label, value]) => <div key={label} className="stat-card"><span>{label}</span><strong>{value}</strong></div>)}</div>}
      </header>

      <section className="card intro-card">
        <div className="tab-row">{['workspace', 'resumes', 'runs', 'sessions', 'dashboard'].map((name) => <button key={name} className={tab === name ? 'tab active' : 'tab'} onClick={() => setTab(name as Tab)}>{name}</button>)}</div>
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
              <button onClick={createSession}>新建 Session</button>
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
          <section className="card"><h2>Resume 列表页</h2><div className="risk-list">{resumes.length ? resumes.map((resume) => <div className="risk-item" key={resume.id}><strong>{resume.id}</strong><p>{resume.createdAt}</p><p>{(resume.text || '').slice(0, 120)}...</p><button onClick={() => openResume(resume.id)}>查看详情</button></div>) : <p className="empty">还没有简历记录。</p>}</div></section>
          <section className="card tall"><ResumeDetailPanel resume={selectedResume} /></section>
        </main>
      )}

      {tab === 'runs' && (
        <main className="grid grid-wide detail-layout">
          <section className="card"><h2>Runs 历史页</h2><div className="risk-list">{runs.length ? runs.map((run) => <div className="risk-item" key={run.id}><strong>{run.goal || 'No goal'}</strong><p>{run.createdAt}</p><p>{run.skill?.name || run.skillId || 'unknown skill'}</p><button onClick={() => openRun(run.id)}>查看详情</button></div>) : <p className="empty">还没有运行记录。</p>}</div></section>
          <section className="card tall"><RunDetailPanel run={selectedRun} /></section>
        </main>
      )}

      {tab === 'sessions' && (
        <main className="grid grid-wide detail-layout">
          <section className="card"><h2>Session 结构页</h2><div className="risk-list">{sessions.length ? sessions.map((session) => <div className="risk-item" key={session.id}><strong>{session.title}</strong><p>{session.createdAt}</p><p>turns: {(session.turns || []).length}</p><button onClick={() => openSession(session.id)}>查看详情</button></div>) : <p className="empty">还没有 session 结构数据。</p>}</div></section>
          <section className="card tall"><SessionDetailPanel session={selectedSession} resumeText={resumeText} onContinueSession={continueSession} /></section>
        </main>
      )}

      {tab === 'dashboard' && (
        <main className="grid grid-wide detail-layout">
          <section className="card full">
            <h2>Eval / Dashboard</h2>
            {dashboard ? (
              <div className="detail-stack">
                <div className="detail-grid two-col">
                  <div className="detail-card"><span>Resumes</span><strong>{dashboard.overview?.resumes}</strong></div>
                  <div className="detail-card"><span>Runs</span><strong>{dashboard.overview?.runs}</strong></div>
                  <div className="detail-card"><span>Sessions</span><strong>{dashboard.overview?.sessions}</strong></div>
                  <div className="detail-card"><span>Total Turns</span><strong>{dashboard.overview?.totalTurns}</strong></div>
                  <div className="detail-card"><span>Avg Retrieval</span><strong>{dashboard.quality?.avgRetrievalScore}</strong></div>
                  <div className="detail-card"><span>Avg Session Depth</span><strong>{dashboard.quality?.avgSessionDepth}</strong></div>
                  <div className="detail-card"><span>Skill Routed Runs</span><strong>{dashboard.quality?.skillRoutedRuns}</strong></div>
                  <div className="detail-card"><span>Risk Coverage</span><strong>{dashboard.quality?.riskCoverage}</strong></div>
                </div>
                <div className="detail-block">
                  <h4>Session Trend</h4>
                  <div className="risk-list">
                    {(dashboard.trend || []).map((item: any) => (
                      <div className="risk-item" key={item.title + item.createdAt}><strong>{item.title}</strong><p>{item.createdAt}</p><p>turns: {item.turns}</p></div>
                    ))}
                  </div>
                </div>
                <div className="detail-block">
                  <h4>Retrieval Samples</h4>
                  <div className="risk-list">
                    {(dashboard.retrievalSamples || []).map((sample: any, idx: number) => (
                      <div className="risk-item" key={idx}>
                        <strong>{sample.session}</strong>
                        <p>{sample.question}</p>
                        <ul>
                          {(sample.retrieved || []).map((r: any, i: number) => <li key={i}>[{r.source || 'resume'}] score={r.score} {String(r.content || '').slice(0, 100)}...</li>)}
                        </ul>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : <p className="empty">加载中...</p>}
          </section>
        </main>
      )}

      {loading && <div className="loading">{loading}</div>}
    </div>
  );
}
