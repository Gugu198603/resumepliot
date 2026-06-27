import { useEffect, useMemo, useState } from 'react';
import ResumeDetailPanel from './components/ResumeDetailPanel';
import ResumeComparePanel from './components/ResumeComparePanel';
import RunDetailPanel from './components/RunDetailPanel';
import SessionDetailPanel from './components/SessionDetailPanel';
import type {
  AgentOutput,
  Dashboard,
  ExecutionStep,
  JdMatchResult,
  JobDescription,
  JobMatch,
  LlmMetrics,
  LlmReadiness,
  ParseResult,
  QdrantReadiness,
  ResumeComparison,
  RetrievedChunk,
  Resume,
  Run,
  Session
} from './types/domain';

type Tab = 'workspace' | 'resumes' | 'runs' | 'sessions' | 'dashboard';
type DisplayTab = 'overview' | 'resume' | 'retrieval' | 'agents' | 'history' | 'jd';

export default function App() {
  const [resumeText, setResumeText] = useState('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [goal, setGoal] = useState('请围绕项目经历生成可深挖的面试问题');
  const [executionPlan, setExecutionPlan] = useState<ExecutionStep[]>([]);
  const [agentOutputs, setAgentOutputs] = useState<AgentOutput[]>([]);
  const [loading, setLoading] = useState<string | null>(null);
  const [vectorProvider, setVectorProvider] = useState<string>('memory');
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedResume, setSelectedResume] = useState<Resume | null>(null);
  const [compareIds, setCompareIds] = useState<string[]>([]);
  const [comparison, setComparison] = useState<ResumeComparison | null>(null);
  const [resumeView, setResumeView] = useState<'detail' | 'compare'>('detail');
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [qdrantReadiness, setQdrantReadiness] = useState<QdrantReadiness | null>(null);
  const [llmReadiness, setLlmReadiness] = useState<LlmReadiness | null>(null);
  const [llmMetrics, setLlmMetrics] = useState<LlmMetrics | null>(null);
  const [tab, setTab] = useState<Tab>('workspace');
  const [displayTab, setDisplayTab] = useState<DisplayTab>('overview');
  const [activeQuestion, setActiveQuestion] = useState('');
  const [answerDraft, setAnswerDraft] = useState('');
  const [retrievalPreview, setRetrievalPreview] = useState<RetrievedChunk[]>([]);
  const [activeCritique, setActiveCritique] = useState<string[]>([]);
  const [activeImproved, setActiveImproved] = useState('');
  const [jdText, setJdText] = useState('');
  const [jdResult, setJdResult] = useState<JdMatchResult | null>(null);
  const [jobMatches, setJobMatches] = useState<JobMatch[]>([]);
  const [jobs, setJobs] = useState<JobDescription[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>('');
  const [jdUrl, setJdUrl] = useState('');

  const stats = useMemo(() => {
    if (!parseResult) return null;
    return [
      ['分块数量', String(parseResult.kbSize)],
      ['风险术语', String((parseResult.risks || []).length)],
      ['识别模块', String((parseResult.sections || []).length)],
      ['向量层', parseResult.vectorProvider || vectorProvider]
    ];
  }, [parseResult, vectorProvider]);

  const agentCards = useMemo(() => {
    const map = new Map<string, unknown>();
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
      body: JSON.stringify({ text: resumeText, goal, answer: answerDraft, history: [], sessionId: selectedSession?.id || null, resumeId: parseResult?.resumeId || selectedSession?.resumeId || null })
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
    await loadLlmMetrics();
    if (data.sessionId) openSession(data.sessionId);
  }

  async function continueSession(payload: { text: string; answer: string }) {
    if (!selectedSession?.id) return;
    setLoading('正在继续对话...');
    const res = await fetch(`/api/sessions/${selectedSession.id}/continue`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...payload, resumeId: parseResult?.resumeId || selectedSession?.resumeId || null })
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

  async function matchJd() {
    if ((!jdText.trim() && !selectedJobId) || !resumeText.trim()) return;
    setLoading('正在对比岗位描述...');
    const res = await fetch('/api/jd-match', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: resumeText,
        resumeId: parseResult?.resumeId || selectedSession?.resumeId || null,
        ...(selectedJobId ? { jobId: selectedJobId } : { jdText })
      })
    });
    const data = await res.json();
    setJdResult(data.error ? null : data);
    setLoading(null);
    loadJobMatches();
  }

  function pickJob(jobId: string) {
    setSelectedJobId(jobId);
    const job = jobs.find((j) => j.id === jobId);
    if (job?.text) setJdText(job.text);
  }

  async function loadJobMatches() { const res = await fetch('/api/job-matches'); const data = await res.json(); setJobMatches(data.matches || []); }
  async function loadJobs() { const res = await fetch('/api/jobs'); const data = await res.json(); setJobs(data.jobs || []); }

  async function fetchJdFromUrl() {
    if (!jdUrl.trim()) return;
    setLoading('正在抓取岗位 JD...');
    const res = await fetch('/api/jobs/fetch', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ source: 'url', config: { url: jdUrl.trim() } })
    });
    const data = await res.json();
    const job = data.jobs?.[0];
    if (job?.text) setJdText(job.text);
    setLoading(null);
    if (data.errors?.length) alert(`抓取失败：${data.errors[0].error}\n该页面可能需要 JS 渲染或有反爬，建议手动粘贴 JD。`);
  }

  async function loadResumes() { const res = await fetch('/api/resumes'); const data = await res.json(); setResumes(data.resumes || []); }
  async function loadRuns() { const res = await fetch('/api/runs'); const data = await res.json(); setRuns(data.runs || []); }
  async function loadSessions() { const res = await fetch('/api/sessions'); const data = await res.json(); setSessions(data.sessions || []); }
  async function loadDashboard() { const res = await fetch('/api/dashboard'); setDashboard(await res.json()); }
  async function loadQdrantReadiness() { const res = await fetch('/api/qdrant-readiness'); setQdrantReadiness(await res.json()); }
  async function loadLlmReadiness() { const res = await fetch('/api/llm-readiness'); setLlmReadiness(await res.json()); }
  async function loadLlmMetrics() { const res = await fetch('/api/llm-metrics'); setLlmMetrics(await res.json()); }
  async function openResume(id: string) { const res = await fetch(`/api/resumes/${id}`); const data = await res.json(); setSelectedResume(data.resume || null); setResumeView('detail'); }

  function toggleCompare(id: string) {
    setCompareIds((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
  }

  async function compareResumes() {
    if (compareIds.length < 2) return;
    setLoading('正在对比简历...');
    const res = await fetch('/api/resumes/compare', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ids: compareIds, ...(selectedJobId ? { jobId: selectedJobId } : jdText.trim() ? { jdText } : {}) })
    });
    const data = await res.json();
    setComparison(data.error ? null : data);
    setResumeView('compare');
    setLoading(null);
  }

  async function renameResume(id: string, current: string) {
    const title = window.prompt('输入简历的新名称：', current);
    if (title === null) return;
    await fetch(`/api/resumes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    await loadResumes();
    if (selectedResume?.id === id) openResume(id);
  }

  async function deleteResume(id: string) {
    if (!window.confirm('确认删除这份简历？该操作不可撤销。')) return;
    await fetch(`/api/resumes/${id}`, { method: 'DELETE' });
    setCompareIds((prev) => prev.filter((x) => x !== id));
    if (selectedResume?.id === id) setSelectedResume(null);
    await loadResumes();
    await loadDashboard();
  }
  async function openRun(id: string) { const res = await fetch(`/api/runs/${id}`); const data = await res.json(); setSelectedRun(data.run || null); }
  async function openSession(id: string) { const res = await fetch(`/api/sessions/${id}`); const data = await res.json(); setSelectedSession(data.session || null); }

  async function createSession() {
    const res = await fetch('/api/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: goal, goal, resumeId: parseResult?.resumeId || null })
    });
    const data = await res.json();
    await loadSessions();
    setSelectedSession(data.session || null);
    setTab('workspace');
  }

  useEffect(() => { loadResumes(); loadRuns(); loadSessions(); loadDashboard(); loadQdrantReadiness(); loadLlmReadiness(); loadLlmMetrics(); loadJobMatches(); loadJobs(); }, []);

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
          <aside className="card control-panel">
            <div className="panel-heading">
              <p className="eyebrow">Control</p>
              <h2>操作台</h2>
              <p>从上到下完成导入、设定目标、输入回答和运行 workflow。</p>
            </div>

            <div className="control-section">
              <div className="step-label"><span>1</span><strong>导入简历</strong></div>
              <textarea className="resume-input" value={resumeText} onChange={(e) => setResumeText(e.target.value)} placeholder="粘贴简历文本，或者上传 PDF/TXT。" />
              <div className="action-row">
                <label className="upload">上传 PDF / TXT<input type="file" accept=".pdf,.txt" onChange={(e) => { const file = e.target.files?.[0]; if (file) parseResume(file); }} /></label>
                <button onClick={() => parseResume()}>解析简历</button>
              </div>
            </div>

            <div className="control-section">
              <div className="step-label"><span>2</span><strong>设定目标</strong></div>
              <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="例如：围绕项目经历生成深挖问题" />
            </div>

            <div className="control-section">
              <div className="step-label"><span>3</span><strong>回答当前问题</strong></div>
              <textarea className="answer-input" value={answerDraft} onChange={(e) => setAnswerDraft(e.target.value)} placeholder="在这里输入你的回答，然后运行 Workflow 或继续 Session。" />
            </div>

            <div className="control-section">
              <div className="step-label"><span>4</span><strong>执行动作</strong></div>
              <div className="primary-actions">
                <button onClick={runAgents}>运行 Workflow</button>
                <button onClick={() => continueSession({ text: resumeText, answer: answerDraft })} disabled={!selectedSession}>继续 Session</button>
                <button className="secondary-button" onClick={createSession}>新建 Session</button>
              </div>
            </div>

            <div className="session-card">
              <span>当前 Session</span>
              {selectedSession ? (
                <>
                  <strong>{selectedSession.title}</strong>
                  <p>{(selectedSession.turns || []).length} turns</p>
                </>
              ) : (
                <p>尚未选择 session。</p>
              )}
            </div>
          </aside>

          <section className="display-panel">
            <div className="display-header card">
              <div>
                <p className="eyebrow">Result</p>
                <h2>展示界面</h2>
                <p>右侧只看结果和过程，默认聚焦当前问题、批注和改写答案。</p>
              </div>
              <div className="status-strip">
                {(stats || [
                  ['简历状态', resumeText.trim() ? '已输入' : '待输入'],
                  ['Workflow', executionPlan.length ? `${executionPlan.length} steps` : '待运行'],
                  ['向量层', vectorProvider],
                  ['Session', selectedSession ? `${(selectedSession.turns || []).length} turns` : '未选择']
                ]).map(([label, value]) => (
                  <div key={label} className="status-card">
                    <span>{label}</span>
                    <strong>{value}</strong>
                  </div>
                ))}
              </div>
            </div>

            <div className="card display-tabs-card">
              <div className="display-tabs">
                {[
                  ['overview', '总览'],
                  ['resume', '简历解析'],
                  ['retrieval', '检索上下文'],
                  ['agents', 'Agent Trace'],
                  ['jd', 'JD 对比'],
                  ['history', '历史记录']
                ].map(([key, label]) => (
                  <button key={key} className={displayTab === key ? 'tab active' : 'tab'} onClick={() => setDisplayTab(key as DisplayTab)}>{label}</button>
                ))}
              </div>

              {displayTab === 'overview' && (
                <div className="display-section">
                  <div className="overview-grid">
                    <div className="detail-card"><span>执行计划</span><strong>{executionPlan.length ? `${executionPlan.length} steps` : '未运行'}</strong></div>
                    <div className="detail-card"><span>Agent 输出</span><strong>{agentOutputs.length}</strong></div>
                    <div className="detail-card"><span>检索片段</span><strong>{retrievalPreview.length}</strong></div>
                    <div className="detail-card"><span>历史 Runs</span><strong>{runs.length}</strong></div>
                  </div>
                  <div className="trace-row compact-trace">
                    {agentCards.map((card) => (
                      <div className={card.output ? 'trace-node active' : 'trace-node'} key={card.name}>
                        <span>{card.name}</span>
                        <small>{card.output ? 'active' : 'idle'}</small>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {displayTab === 'resume' && (
                <div className="display-section">
                  {parseResult ? (
                    <div className="section-list compact">
                      {parseResult.sections.map((section) => (
                        <div key={section.title} className="section-item">
                          <h5>{section.title}</h5>
                          <ul>{section.content.slice(0, 5).map((item, idx) => <li key={idx}>{item}</li>)}</ul>
                        </div>
                      ))}
                    </div>
                  ) : <p className="empty">解析简历后，这里会展示识别出的模块和风险术语。</p>}
                  {parseResult?.risks?.length ? <div className="chip-wrap">{parseResult.risks.map((risk) => <span key={risk.term} className="chip danger">{risk.term}</span>)}</div> : null}
                </div>
              )}

              {displayTab === 'retrieval' && (
                <div className="display-section">
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
                </div>
              )}

              {displayTab === 'agents' && (
                <div className="display-section">
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
                </div>
              )}

              {displayTab === 'jd' && (
                <div className="display-section">
                  {jobs.length > 0 && (
                    <div className="jd-input-row">
                      <select className="jd-job-select" value={selectedJobId} onChange={(e) => pickJob(e.target.value)}>
                        <option value="">— 从已抓取岗位库选择 —</option>
                        {jobs.map((job) => (
                          <option key={job.id} value={job.id}>
                            {[job.title, job.company].filter(Boolean).join(' · ') || job.id}
                          </option>
                        ))}
                      </select>
                    </div>
                  )}
                  <div className="jd-input-row">
                    <input className="jd-url-input" value={jdUrl} onChange={(e) => setJdUrl(e.target.value)} placeholder="粘贴岗位链接，自动抓取 JD 正文（动态渲染站点可能抓不到）。" />
                    <button onClick={fetchJdFromUrl} disabled={!jdUrl.trim()}>抓取链接</button>
                  </div>
                  <div className="jd-input-row">
                    <textarea className="jd-input" value={jdText} onChange={(e) => { setJdText(e.target.value); setSelectedJobId(''); }} placeholder="粘贴目标岗位的 JD（每行一条要求效果最佳），点击对比。" />
                    <button onClick={matchJd} disabled={(!jdText.trim() && !selectedJobId) || !resumeText.trim()}>对比岗位匹配度</button>
                  </div>
                  {jdResult ? (
                    <div className="jd-result">
                      <div className="jd-score-row">
                        <div className="jd-score-ring">
                          <strong>{jdResult.matchScore}</strong>
                          <small>/ 100</small>
                        </div>
                        <div className="jd-score-meta">
                          <p>匹配 <strong>{(jdResult.matched || []).length}</strong> 项 · 缺口 <strong>{(jdResult.gaps || []).length}</strong> 项</p>
                          <span className={jdResult.mode === 'live' ? 'chip ok' : 'chip'}>{jdResult.mode === 'live' ? 'LLM 分析' : '向量兜底'}</span>
                        </div>
                      </div>
                      {jdResult.gapReport && (
                        <div className="jd-gap-report">
                          <h5>差距报告</h5>
                          <p className="jd-gap-summary">{jdResult.gapReport.summary}</p>
                          <div className="jd-keyword-groups">
                            <div className="jd-keyword-col">
                              <span className="jd-keyword-label">命中关键词</span>
                              {(jdResult.gapReport.matchedKeywords || []).length
                                ? <div className="jd-keyword-tags">{jdResult.gapReport.matchedKeywords.map((k, i) => <span key={i} className="jd-tag ok">{k}</span>)}</div>
                                : <p className="empty">无</p>}
                            </div>
                            <div className="jd-keyword-col">
                              <span className="jd-keyword-label">缺失关键词</span>
                              {(jdResult.gapReport.missingKeywords || []).length
                                ? <div className="jd-keyword-tags">{jdResult.gapReport.missingKeywords.map((k, i) => <span key={i} className="jd-tag miss">{k}</span>)}</div>
                                : <p className="empty">无</p>}
                            </div>
                          </div>
                        </div>
                      )}
                      <div className="jd-columns">
                        <div className="jd-col">
                          <h5>已匹配</h5>
                          {(jdResult.matched || []).length ? <ul>{jdResult.matched.map((m: string, i: number) => <li key={i} className="jd-matched">{m}</li>)}</ul> : <p className="empty">暂无匹配项。</p>}
                        </div>
                        <div className="jd-col">
                          <h5>缺口</h5>
                          {(jdResult.gaps || []).length ? <ul>{jdResult.gaps.map((g: string, i: number) => <li key={i} className="jd-gap">{g}</li>)}</ul> : <p className="empty">无明显缺口。</p>}
                        </div>
                      </div>
                      <div className="jd-suggestions">
                        <h5>简历补强建议</h5>
                        <ul>{(jdResult.suggestions || []).map((s: string, i: number) => <li key={i}>{s}</li>)}</ul>
                      </div>
                    </div>
                  ) : <p className="empty">粘贴岗位描述并点击对比，这里会展示匹配度、匹配点、缺口与补强建议。</p>}
                  <div className="jd-history">
                    <h5>历史匹配记录</h5>
                    {jobMatches.length ? (
                      <div className="risk-list">
                        {jobMatches.map((m) => (
                          <div className="risk-item" key={m.id}>
                            <strong>{m.job?.title || m.job?.company || '未命名岗位'} · {m.matchScore}/100</strong>
                            <p>{m.createdAt}</p>
                            <p>{String(m.job?.text || '').slice(0, 100)}...</p>
                          </div>
                        ))}
                      </div>
                    ) : <p className="empty">还没有匹配历史。</p>}
                  </div>
                </div>
              )}

              {displayTab === 'history' && (
                <div className="display-section history-grid">
                  <div>
                    <h4>最近 Runs</h4>
                    <div className="risk-list">{runs.slice(0, 4).map((run) => <div className="risk-item" key={run.id}><strong>{run.goal || 'No goal'}</strong><p>{run.createdAt}</p></div>)}</div>
                  </div>
                  <div>
                    <h4>Sessions</h4>
                    <div className="risk-list">{sessions.slice(0, 4).map((session) => <div className="risk-item" key={session.id}><strong>{session.title}</strong><p>turns: {(session.turns || []).length}</p></div>)}</div>
                  </div>
                </div>
              )}
            </div>
          </section>
        </main>
      )}

      {tab === 'resumes' && (
        <main className="grid grid-wide detail-layout">
          <section className="card">
            <div className="resume-list-head">
              <h2>Resume 列表页</h2>
              <div className="resume-list-actions">
                <span className="resume-compare-count">已选 {compareIds.length} 份</span>
                <button onClick={compareResumes} disabled={compareIds.length < 2}>对比所选简历</button>
                {compareIds.length > 0 && <button className="secondary-button" onClick={() => setCompareIds([])}>清空</button>}
              </div>
            </div>
            <div className="risk-list">
              {resumes.length ? resumes.map((resume) => (
                <div className={compareIds.includes(resume.id) ? 'risk-item resume-item selected' : 'risk-item resume-item'} key={resume.id}>
                  <label className="resume-check">
                    <input type="checkbox" checked={compareIds.includes(resume.id)} onChange={() => toggleCompare(resume.id)} />
                    <strong>{resume.title || resume.id}</strong>
                  </label>
                  <p>{resume.createdAt}</p>
                  <p>{(resume.text || '').slice(0, 120)}...</p>
                  <div className="resume-item-actions">
                    <button onClick={() => openResume(resume.id)}>查看详情</button>
                    <button className="secondary-button" onClick={() => renameResume(resume.id, resume.title || resume.id)}>重命名</button>
                    <button className="danger-button" onClick={() => deleteResume(resume.id)}>删除</button>
                  </div>
                </div>
              )) : <p className="empty">还没有简历记录。</p>}
            </div>
          </section>
          <section className="card tall">
            <div className="tab-row resume-view-tabs">
              <button className={resumeView === 'detail' ? 'tab active' : 'tab'} onClick={() => setResumeView('detail')}>简历详情</button>
              <button className={resumeView === 'compare' ? 'tab active' : 'tab'} onClick={() => setResumeView('compare')}>简历对比</button>
            </div>
            {resumeView === 'compare'
              ? <ResumeComparePanel comparison={comparison} />
              : <ResumeDetailPanel resume={selectedResume} />}
          </section>
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
                  <h4>LLM Readiness</h4>
                  {llmReadiness ? (
                    <div className="detail-grid two-col">
                      <div className="detail-card"><span>Mode</span><strong>{llmReadiness.mode}</strong></div>
                      <div className="detail-card"><span>Configured</span><strong>{String(llmReadiness.configured)}</strong></div>
                      <div className="detail-card"><span>Model</span><strong>{llmReadiness.model}</strong></div>
                      <div className="detail-card"><span>Base URL</span><strong>{llmReadiness.baseUrl}</strong></div>
                    </div>
                  ) : <p className="empty">加载中...</p>}
                  {llmReadiness?.notes?.length ? <ul>{llmReadiness.notes.map((note: string) => <li key={note}>{note}</li>)}</ul> : null}
                </div>
                <div className="detail-block">
                  <h4>LLM Cost & Latency</h4>
                  {llmMetrics ? (
                    <>
                      <div className="detail-grid two-col">
                        <div className="detail-card"><span>Runs (with LLM)</span><strong>{llmMetrics.overview.runs} / {llmMetrics.overview.runsWithLlm}</strong></div>
                        <div className="detail-card"><span>LLM Calls</span><strong>{llmMetrics.overview.calls}</strong></div>
                        <div className="detail-card"><span>Live / Fallback</span><strong>{llmMetrics.overview.liveCalls} / {llmMetrics.overview.fallbackCalls}</strong></div>
                        <div className="detail-card"><span>Errors</span><strong>{llmMetrics.overview.errorCalls}</strong></div>
                        <div className="detail-card"><span>Total Latency</span><strong>{llmMetrics.overview.totalLatencyMs} ms</strong></div>
                        <div className="detail-card"><span>Avg Latency</span><strong>{llmMetrics.overview.avgLatencyMs} ms</strong></div>
                        <div className="detail-card"><span>Total Tokens</span><strong>{llmMetrics.overview.totalTokens}</strong></div>
                        <div className="detail-card"><span>Est. Cost</span><strong>${llmMetrics.overview.costUsd.toFixed(4)}</strong></div>
                        <div className="detail-card"><span>Latest Run</span><strong>{llmMetrics.overview.latestRunAt || '—'}</strong></div>
                      </div>
                      {llmMetrics.overview.calls === 0 ? (
                        <p className="empty">还没有采集到 LLM 调用（fallback 模式不产生 token/成本）。配置 OPENAI_API_KEY 并运行 workflow 后即可看到成本与延迟聚合。</p>
                      ) : (
                        <>
                          <h5>按模型</h5>
                          <table className="llm-metric-table">
                            <thead>
                              <tr><th>Model</th><th>Calls</th><th>Live</th><th>Tokens</th><th>Avg ms</th><th>Cost</th></tr>
                            </thead>
                            <tbody>
                              {llmMetrics.byModel.map((row) => (
                                <tr key={row.model}>
                                  <td>{row.model}</td>
                                  <td>{row.calls}</td>
                                  <td>{row.liveCalls}</td>
                                  <td>{row.totalTokens}</td>
                                  <td>{row.avgLatencyMs}</td>
                                  <td>${row.costUsd.toFixed(4)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                          <h5>按 Agent</h5>
                          <table className="llm-metric-table">
                            <thead>
                              <tr><th>Agent</th><th>Calls</th><th>Errors</th><th>Tokens</th><th>Total ms</th><th>Cost</th></tr>
                            </thead>
                            <tbody>
                              {llmMetrics.byAgent.map((row) => (
                                <tr key={row.agent}>
                                  <td>{row.agent}</td>
                                  <td>{row.calls}</td>
                                  <td>{row.errorCalls}</td>
                                  <td>{row.totalTokens}</td>
                                  <td>{row.totalLatencyMs}</td>
                                  <td>${row.costUsd.toFixed(4)}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </>
                      )}
                      <p className="metric-footnote">定价来源：{llmMetrics.pricing.source === 'env' ? 'LLM_PRICING 环境变量' : '内置默认'}（{llmMetrics.pricing.unit}）。</p>
                    </>
                  ) : <p className="empty">加载中...</p>}
                </div>
                <div className="detail-block">
                  <h4>Eval Notes</h4>
                  <ul>{(dashboard.evalNotes || []).map((note: string) => <li key={note}>{note}</li>)}</ul>
                </div>
                <div className="detail-block">
                  <h4>Session Trend</h4>
                  <div className="risk-list">{(dashboard.trend || []).map((item) => <div className="risk-item" key={item.title + item.createdAt}><strong>{item.title}</strong><p>{item.createdAt}</p><p>turns: {item.turns}</p></div>)}</div>
                </div>
                <div className="detail-block">
                  <h4>Retrieval Samples</h4>
                  <div className="risk-list">{(dashboard.retrievalSamples || []).map((sample, idx) => <div className="risk-item" key={idx}><strong>{sample.session}</strong><p>{sample.question}</p><ul>{(sample.retrieved || []).map((r, i) => <li key={i}>[{r.source || 'resume'}] score={r.score} {String(r.content || '').slice(0, 100)}...</li>)}</ul></div>)}</div>
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
