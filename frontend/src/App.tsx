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
  const [qdrantReadiness, setQdrantReadiness] = useState<any | null>(null);
  const [tab, setTab] = useState<Tab>('workspace');
  const [activeQuestion, setActiveQuestion] = useState('');
  const [answerDraft, setAnswerDraft] = useState('');
  const [retrievalPreview, setRetrievalPreview] = useState<any[]>([]);
  const [activeCritique, setActiveCritique] = useState<string[]>([]);
  const [activeImproved, setActiveImproved] = useState('');

  const stats = useMemo(() => {
    if (!parseResult) return null;
    return [
      ['分块数量', String(parseResult.kbSize)],
      ['风险术语', String(parseResult.risks.length)],
      ['识别模块', String(parseResult.sections.length)],
      ['向量层', parseResult.vectorProvider || vectorProvider]
    ];
  }, [parseResult, vectorProvider]);

  const agentCards = useMemo(() => {
    const map = new Map<string, any>();
    for (const item of agentOutputs) {
      map.set(item.step?.agent || 'unknown', item.output);
    }
    return [
      { name: 'planner', output: map.get('planner') },
      { name: 'retriever', output: map.get('retriever') },
      { name: 'interviewer', output: map.get('interviewer') },
      { name: 'critic', output: map.get('critic') },
      { name: 'writer', output: map.get('writer') }
    ];
  }, [agentOutputs]);

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
      body: JSON.stringify({ text: resumeText, goal, answer: answerDraft, history: [], sessionId: selectedSession?.id || null })
    });
    const data = await res.json();
    setExecutionPlan(data.executionPlan || []);
    setAgentOutputs(data.agentOutputs || []);
    setVectorProvider(data.vectorProvider || 'memory');
    setActiveQuestion(data.questions?.detail?.[0] || data.questions?.basic?.[0] || '');
    setRetrievalPreview(data.retrieved || []);
    setActiveCritique(data.critique?.feedback || []);
    setActiveImproved(data.rewrite?.improvedAnswer || '');
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
    setActiveQuestion(data.questions?.detail?.[0] || data.questions?.basic?.[0] || '');
    setRetrievalPreview(data.retrieved || []);
    setActiveCritique(data.critique?.feedback || []);
    setActiveImproved(data.rewrite?.improvedAnswer || '');
    setAnswerDraft('');
    setLoading(null);
    await loadSessions();
    await loadDashboard();
  }

  async function loadResumes() { const res = await fetch('/api/resumes'); const data = await res.json(); setResumes(data.resumes || []); }
  async function loadRuns() { const res = await fetch('/api/runs'); const data = await res.json(); setRuns(data.runs || []); }
  async function loadSessions() { const res = await fetch('/api/sessions'); const data = await res.json(); setSessions(data.sessions || []); }
  async function loadDashboard() { const res = await fetch('/api/dashboard'); setDashboard(await res.json()); }
  async function loadQdrantReadiness() { const res = await fetch('/api/qdrant-readiness'); setQdrantReadiness(await res.json()); }
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
    setTab('workspace');
  }

  useEffect(() => { loadResumes(); loadRuns(); loadSessions(); loadDashboard(); loadQdrantReadiness(); }, []);

  return (
    <div className="page">
      <header className="hero">
        <div>
          <p className="eyebrow">ResumePilot</p>
          <h1>ResumePilot Web App</h1>
          <p className="subtitle">Workspace 现已升级为真正的 Agent 协作工作台：用户输入、当前问题、批注改写、agent 状态和检索上下文同时可见。</p>
        </div>
        {stats && <div className="stats">{stats.map(([label, value]) => <div key={label} className="stat-card"><span>{label}</span><strong>{value}</strong></div>)}</div>}
      </header>

      <section className="card intro-card">
        <div className="tab-row">{['workspace', 'resumes', 'runs', 'sessions', 'dashboard'].map((name) => <button key={name} className={tab === name ? 'tab active' : 'tab'} onClick={() => setTab(name as Tab)}>{name}</button>)}</div>
      </section>

      {tab === 'workspace' && (
        <main className="workspace-shell">
          <section className="card workspace-left">
            <h2>Session Control</h2>
            <label className="label">当前 Goal</label>
            <input value={goal} onChange={(e) => setGoal(e.target.value)} />
            <label className="label">Resume Input</label>
            <textarea value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="粘贴简历文本或上传 PDF/TXT" />
            <div className="row wrap">
              <label className="upload">上传 PDF / TXT<input type="file" accept=".pdf,.txt" onChange={(e) => { const file = e.target.files?.[0]; if (file) parseResume(file); }} /></label>
              <button onClick={() => parseResume()}>解析文本</button>
              <button onClick={runAgents}>运行 Workflow</button>
              <button onClick={createSession}>新建 Session</button>
            </div>
            <div className="detail-block compact-block">
              <h4>当前 Session</h4>
              {selectedSession ? (
                <div className="session-summary">
                  <strong>{selectedSession.title}</strong>
                  <p>turns: {(selectedSession.turns || []).length}</p>
                </div>
              ) : <p className="empty">还未选中 session。</p>}
            </div>
          </section>

          <section className="card workspace-center">
            <h2>Active Interview</h2>
            <div className="message interviewer"><strong>Current Question</strong><p>{activeQuestion || '先运行 workflow 或进入某个 session。'}</p></div>
            <label className="label">Your Answer</label>
            <textarea value={answerDraft} onChange={(e) => setAnswerDraft(e.target.value)} placeholder="在这里输入你的回答，然后运行 Workflow 或继续 Session。" />
            <div className="row wrap">
              <button onClick={runAgents}>用当前回答跑一次 Workflow</button>
              <button onClick={() => continueSession({ text: resumeText, answer: answerDraft })} disabled={!selectedSession}>继续当前 Session</button>
            </div>
            <div className="detail-grid one-col">
              <div className="message critic">
                <strong>Critique</strong>
                {activeCritique.length ? <ul>{activeCritique.map((item, idx) => <li key={idx}>{item}</li>)}</ul> : <p>暂无批注。</p>}
              </div>
              <div className="message writer">
                <strong>Improved Answer</strong>
                <p>{activeImproved || '暂无改写结果。'}</p>
              </div>
            </div>
          </section>

          <section className="card workspace-right">
            <h2>Agent Collaboration</h2>
            <div className="agent-stack">
              {agentCards.map((card) => (
                <div className="agent-card" key={card.name}>
                  <div className="agent-head">
                    <strong>{card.name}</strong>
                    <span>{card.output ? 'active' : 'idle'}</span>
                  </div>
                  <pre>{card.output ? JSON.stringify(card.output, null, 2) : 'No output yet.'}</pre>
                </div>
              ))}
            </div>
          </section>

          <section className="card workspace-bottom">
            <h2>Retrieval & Context</h2>
            <div className="retrieval-grid">
              {retrievalPreview.length ? retrievalPreview.map((item, idx) => (
                <div className="retrieval-card" key={idx}>
                  <div className="retrieval-meta">
                    <span>{item.source || 'resume'}</span>
                    <strong>score {item.score}</strong>
                  </div>
                  <p>{item.content}</p>
                </div>
              )) : <p className="empty">运行 workflow 或继续 session 后，这里会展示 resume + session history 的联合检索结果。</p>}
            </div>
          </section>
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
                  <div className="detail-card"><span>Avg Critique Length</span><strong>{dashboard.quality?.avgCritiqueLength}</strong></div>
                  <div className="detail-card"><span>Improved Coverage</span><strong>{dashboard.quality?.improvedAnswerCoverage}</strong></div>
                  <div className="detail-card"><span>Resume Retrieval Mix</span><strong>{dashboard.sourceMix?.resume}</strong></div>
                  <div className="detail-card"><span>History Retrieval Mix</span><strong>{dashboard.sourceMix?.session_history}</strong></div>
                </div>
                <div className="detail-block">
                  <h4>Qdrant Readiness</h4>
                  {qdrantReadiness ? (
                    <div className="detail-grid two-col">
                      <div className="detail-card"><span>Provider</span><strong>{qdrantReadiness.provider}</strong></div>
                      <div className="detail-card"><span>Configured</span><strong>{String(qdrantReadiness.configured)}</strong></div>
                      <div className="detail-card"><span>Service Reachable</span><strong>{String(qdrantReadiness.serviceReachable)}</strong></div>
                      <div className="detail-card"><span>Collection Reachable</span><strong>{String(qdrantReadiness.collectionReachable)}</strong></div>
                      <div className="detail-card"><span>QDRANT_URL</span><strong>{qdrantReadiness.env?.QDRANT_URL || 'not_set'}</strong></div>
                      <div className="detail-card"><span>Collection</span><strong>{qdrantReadiness.env?.QDRANT_COLLECTION}</strong></div>
                    </div>
                  ) : <p className="empty">加载中...</p>}
                  {qdrantReadiness?.notes?.length ? <ul>{qdrantReadiness.notes.map((note: string) => <li key={note}>{note}</li>)}</ul> : null}
                </div>
                <div className="detail-block">
                  <h4>Eval Notes</h4>
                  <ul>{(dashboard.evalNotes || []).map((note: string) => <li key={note}>{note}</li>)}</ul>
                </div>
                <div className="detail-block">
                  <h4>Session Trend</h4>
                  <div className="risk-list">{(dashboard.trend || []).map((item: any) => <div className="risk-item" key={item.title + item.createdAt}><strong>{item.title}</strong><p>{item.createdAt}</p><p>turns: {item.turns}</p></div>)}</div>
                </div>
                <div className="detail-block">
                  <h4>Retrieval Samples</h4>
                  <div className="risk-list">{(dashboard.retrievalSamples || []).map((sample: any, idx: number) => <div className="risk-item" key={idx}><strong>{sample.session}</strong><p>{sample.question}</p><ul>{(sample.retrieved || []).map((r: any, i: number) => <li key={i}>[{r.source || 'resume'}] score={r.score} {String(r.content || '').slice(0, 100)}...</li>)}</ul></div>)}</div>
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
