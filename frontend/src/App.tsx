import { useEffect, useRef, useState } from 'react';
import ResumeDetailPanel from './components/ResumeDetailPanel';
import RunDetailPanel from './components/RunDetailPanel';
import SessionDetailPanel from './components/SessionDetailPanel';
import { buildSectionBlocks } from './utils/sectionBlocks';
import InterviewWorkspace from './features/interview/InterviewWorkspace';
import { useInterviewWorkflow } from './features/interview/useInterviewWorkflow';
import ResumeGenerationWorkspace from './features/resume-generation/ResumeGenerationWorkspace';
import JobMatchWorkspace from './features/job-match/JobMatchWorkspace';
import { useJobMatch } from './features/job-match/useJobMatch';
import { useResumeGeneration } from './features/resume-generation/useResumeGeneration';
import { resumePilotApi } from './services/resumePilotApi';
import type {
  Dashboard,
  LlmMetrics,
  LlmReadiness,
  ParseResult,
  QdrantReadiness,
  Resume,
    Run,
    RunEvent,
  Session
} from './types/domain';

type Tab = 'workspace' | 'resumes' | 'sessions' | 'dashboard';
type DisplayTab = 'overview' | 'resume' | 'generated' | 'jd';
const MAIN_NAV_ITEMS: Array<{ key: string; label: string; target: Tab; displayTab?: DisplayTab }> = [
  { key: 'workbench', label: '工作台', target: 'workspace', displayTab: 'overview' },
  { key: 'resumes', label: '简历库', target: 'resumes' },
  { key: 'sessions', label: '面试记录', target: 'sessions' },
  { key: 'diagnostics', label: '管理与诊断', target: 'dashboard' }
];

const WORKBENCH_TABS: Array<[DisplayTab, string]> = [
  ['overview', '当前进度'],
  ['resume', '简历内容'],
  ['generated', '简历生成'],
  ['jd', '岗位匹配']
];

const WORKSPACE_STATE_KEY = 'resumepilot.workspaceState';
const DEFAULT_GOAL = '请围绕项目经历生成可深挖的面试问题';
const TAB_VALUES: Tab[] = ['workspace', 'resumes', 'sessions', 'dashboard'];
const DISPLAY_TAB_VALUES: DisplayTab[] = ['overview', 'resume', 'generated', 'jd'];

interface PersistedWorkspaceState {
  tab?: Tab;
  displayTab?: DisplayTab;
  resumeId?: string | null;
  sessionId?: string | null;
  runId?: string | null;
  goal?: string;
  answerDraft?: string;
  jdText?: string;
  jdUrl?: string;
  selectedJobId?: string;
  generationAdjustment?: string;
}

function readPersistedWorkspaceState(): PersistedWorkspaceState {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(WORKSPACE_STATE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as PersistedWorkspaceState;
    return {
      ...parsed,
      tab: parsed.tab && TAB_VALUES.includes(parsed.tab) ? parsed.tab : undefined,
      displayTab: parsed.displayTab && DISPLAY_TAB_VALUES.includes(parsed.displayTab) ? parsed.displayTab : undefined
    };
  } catch {
    return {};
  }
}

function resumeToParseResult(resume: Resume): ParseResult {
  return {
    resumeId: resume.id,
    text: resume.text || '',
    sections: resume.sections || [],
    risks: resume.risks || [],
    kbSize: resume.kbSize || 0,
    vectorProvider: resume.vectorProvider || 'memory',
    chunks: resume.chunks || []
  };
}

export default function App() {
  const [persistedState] = useState(() => readPersistedWorkspaceState());
  const [workspaceRestored, setWorkspaceRestored] = useState(false);
  const [resumeText, setResumeText] = useState('');
  const [parseResult, setParseResult] = useState<ParseResult | null>(null);
  const [goal, setGoal] = useState(persistedState.goal || DEFAULT_GOAL);
  const [loading, setLoading] = useState<string | null>(null);
  const [resumes, setResumes] = useState<Resume[]>([]);
  const [runs, setRuns] = useState<Run[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [selectedResume, setSelectedResume] = useState<Resume | null>(null);
  const [selectedRun, setSelectedRun] = useState<Run | null>(null);
  const [selectedSession, setSelectedSession] = useState<Session | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [qdrantReadiness, setQdrantReadiness] = useState<QdrantReadiness | null>(null);
  const [llmReadiness, setLlmReadiness] = useState<LlmReadiness | null>(null);
  const [llmMetrics, setLlmMetrics] = useState<LlmMetrics | null>(null);
  const [tab, setTab] = useState<Tab>(persistedState.tab || 'workspace');
  const [displayTab, setDisplayTab] = useState<DisplayTab>(persistedState.displayTab || 'overview');
  const [importNotice, setImportNotice] = useState('');
  const currentRoundRef = useRef<HTMLElement | null>(null);
  const activeResumeId = parseResult?.resumeId || selectedSession?.resumeId || selectedResume?.id || null;
  const jobMatch = useJobMatch({
    initialText: persistedState.jdText,
    initialUrl: persistedState.jdUrl,
    initialJobId: persistedState.selectedJobId,
    resumeText,
    resumeId: parseResult?.resumeId || selectedSession?.resumeId || null,
    setLoading
  });
  const resumeGeneration = useResumeGeneration({
    initialAdjustment: persistedState.generationAdjustment,
    resumeId: activeResumeId,
    selectedJobId: jobMatch.selectedJobId,
    jdText: jobMatch.jdText,
    jdResult: jobMatch.result,
    jobs: jobMatch.jobs,
    setLoading,
    showGenerated: () => setDisplayTab('generated')
  });
  const {
    jdText,
    jdUrl,
    selectedJobId,
    result: jdResult,
    history: jobMatches,
    jobs
  } = jobMatch;
  const {
    adjustment: generationAdjustment,
    preview: generationPreview,
    versions: resumeVersions,
    exportNotice,
    exportingFormat,
    density: previewDensity,
    hasUnsavedChanges: hasUnsavedResumeChanges
  } = resumeGeneration;
  const interview = useInterviewWorkflow({
    initialAnswer: persistedState.answerDraft,
    goal,
    selectedSession,
    setLoading,
    upsertRun,
    appendRunEvent
  });
  const {
    activeQuestion,
    setActiveQuestion,
    answerDraft,
    setAnswerDraft,
    currentQuestion,
    answeredTurns,
    isListening,
    speechHint,
    progress: agentProgress,
    progressCollapsed: agentProgressCollapsed,
    progressSummary: agentProgressSummary,
    liveProgressId,
    activeProgress,
    completedProgress,
    inspectedProgressId,
    progressListRef: agentProgressListRef
  } = interview;

  useEffect(() => {
    const node = agentProgressListRef.current;
    if (!node || inspectedProgressId) return;
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [agentProgress, inspectedProgressId]);

  useEffect(() => {
    if (tab !== 'workspace' || displayTab !== 'overview' || !selectedSession?.id) return;
    const frame = window.requestAnimationFrame(() => {
      currentRoundRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [tab, displayTab, selectedSession?.id, currentQuestion]);

  function upsertRun(run: Run) {
    setRuns((current) => {
      const exists = current.some((item) => item.id === run.id);
      const next = exists ? current.map((item) => item.id === run.id ? { ...item, ...run } : item) : [run, ...current];
      return next.slice(0, 20);
    });
    setSelectedRun((current) => current?.id === run.id || !current ? { ...(current || run), ...run } : current);
  }

  function appendRunEvent(runId: string, event: RunEvent) {
    setSelectedRun((current) => {
      if (!current || current.id !== runId) return current;
      const runEvents = [...(current.runEvents || []), event].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
      return { ...current, status: event.status || current.status, runEvents };
    });
    setRuns((current) => current.map((run) => {
      if (run.id !== runId) return run;
      const runEvents = [...(run.runEvents || []), event].sort((a, b) => (a.sequence || 0) - (b.sequence || 0));
      return { ...run, status: event.status || run.status, runEvents };
    }));
  }

  async function parseResume(file?: File) {
    setLoading('正在解析简历...');
    setImportNotice('');
    const form = new FormData();
    if (file) form.append('resume', file);
    if (resumeText.trim()) form.append('text', resumeText);
    const res = await fetch('/api/parse', { method: 'POST', body: form });
    const data = await res.json();
    if (!res.ok || data.error) {
      setLoading(null);
      setImportNotice(data.error || '简历解析失败，请换一个文件重试。');
      return;
    }
    setParseResult(data);
    setResumeText(data.text);
    if (data.reusedExisting) {
      setImportNotice('检测到这份简历已经导入过，已直接复用已有记录，没有新增重复简历。');
    }
    setDisplayTab('resume');
    setLoading(null);
    loadResumes();
    loadDashboard();
  }

  async function runAgents() {
    if (!resumeText.trim()) return;
    setLoading('正在启动流式 Agent 协作...');
    setDisplayTab('overview');
    interview.resetProgress('connect');
    setSelectedSession(null);
    setActiveQuestion('');
    setAnswerDraft('');
    const data = await interview.streamAgent({ text: resumeText, goal, answer: '', history: [], sessionId: null, startNewSession: true, resumeId: parseResult?.resumeId || selectedSession?.resumeId || null }) as Record<string, any>;
    setActiveQuestion(data.questions?.detail?.[0] || data.questions?.basic?.[0] || '');
    setDisplayTab('overview');
    setLoading(null);
    await loadRuns();
    await loadSessions();
    await loadDashboard();
    await loadLlmMetrics();
      if (data.runId) await openRun(data.runId);
      if (data.sessionId) await openSession(data.sessionId);
  }

  async function retryRun(run: Run) {
    setLoading('正在重新执行流式 Agent 协作...');
    const data = await interview.streamAgent({
      text: resumeText,
      goal: run.goal || goal,
      answer: '',
      history: [],
      sessionId: null,
      resumeId: run.resumeId || parseResult?.resumeId || selectedSession?.resumeId || null
    }) as Record<string, any>;
    setLoading(null);
    await loadRuns();
    await loadDashboard();
    await loadLlmMetrics();
    if (data.runId) await openRun(data.runId);
  }

  async function continueSession(payload: { text: string; answer: string }) {
    if (!selectedSession?.id) return;
    setLoading('正在分析回答并生成追问...');
    setDisplayTab('overview');
    interview.resetProgress('submit');
    const data = await interview.streamContinue({ ...payload, resumeId: parseResult?.resumeId || selectedSession?.resumeId || null });
    if (!data) return;
    setSelectedSession(data.session || null);
    setActiveQuestion(data.questions?.detail?.[0] || data.questions?.basic?.[0] || '');
    setAnswerDraft('');
    setDisplayTab('overview');
    setLoading(null);
    await loadSessions();
    await loadDashboard();
  }

  async function loadResumes() { setResumes(await resumePilotApi.listResumes()); }
  async function loadRuns() { setRuns(await resumePilotApi.listRuns()); }
  async function loadSessions() { setSessions(await resumePilotApi.listSessions()); }
  async function loadDashboard() { setDashboard(await resumePilotApi.dashboard()); }
  async function loadQdrantReadiness() { setQdrantReadiness(await resumePilotApi.qdrantReadiness()); }
  async function loadLlmReadiness() { setLlmReadiness(await resumePilotApi.llmReadiness()); }
  async function loadLlmMetrics() { setLlmMetrics(await resumePilotApi.llmMetrics()); }
  async function openResume(id: string) {
    const resume = await resumePilotApi.getResume(id);
    setSelectedResume(resume);
    if (resume) {
      setResumeText(resume.text || '');
      setParseResult(resumeToParseResult(resume));
    }
  }
  async function handleCorrectionSaved(resume: Resume) {
    setSelectedResume(resume);
    setResumeText(resume.text || '');
    setParseResult(resumeToParseResult(resume));
    await loadResumes();
    await loadDashboard();
  }

  async function renameResume(id: string, current: string) {
    const title = window.prompt('输入简历的新名称：', current);
    if (title === null) return;
    await resumePilotApi.renameResume(id, title);
    await loadResumes();
    if (selectedResume?.id === id) openResume(id);
  }

  async function deleteResume(id: string) {
    if (!window.confirm('确认删除这份简历？该操作不可撤销。')) return;
    await resumePilotApi.deleteResume(id);
    if (selectedResume?.id === id || parseResult?.resumeId === id) {
      setSelectedResume(null);
      setParseResult(null);
      setResumeText('');
    }
    await loadResumes();
    await loadDashboard();
  }
  async function openRun(id: string) { setSelectedRun(await resumePilotApi.getRun(id)); }
  async function openSession(id: string) {
    const session = await resumePilotApi.getSession(id);
    setSelectedSession(session);
    if (session?.resumeId && session.resumeId !== parseResult?.resumeId) {
      await openResume(session.resumeId);
    }
  }

  async function createSession() {
    const session = await resumePilotApi.createSession({ title: goal, goal, resumeId: parseResult?.resumeId || null });
    await loadSessions();
    setSelectedSession(session || null);
    setTab('workspace');
  }

  useEffect(() => {
    let cancelled = false;

    async function bootstrap() {
      await Promise.all([
        loadResumes(),
        loadRuns(),
        loadSessions(),
        loadDashboard(),
        loadQdrantReadiness(),
        loadLlmReadiness(),
        loadLlmMetrics(),
        jobMatch.loadHistory(),
        jobMatch.loadJobs()
      ]);

      if (cancelled) return;
      try {
        if (persistedState.resumeId) await openResume(persistedState.resumeId);
        if (persistedState.sessionId) await openSession(persistedState.sessionId);
        if (persistedState.runId) await openRun(persistedState.runId);
      } finally {
        if (!cancelled) setWorkspaceRestored(true);
      }
    }

    bootstrap();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (!workspaceRestored || typeof window === 'undefined') return;

    const state: PersistedWorkspaceState = {
      tab,
      displayTab,
      resumeId: parseResult?.resumeId || selectedResume?.id || selectedSession?.resumeId || null,
      sessionId: selectedSession?.id || null,
      runId: selectedRun?.id || null,
      goal,
      answerDraft,
      jdText,
      jdUrl,
      selectedJobId,
      generationAdjustment
    };
    window.localStorage.setItem(WORKSPACE_STATE_KEY, JSON.stringify(state));
  }, [workspaceRestored, tab, displayTab, parseResult?.resumeId, selectedResume?.id, selectedSession?.id, selectedSession?.resumeId, selectedRun?.id, goal, answerDraft, jdText, jdUrl, selectedJobId, generationAdjustment]);

  return (
    <div className="page">
      <section className="card intro-card">
        <div className="tab-row">
          {MAIN_NAV_ITEMS.map((item) => {
            const active = item.key === 'workbench'
              ? tab === 'workspace'
              : tab === item.target && (!item.displayTab || displayTab === item.displayTab);
            return (
              <button
                key={item.key}
                className={active ? 'tab active' : 'tab'}
                onClick={() => {
                  setTab(item.target);
                  if (item.displayTab) setDisplayTab(item.displayTab);
                }}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      </section>

      {tab === 'workspace' && (
        <main className="workspace-shell">
          <aside className="card control-panel">
            <div className="panel-heading">
              <p className="eyebrow">准备流程</p>
              <h2>操作台</h2>
              <p>先导入简历并设定目标，再开始一轮模拟面试；有回答后继续追问。</p>
            </div>

            <div className="control-section">
              <div className="step-label"><span>1</span><strong>导入简历</strong></div>
              <label className="upload import-upload">{parseResult ? '重新上传 PDF / TXT' : '上传 PDF / TXT'}<input type="file" accept=".pdf,.txt" onChange={(e) => { const file = e.target.files?.[0]; if (file) parseResume(file); }} /></label>
              {importNotice ? <small className="import-notice">{importNotice}</small> : null}
            </div>

            <div className="control-section">
              <div className="step-label"><span>2</span><strong>设定目标</strong></div>
              <input value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="例如：围绕项目经历生成深挖问题" />
            </div>

            <div className="control-section">
              <div className="step-label"><span>3</span><strong>开始面试</strong></div>
              <div className="primary-actions">
                <button className="action-button primary-action" onClick={runAgents} disabled={!resumeText.trim()}>
                  <strong>开始面试</strong>
                  <span>根据简历和目标生成第一轮问题</span>
                </button>
                {selectedSession ? (
                  <button className="action-button secondary-button" onClick={createSession} disabled={!goal.trim()}>
                    <strong>重开一场面试</strong>
                    <span>清晰区分新的练习记录</span>
                  </button>
                ) : null}
              </div>
            </div>

            <div className="session-card">
              <span>当前面试会话</span>
              {selectedSession ? (
                <>
                  <strong>{selectedSession.title}</strong>
                  <p>{currentQuestion ? `待回答：第 ${answeredTurns + 1} 题` : '当前没有待回答问题'} · 已回答 {answeredTurns} 轮</p>
                </>
              ) : (
                <p>还没有面试会话，点击“开始面试”或“重开一场面试”。</p>
              )}
            </div>
          </aside>

          <section className="display-panel">
            <div className="card display-tabs-card">
              <div className="display-tabs">
                {WORKBENCH_TABS.map(([key, label]) => (
                  <button key={key} className={displayTab === key ? 'tab active' : 'tab'} onClick={() => setDisplayTab(key as DisplayTab)}>{label}</button>
                ))}
              </div>

              {displayTab === 'overview' && (
                <InterviewWorkspace
                  session={selectedSession}
                  currentQuestion={currentQuestion}
                  answeredTurns={answeredTurns}
                  answerDraft={answerDraft}
                  isListening={isListening}
                  speechHint={speechHint}
                  liveProgressId={liveProgressId}
                  progress={agentProgress}
                  progressCollapsed={agentProgressCollapsed}
                  progressSummary={agentProgressSummary}
                  activeProgress={activeProgress || null}
                  completedProgress={completedProgress}
                  inspectedProgressId={inspectedProgressId}
                  currentRoundRef={currentRoundRef}
                  progressListRef={agentProgressListRef}
                  onAnswerChange={setAnswerDraft}
                  onToggleVoice={isListening ? interview.stopVoice : interview.startVoice}
                  onSubmit={() => continueSession({ text: resumeText, answer: answerDraft })}
                  onToggleProgress={() => interview.setProgressCollapsed((value) => !value)}
                  onInspectProgress={interview.setInspectedProgressId}
                />
              )}

              {displayTab === 'resume' && (
                <div className="display-section">
                  {parseResult ? (
                    <div className="resume-parse-view">
                      <div className="detail-block">
                        <h4>识别模块</h4>
                        <div className="section-list compact">
                          {parseResult.sections.length ? parseResult.sections.map((section) => (
                            <div key={section.title} className="section-item">
                              <h5>{section.title}</h5>
                              <div className="section-content">{buildSectionBlocks(section.content).map((block, idx) => <p className={`section-block ${block.kind}`} key={idx}>{block.text}</p>)}</div>
                            </div>
                          )) : <p className="empty">未识别到结构化模块，请重新上传更清晰的简历文件。</p>}
                        </div>
                      </div>
                    </div>
                  ) : <p className="empty">解析简历后，这里会展示识别出的简历模块。</p>}
                  {parseResult?.risks?.length ? <div className="chip-wrap">{parseResult.risks.map((risk) => <span key={risk.term} className="chip danger">{risk.term}</span>)}</div> : null}
                </div>
              )}

              {displayTab === 'generated' && (
                <ResumeGenerationWorkspace
                  preview={generationPreview}
                  adjustment={generationAdjustment}
                  versions={resumeVersions}
                  hasUnsavedChanges={hasUnsavedResumeChanges}
                  exportNotice={exportNotice}
                  exportingFormat={exportingFormat}
                  density={previewDensity}
                  canGenerate={Boolean(parseResult?.resumeId || selectedSession?.resumeId || selectedResume?.id)}
                  onAdjustmentChange={resumeGeneration.setAdjustment}
                  onGenerate={resumeGeneration.generate}
                  onDensityChange={resumeGeneration.setDensity}
                  onResumeChange={resumeGeneration.updateResume}
                  onExportPdf={resumeGeneration.exportPdf}
                  onSaveVersion={resumeGeneration.saveVersion}
                  onExportDocx={resumeGeneration.exportDocx}
                />
              )}

              {displayTab === 'jd' && (
                <JobMatchWorkspace
                  jobs={jobs}
                  selectedJobId={selectedJobId}
                  jdUrl={jdUrl}
                  jdText={jdText}
                  result={jdResult}
                  history={jobMatches}
                  canMatch={Boolean((jdText.trim() || selectedJobId) && resumeText.trim())}
                  onPickJob={jobMatch.pickJob}
                  onUrlChange={jobMatch.setJdUrl}
                  onTextChange={jobMatch.changeText}
                  onFetchUrl={jobMatch.fetchFromUrl}
                  onMatch={jobMatch.match}
                />
              )}

            </div>
          </section>
        </main>
      )}

      {tab === 'resumes' && (
        <main className="grid grid-wide detail-layout resumes-layout">
          <section className="card detail-list-card">
            <div className="resume-list-head">
              <h2>我的简历</h2>
            </div>
            <div className="risk-list">
              {resumes.length ? resumes.map((resume) => (
                <div className="risk-item resume-item" key={resume.id}>
                  <strong>{resume.title || resume.id}</strong>
                  <p>{resume.createdAt}</p>
                  {(resume.duplicateCount || 1) > 1 ? <span className="duplicate-badge">已合并 {resume.duplicateCount} 次重复导入</span> : null}
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
            <ResumeDetailPanel resume={selectedResume} onCorrectionSaved={handleCorrectionSaved} />
          </section>
        </main>
      )}

      {tab === 'sessions' && (
        <main className="grid grid-wide detail-layout sessions-layout">
          <section className="card detail-list-card session-list-card"><h2>面试记录</h2><div className="risk-list">{sessions.length ? sessions.map((session) => <button className="risk-item resume-item clickable-card" key={session.id} onClick={() => openSession(session.id)}><strong>{session.title}</strong><p>{session.createdAt}</p><p>{(session.turns || []).length} 轮追问</p><span className="inline-action">查看详情</span></button>) : <p className="empty">还没有面试记录。</p>}</div></section>
          <section className="card tall session-detail-card"><SessionDetailPanel session={selectedSession} resume={selectedResume || undefined} onResumeSession={() => { setTab('workspace'); setDisplayTab('overview'); }} /></section>
        </main>
      )}

      {tab === 'dashboard' && (
        <main className="grid grid-wide detail-layout">
          <section className="card full">
            <h2>管理与诊断</h2>
            {dashboard ? (
              <div className="detail-stack">
                <div className="detail-block">
                  <h4>运行记录</h4>
                  <div className="risk-list">
                    {runs.length ? runs.slice(0, 8).map((run) => (
                      <div className="risk-item" key={run.id}>
                        <strong>{run.goal || '未设置目标'}</strong>
                        <p>{run.createdAt}</p>
                        <p>{run.skill?.name || run.skillId || '未知能力'} · {run.status || '已完成'}</p>
                        <button onClick={() => openRun(run.id)}>查看诊断</button>
                      </div>
                    )) : <p className="empty">还没有运行记录。</p>}
                  </div>
                </div>
                {selectedRun ? <RunDetailPanel run={selectedRun} onRetry={retryRun} /> : null}
                <div className="detail-grid two-col">
                  <div className="detail-card"><span>简历数</span><strong>{dashboard.overview?.resumes}</strong></div>
                  <div className="detail-card"><span>运行次数</span><strong>{dashboard.overview?.runs}</strong></div>
                  <div className="detail-card"><span>面试记录</span><strong>{dashboard.overview?.sessions}</strong></div>
                  <div className="detail-card"><span>总追问轮次</span><strong>{dashboard.overview?.totalTurns}</strong></div>
                  <div className="detail-card"><span>平均检索质量</span><strong>{dashboard.quality?.avgRetrievalScore}</strong></div>
                  <div className="detail-card"><span>平均追问深度</span><strong>{dashboard.quality?.avgSessionDepth}</strong></div>
                  <div className="detail-card"><span>能力路由次数</span><strong>{dashboard.quality?.skillRoutedRuns}</strong></div>
                  <div className="detail-card"><span>风险覆盖率</span><strong>{dashboard.quality?.riskCoverage}</strong></div>
                  <div className="detail-card"><span>平均反馈长度</span><strong>{dashboard.quality?.avgCritiqueLength}</strong></div>
                  <div className="detail-card"><span>改进回答覆盖率</span><strong>{dashboard.quality?.improvedAnswerCoverage}</strong></div>
                  <div className="detail-card"><span>简历参考占比</span><strong>{dashboard.sourceMix?.resume}</strong></div>
                  <div className="detail-card"><span>历史回答参考占比</span><strong>{dashboard.sourceMix?.session_history}</strong></div>
                </div>
                <div className="detail-block">
                  <h4>人工纠偏统计</h4>
                  <div className="detail-grid two-col">
                    <div className="detail-card"><span>纠偏率</span><strong>{dashboard.correctionMetrics?.correctionRate ?? 0}</strong></div>
                    <div className="detail-card"><span>纠偏简历数</span><strong>{dashboard.correctionMetrics?.correctedResumes ?? 0}</strong></div>
                    <div className="detail-card"><span>纠偏事件</span><strong>{dashboard.correctionMetrics?.totalCorrections ?? 0}</strong></div>
                    <div className="detail-card"><span>模块修改比例</span><strong>{dashboard.correctionMetrics?.sectionChangeRatio ?? 0}</strong></div>
                    <div className="detail-card"><span>平均内容行变化</span><strong>{dashboard.correctionMetrics?.avgLineDelta ?? 0}</strong></div>
                  </div>
                  <div className="correction-error-list">
                    {(dashboard.correctionMetrics?.commonErrorTypes || []).length
                      ? dashboard.correctionMetrics?.commonErrorTypes.map((item) => <span className="chip" key={item.type}>{item.type}: {item.count}</span>)
                      : <p className="empty">还没有人工纠偏事件。</p>}
                  </div>
                </div>
                <div className="detail-block">
                  <h4>向量库状态</h4>
                  {qdrantReadiness ? (
                    <div className="detail-grid two-col">
                      <div className="detail-card"><span>服务类型</span><strong>{qdrantReadiness.provider}</strong></div>
                      <div className="detail-card"><span>配置完成</span><strong>{String(qdrantReadiness.configured)}</strong></div>
                      <div className="detail-card"><span>服务可访问</span><strong>{String(qdrantReadiness.serviceReachable)}</strong></div>
                      <div className="detail-card"><span>集合可访问</span><strong>{String(qdrantReadiness.collectionReachable)}</strong></div>
                      <div className="detail-card"><span>QDRANT_URL</span><strong>{qdrantReadiness.env?.QDRANT_URL || 'not_set'}</strong></div>
                      <div className="detail-card"><span>Collection</span><strong>{qdrantReadiness.env?.QDRANT_COLLECTION}</strong></div>
                    </div>
                  ) : <p className="empty">加载中...</p>}
                  {qdrantReadiness?.notes?.length ? <ul>{qdrantReadiness.notes.map((note: string) => <li key={note}>{note}</li>)}</ul> : null}
                </div>
                <div className="detail-block">
                  <h4>模型服务状态</h4>
                  {llmReadiness ? (
                    <div className="detail-grid two-col">
                      <div className="detail-card"><span>运行模式</span><strong>{llmReadiness.mode}</strong></div>
                      <div className="detail-card"><span>配置完成</span><strong>{String(llmReadiness.configured)}</strong></div>
                      <div className="detail-card"><span>模型</span><strong>{llmReadiness.model}</strong></div>
                      <div className="detail-card"><span>服务地址</span><strong>{llmReadiness.baseUrl}</strong></div>
                    </div>
                  ) : <p className="empty">加载中...</p>}
                  {llmReadiness?.notes?.length ? <ul>{llmReadiness.notes.map((note: string) => <li key={note}>{note}</li>)}</ul> : null}
                </div>
                <div className="detail-block">
                  <h4>模型成本与延迟</h4>
                  {llmMetrics ? (
                    <>
                      <div className="detail-grid two-col">
                        <div className="detail-card"><span>运行 / 模型运行</span><strong>{llmMetrics.overview.runs} / {llmMetrics.overview.runsWithLlm}</strong></div>
                        <div className="detail-card"><span>调用次数</span><strong>{llmMetrics.overview.calls}</strong></div>
                        <div className="detail-card"><span>真实调用 / 兜底</span><strong>{llmMetrics.overview.liveCalls} / {llmMetrics.overview.fallbackCalls}</strong></div>
                        <div className="detail-card"><span>错误次数</span><strong>{llmMetrics.overview.errorCalls}</strong></div>
                        <div className="detail-card"><span>总延迟</span><strong>{llmMetrics.overview.totalLatencyMs} ms</strong></div>
                        <div className="detail-card"><span>平均延迟</span><strong>{llmMetrics.overview.avgLatencyMs} ms</strong></div>
                        <div className="detail-card"><span>Token 总量</span><strong>{llmMetrics.overview.totalTokens}</strong></div>
                        <div className="detail-card"><span>预估成本</span><strong>${llmMetrics.overview.costUsd.toFixed(4)}</strong></div>
                        <div className="detail-card"><span>最近运行</span><strong>{llmMetrics.overview.latestRunAt || '—'}</strong></div>
                      </div>
                      {llmMetrics.overview.calls === 0 ? (
                        <p className="empty">还没有采集到模型调用（兜底模式不产生 token/成本）。配置 OPENAI_API_KEY 并开始一次面试后即可看到成本与延迟聚合。</p>
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
                          <h5>按执行角色</h5>
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
                  <h4>质量评估备注</h4>
                  <ul>{(dashboard.evalNotes || []).map((note: string) => <li key={note}>{note}</li>)}</ul>
                </div>
                <div className="detail-block">
                  <h4>面试趋势</h4>
                  <div className="risk-list">{(dashboard.trend || []).map((item) => <div className="risk-item" key={item.title + item.createdAt}><strong>{item.title}</strong><p>{item.createdAt}</p><p>{item.turns} 轮追问</p></div>)}</div>
                </div>
                <div className="detail-block">
                  <h4>检索样本</h4>
                  <div className="risk-list">{(dashboard.retrievalSamples || []).map((sample, idx) => <div className="risk-item" key={idx}><strong>{sample.session}</strong><p>{sample.question}</p><ul>{(sample.retrieved || []).map((r, i) => <li key={i}>[{r.source || 'resume'}] score={r.score} {String(r.content || '').slice(0, 100)}...</li>)}</ul></div>)}</div>
                </div>
              </div>
            ) : <p className="empty">加载中...</p>}
          </section>
        </main>
      )}

      {loading && !liveProgressId && <div className="loading">{loading}</div>}
    </div>
  );
}
