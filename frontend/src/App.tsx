import { useEffect, useMemo, useRef, useState } from 'react';
import ResumeDetailPanel from './components/ResumeDetailPanel';
import RunDetailPanel from './components/RunDetailPanel';
import SessionDetailPanel from './components/SessionDetailPanel';
import ConversationTimeline from './components/ConversationTimeline';
import { buildSectionBlocks } from './utils/sectionBlocks';
import type {
  Dashboard,
  JdMatchResult,
  JobDescription,
  JobMatch,
  LlmMetrics,
  LlmReadiness,
  ParseResult,
  QdrantReadiness,
  Resume,
  ResumeGenerationPreview,
  ResumeVersion,
    Run,
    RunEvent,
  Session
} from './types/domain';

type Tab = 'workspace' | 'resumes' | 'sessions' | 'dashboard';
type DisplayTab = 'overview' | 'resume' | 'generated' | 'jd';
type PreviewDensity = 'standard' | 'compact' | 'dense';
type SpeechRecognitionResultEvent = Event & {
  resultIndex: number;
  results: ArrayLike<{
    isFinal: boolean;
    0: { transcript: string };
  }>;
};
type SpeechRecognitionInstance = {
  lang: string;
  continuous: boolean;
  interimResults: boolean;
  onresult: ((event: SpeechRecognitionResultEvent) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start: () => void;
  stop: () => void;
};
type AgentProgressStatus = 'running' | 'done' | 'failed';
type AgentProgressStep = {
  id: string;
  title: string;
  detail: string;
  status: AgentProgressStatus;
  note?: string;
  meta?: string[];
  reasoning?: Array<{ label: string; text: string }>;
};

function cleanThoughtText(value?: string) {
  return String(value || '').replace(/^判断：/, '').trim();
}

function compactReasoning(items: Array<{ label: string; text?: unknown }>) {
  return items
    .map((item) => ({ label: item.label, text: String(item.text || '').trim() }))
    .filter((item) => item.text);
}

function reasoningNarrative(step: AgentProgressStep) {
  if (step.reasoning?.length) {
    return step.reasoning.map((item) => `${item.label}：${cleanThoughtText(item.text)}`).join(' ');
  }
  return cleanThoughtText(step.note || step.detail);
}

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
  return Array.isArray(value) ? value.map(asText).filter(Boolean) : [];
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

function GeneratedResumeEditor({ resume, onChange }: { resume: Record<string, unknown>; onChange: (resume: Record<string, unknown>) => void }) {
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

function GeneratedResumeCard({ resume, density }: { resume: Record<string, unknown>; density: PreviewDensity }) {
  const basics = asRecord(resume.basics);
  const work = asRecordList(resume.work);
  const projects = asRecordList(resume.projects);
  const skills = asRecordList(resume.skills);
  const education = asRecordList(resume.education);

  return (
    <div className={`generated-resume-pages density-${density}`}>
      <div className="generated-resume-card">
        <div className="generated-resume-head">
          <div>
            <h5>{asText(basics.name) || '未命名候选人'}</h5>
            {asText(basics.label) ? <p>{asText(basics.label)}</p> : null}
          </div>
          <div className="generated-contact">
            {[asText(basics.email), asText(basics.phone)].filter(Boolean).map((item) => <span key={item}>{item}</span>)}
          </div>
        </div>

        {asText(basics.summary) ? <section className="generated-section"><h6>个人简介</h6><p>{asText(basics.summary)}</p></section> : null}

        {skills.length ? (
          <section className="generated-section">
            <h6>技能</h6>
            <div className="generated-skill-list">
              {skills.map((item, index) => (
                <div className="generated-skill" key={`${asText(item.name)}-${index}`}>
                  <strong>{asText(item.name) || '技能'}</strong>
                  <div className="chip-wrap">{asTextList(item.keywords).map((keyword) => <span className="chip" key={keyword}>{keyword}</span>)}</div>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        {education.length ? (
          <section className="generated-section">
            <h6>教育经历</h6>
            {education.map((item, index) => (
              <article className="generated-item" key={`${asText(item.institution)}-${index}`}>
                <div className="generated-item-title">
                  <strong>{[asText(item.institution), asText(item.area), asText(item.studyType)].filter(Boolean).join(' · ') || '教育经历'}</strong>
                  {periodOf(item) ? <span>{periodOf(item)}</span> : null}
                </div>
              </article>
            ))}
          </section>
        ) : null}

        {work.length ? (
          <section className="generated-section">
            <h6>工作经历</h6>
            {work.map((item, index) => (
              <article className="generated-item" key={`${asText(item.name)}-${index}`}>
                <div className="generated-item-title">
                  <strong>{[asText(item.name), asText(item.position)].filter(Boolean).join(' · ') || '未命名经历'}</strong>
                  {periodOf(item) ? <span>{periodOf(item)}</span> : null}
                </div>
                {asText(item.summary) ? <p className="generated-summary">{asText(item.summary)}</p> : null}
                {uniqueHighlights(item.highlights, asText(item.summary)).length ? <ul>{uniqueHighlights(item.highlights, asText(item.summary)).map((line, idx) => <li key={idx}>{line}</li>)}</ul> : null}
              </article>
            ))}
          </section>
        ) : null}

        {projects.length ? (
          <section className="generated-section">
            <h6>项目经历</h6>
            {projects.map((item, index) => (
              <article className="generated-item" key={`${asText(item.name)}-${index}`}>
                <div className="generated-item-title">
                  <strong>{asText(item.name) || '未命名项目'}</strong>
                  {periodOf(item) ? <span>{periodOf(item)}</span> : null}
                </div>
                {asText(item.description) ? <p className="generated-summary">{asText(item.description)}</p> : null}
                {uniqueHighlights(item.highlights, asText(item.description)).length ? <ul>{uniqueHighlights(item.highlights, asText(item.description)).map((line, idx) => <li key={idx}>{line}</li>)}</ul> : null}
              </article>
            ))}
          </section>
        ) : null}
      </div>
    </div>
  );
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
  const [activeQuestion, setActiveQuestion] = useState('');
  const [answerDraft, setAnswerDraft] = useState(persistedState.answerDraft || '');
  const [activeCritique, setActiveCritique] = useState<string[]>([]);
  const [activeImproved, setActiveImproved] = useState('');
  const [jdText, setJdText] = useState(persistedState.jdText || '');
  const [jdResult, setJdResult] = useState<JdMatchResult | null>(null);
  const [jobMatches, setJobMatches] = useState<JobMatch[]>([]);
  const [jobs, setJobs] = useState<JobDescription[]>([]);
  const [selectedJobId, setSelectedJobId] = useState<string>(persistedState.selectedJobId || '');
  const [jdUrl, setJdUrl] = useState(persistedState.jdUrl || '');
  const [generationAdjustment, setGenerationAdjustment] = useState(persistedState.generationAdjustment || '');
  const [generationPreview, setGenerationPreview] = useState<ResumeGenerationPreview | null>(null);
  const [resumeVersions, setResumeVersions] = useState<ResumeVersion[]>([]);
  const [previewDensity, setPreviewDensity] = useState<PreviewDensity>('compact');
  const [isListening, setIsListening] = useState(false);
  const [speechHint, setSpeechHint] = useState('');
  const [importNotice, setImportNotice] = useState('');
  const [agentProgress, setAgentProgress] = useState<AgentProgressStep[]>([]);
  const [agentProgressCollapsed, setAgentProgressCollapsed] = useState(false);
  const [inspectedProgressId, setInspectedProgressId] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const voiceStopRequestedRef = useRef(false);
  const agentProgressListRef = useRef<HTMLDivElement | null>(null);

  const currentQuestion = useMemo(() => {
    const turns = selectedSession?.turns || [];
    const pendingTurn = [...turns].reverse().find((turn) => turn.question && !String(turn.answer || '').trim());
    return pendingTurn?.question || activeQuestion || '';
  }, [activeQuestion, selectedSession]);

  const answeredTurns = useMemo(() => (selectedSession?.turns || []).filter((turn) => String(turn.answer || '').trim()).length, [selectedSession]);
  const agentProgressSummary = useMemo(() => {
    const done = agentProgress.filter((step) => step.status === 'done').length;
    const running = agentProgress.find((step) => step.status === 'running');
    return running ? `正在处理：${running.title}` : `${done}/${agentProgress.length} 个步骤已完成`;
  }, [agentProgress]);
  const liveProgressId = useMemo(() => agentProgress.find((step) => step.status === 'running')?.id || null, [agentProgress]);
  const expandedProgressId = inspectedProgressId || liveProgressId;

  useEffect(() => {
    const node = agentProgressListRef.current;
    if (!node || inspectedProgressId) return;
    node.scrollTo({ top: node.scrollHeight, behavior: 'smooth' });
  }, [agentProgress, inspectedProgressId]);

  function updateAgentProgress(step: AgentProgressStep) {
    setAgentProgress((current) => {
      const exists = current.some((item) => item.id === step.id);
      const next = exists ? current.map((item) => item.id === step.id ? { ...item, ...step } : item) : [...current, step];
      return next.slice(-12);
    });
  }

  function completeProgress(id: string, detail?: string) {
    setAgentProgress((current) => current.map((item) => item.id === id ? { ...item, status: 'done', detail: detail || item.detail } : item));
  }

  function progressFromRunEvent(event: RunEvent) {
    const payload = (event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)) ? event.payload as Record<string, any> : {};
    if (event.type === 'run_start') {
      updateAgentProgress({
        id: 'start',
        title: '启动协作流程',
        detail: '正在读取目标、简历和历史上下文。',
        note: '先确认本轮任务的输入边界：目标是什么、是否已有回答、需要引用哪份简历和哪段历史。',
        reasoning: compactReasoning([
          { label: '输入识别', text: `目标：${goal || '模拟面试'}。` },
          { label: '边界确认', text: '先确认本轮是否已有回答，以及应引用哪份简历和哪场面试历史。' },
          { label: '下一步', text: '把上下文交给 planner/retriever，避免后续问题脱离事实。' }
        ]),
        status: 'running'
      });
    }
    if (event.type === 'memory_loaded') {
      completeProgress('start', `已读取 ${payload.total ?? 0} 条相关记忆。`);
    }
    if (event.type === 'step_start') {
      const labels: Record<string, [string, string]> = {
        parser: ['解析简历内容', '把原始简历拆成可被追问和验证的结构化模块。'],
        planner: ['制定出题计划', '判断当前最该深挖背景、项目、技术细节还是表达质量。'],
        retriever: ['检索相关经历', '从简历和历史问答中找出本轮回答必须对齐的事实依据。'],
        interviewer: ['生成面试问题', '基于目标和依据形成下一轮追问方向。'],
        critic: ['分析你的回答', '判断回答是否具体、可信、贴合问题，并找出薄弱点。'],
        writer: ['整理反馈表达', '把评估结论转成更适合面试场景的回答表达。']
      };
      const [title, detail] = labels[event.agent || ''] || ['执行协作步骤', 'Agent 正在处理当前任务。'];
      updateAgentProgress({
        id: event.agent || `step-${event.sequence}`,
        title,
        detail,
        note: detail,
        reasoning: compactReasoning([
          { label: '当前任务', text: detail },
          { label: '处理方式', text: event.agent === 'retriever' ? '先召回简历和历史回答中的事实片段。' : event.agent === 'critic' ? '把用户回答和事实依据逐项对比。' : event.agent === 'interviewer' ? '根据薄弱点和高价值经历生成追问。' : '读取共享上下文，形成下一步判断。' }
        ]),
        status: 'running'
      });
    }
    if (event.type === 'rag_retrieval') {
      const count = Array.isArray(payload.retrieved) ? payload.retrieved.length : 0;
      const evidence = Array.isArray(payload.retrieved)
        ? payload.retrieved.slice(0, 3).map((item: Record<string, unknown>) => String(item.content || '').slice(0, 90)).filter(Boolean)
        : [];
      updateAgentProgress({
        id: 'retriever',
        title: '检索相关经历',
        detail: `已召回 ${count} 条可参考经历，准备交给面试官 Agent。`,
        note: `本轮回答需要优先围绕这 ${count} 条经历判断是否贴合事实，避免脱离简历内容泛泛而谈。`,
        meta: evidence,
        reasoning: compactReasoning([
          { label: '检索问题', text: `围绕「${goal || '当前面试目标'}」查找可引用经历。` },
          { label: '依据来源', text: `${payload.kbSource || '简历知识库'}，向量引擎 ${payload.vectorProvider || 'memory'}。` },
          { label: '筛选结果', text: `取回 ${count} 条候选片段，优先用于检查回答是否贴合事实。` }
        ]),
        status: 'done'
      });
    }
    if (event.type === 'agent_observation') {
      updateAgentProgress({
        id: event.agent || `observation-${event.sequence}`,
        title: event.agent === 'interviewer' ? '生成面试问题' : event.agent === 'planner' ? '制定出题计划' : event.agent === 'retriever' ? '检索相关经历' : '完成协作步骤',
        detail: '该 Agent 已形成阶段性结论。',
        note: payload.observation || payload.proposal || '该 Agent 已完成当前步骤。',
        meta: [
          payload.proposal ? `下一步依据：${payload.proposal}` : '',
          payload.confidence !== undefined ? `置信度：${Math.round(Number(payload.confidence) * 100)}%` : '',
          payload.nextAction ? `下一步：${payload.nextAction}` : ''
        ].filter(Boolean),
        reasoning: compactReasoning([
          { label: '观察', text: payload.observation },
          { label: '推导', text: payload.proposal },
          { label: '路由', text: payload.nextAction ? `因此下一步交给 ${payload.nextAction}。` : '该节点不再继续路由。' }
        ]),
        status: 'done'
      });
    }
    if (event.type === 'orchestrator_decision') {
      updateAgentProgress({
        id: `orchestrator-${event.sequence}`,
        title: '编排决策',
        detail: `Orchestrator 选择 ${event.agent || '下一位 Agent'} 继续处理。`,
        note: payload.reason === 'bootstrap' ? '当前还没有足够上下文，先启动基础解析和规划。' : '根据 planner 的建议和共享 workspaceState，当前最合适的下一步是交给这个 Agent。',
        meta: [
          payload.plannerNextAgent ? `Planner 建议：${payload.plannerNextAgent}` : '',
          payload.workspaceNextAction ? `Workspace 下一步：${payload.workspaceNextAction}` : '',
          Array.isArray(payload.completedAgents) && payload.completedAgents.length ? `已完成：${payload.completedAgents.join('、')}` : ''
        ].filter(Boolean),
        reasoning: compactReasoning([
          { label: '已知状态', text: Array.isArray(payload.completedAgents) && payload.completedAgents.length ? `已经完成 ${payload.completedAgents.join('、')}。` : '当前处于协作启动阶段。' },
          { label: '决策依据', text: payload.reason === 'bootstrap' ? '上下文不足，先走基础解析和规划。' : '结合 planner 建议和共享 workspaceState。' },
          { label: '下一步', text: `选择 ${event.agent || '下一位 Agent'} 处理。` }
        ]),
        status: 'running'
      });
    }
    if (event.type === 'run_success') {
      updateAgentProgress({ id: 'done', title: '本轮协作完成', detail: '问题或反馈已生成，可以继续回答。', status: 'done' });
    }
  }

  function startVoiceAnswer() {
    if (typeof window === 'undefined') return;
    if (isListening) return;
    const SpeechRecognition = (window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    }).SpeechRecognition || (window as typeof window & {
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    }).webkitSpeechRecognition;
    if (!SpeechRecognition) {
      setSpeechHint('当前浏览器不支持语音识别，请使用 Chrome 或 Edge。');
      return;
    }
    const recognition = new SpeechRecognition();
    recognition.lang = 'zh-CN';
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.onresult = (event) => {
      let finalText = '';
      for (let index = event.resultIndex; index < event.results.length; index += 1) {
        const transcript = event.results[index][0]?.transcript || '';
        if (event.results[index].isFinal) finalText += transcript;
      }
      const text = finalText.trim();
      if (text) setAnswerDraft((current) => `${current}${current.trim() ? '\n' : ''}${text}`);
    };
    recognition.onerror = () => {
      setIsListening(false);
      setSpeechHint('语音识别中断，请检查麦克风权限后重试。');
        recognitionRef.current = null;
    };
      recognition.onend = () => {
        if (!voiceStopRequestedRef.current) {
          try {
            recognition.start();
            return;
          } catch {
            // Fall through and mark the session as stopped if the browser refuses to restart.
          }
        }
        setIsListening(false);
        recognitionRef.current = null;
        setSpeechHint('录音已停止。你可以继续编辑文字，或提交回答。');
      };
      recognitionRef.current = recognition;
      voiceStopRequestedRef.current = false;
      setSpeechHint('正在持续听你回答。讲完后点击“停止录音”。');
    setIsListening(true);
    recognition.start();
  }

  function stopVoiceAnswer() {
    voiceStopRequestedRef.current = true;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
    setSpeechHint('录音已停止。你可以继续编辑文字，或提交回答。');
  }

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

  async function streamAgentRun(payload: Record<string, unknown>) {
    const res = await fetch('/api/agent-run/stream', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.body) throw new Error('当前浏览器不支持流式读取。');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let activeRunId = '';
    let finalData: Record<string, unknown> | null = null;

    function handleBlock(block: string) {
      const eventLine = block.split('\n').find((line) => line.startsWith('event:'));
      const dataLines = block.split('\n').filter((line) => line.startsWith('data:'));
      const event = eventLine?.replace(/^event:\s*/, '').trim() || 'message';
      const raw = dataLines.map((line) => line.replace(/^data:\s?/, '')).join('\n');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (event === 'run_created') {
        activeRunId = data.runId;
        const liveRun: Run = {
          id: data.runId,
          runtimeRunId: data.runtimeRunId,
          status: 'running',
          goal,
          skill: data.skill?.selectedSkill || data.skill,
          executionPlan: data.executionPlan || [],
          runEvents: [],
          createdAt: new Date().toISOString()
        };
        upsertRun(liveRun);
        completeProgress('connect', '流式通道已连接，开始接收协作事件。');
        setLoading('Agent 已启动，正在实时协作...');
      } else if (event === 'run_event') {
        if (activeRunId) appendRunEvent(activeRunId, data as RunEvent);
          progressFromRunEvent(data as RunEvent);
        const agent = data.agent ? `${data.agent} ` : '';
        if (data.type === 'step_start') setLoading(`${agent}正在执行...`);
        if (data.type === 'rag_retrieval') setLoading('retriever 已完成检索，正在交给下一位 agent...');
        if (data.type === 'agent_observation') setLoading(`${agent}已写入协作观察。`);
      } else if (event === 'run_complete') {
        finalData = data;
        const completedRun: Run = {
          id: data.runId,
          runtimeRunId: data.runtimeRunId,
          status: data.status,
          error: data.error,
          goal,
          skill: data.skill?.selectedSkill || data.skill,
          executionPlan: data.executionPlan || [],
          agentOutputs: data.agentOutputs || [],
          retrievalMeta: data.retrievalMeta || null,
          llmTrace: data.llmTrace || [],
          llmSummary: data.llmSummary,
          recovery: data.recovery,
          runtimeLimits: data.runtimeLimits,
          runEvents: data.runEvents || [],
          resumeId: data.resumeId || null,
          createdAt: new Date().toISOString()
        };
        upsertRun(completedRun);
      } else if (event === 'run_error') {
        throw new Error(data.error || '流式运行失败。');
      }
    }

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      blocks.filter(Boolean).forEach(handleBlock);
    }
    if (buffer.trim()) handleBlock(buffer.trim());
    return finalData;
  }

  async function streamSessionContinue(payload: { text: string; answer: string; resumeId?: string | null }) {
    if (!selectedSession?.id) return null;
    const res = await fetch(`/api/sessions/${selectedSession.id}/continue/stream`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    if (!res.body) throw new Error('当前浏览器不支持流式读取。');

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let finalData: Record<string, any> | null = null;

    function handleBlock(block: string) {
      const eventLine = block.split('\n').find((line) => line.startsWith('event:'));
      const dataLines = block.split('\n').filter((line) => line.startsWith('data:'));
      const event = eventLine?.replace(/^event:\s*/, '').trim() || 'message';
      const raw = dataLines.map((line) => line.replace(/^data:\s?/, '')).join('\n');
      if (!raw) return;
      const data = JSON.parse(raw);
      if (event === 'process_event') {
        completeProgress('submit', '流式通道已连接，开始分析回答。');
        updateAgentProgress(data as AgentProgressStep);
        setLoading(data.detail || data.title || 'Agent 正在协作...');
      } else if (event === 'run_complete') {
        finalData = data;
        updateAgentProgress({ id: 'done', title: '本轮协作完成', detail: '反馈和下一轮追问已生成。', status: 'done' });
      } else if (event === 'run_error') {
        throw new Error(data.error || '继续对话失败。');
      }
    }

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const blocks = buffer.split('\n\n');
      buffer = blocks.pop() || '';
      blocks.filter(Boolean).forEach(handleBlock);
    }
    if (buffer.trim()) handleBlock(buffer.trim());
    return finalData;
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
    setAgentProgress([
      { id: 'connect', title: '连接实时通道', detail: '正在建立流式连接，随后会逐步显示处理进度。', status: 'running' }
    ]);
    setInspectedProgressId(null);
    setAgentProgressCollapsed(false);
    setSelectedSession(null);
    setActiveQuestion('');
    setActiveCritique([]);
    setActiveImproved('');
    setAnswerDraft('');
    const data = await streamAgentRun({ text: resumeText, goal, answer: '', history: [], sessionId: null, startNewSession: true, resumeId: parseResult?.resumeId || selectedSession?.resumeId || null }) as Record<string, any>;
    setActiveQuestion(data.questions?.detail?.[0] || data.questions?.basic?.[0] || '');
    setActiveCritique(data.critique?.feedback || []);
    setActiveImproved(data.rewrite?.improvedAnswer || '');
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
    const data = await streamAgentRun({
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
    setAgentProgress([
      { id: 'submit', title: '提交回答', detail: '回答已提交，正在等待实时分析事件返回。', status: 'running' }
    ]);
    setInspectedProgressId(null);
    setAgentProgressCollapsed(false);
    const data = await streamSessionContinue({ ...payload, resumeId: parseResult?.resumeId || selectedSession?.resumeId || null });
    if (!data) return;
    setSelectedSession(data.session || null);
    setActiveQuestion(data.questions?.detail?.[0] || data.questions?.basic?.[0] || '');
    setActiveCritique(data.critique?.feedback || []);
    setActiveImproved(data.rewrite?.improvedAnswer || '');
    setAnswerDraft('');
    setDisplayTab('overview');
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

  async function generateResumePreview() {
    const resumeId = parseResult?.resumeId || selectedSession?.resumeId || selectedResume?.id || null;
    if (!resumeId) return;
    setLoading('正在生成简历预览...');
    const res = await fetch(`/api/resumes/${resumeId}/generation-preview`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        adjustment: generationAdjustment,
        ...(selectedJobId ? { jobId: selectedJobId } : jdText.trim() ? { jdText } : {})
      })
    });
    const data = await res.json();
    setGenerationPreview(data);
    setDisplayTab('generated');
    setLoading(null);
  }

  function updateGeneratedResume(resume: Record<string, unknown>) {
    setGenerationPreview((prev) => prev ? { ...prev, resume } : prev);
  }

  async function saveGeneratedVersion() {
    const resumeId = parseResult?.resumeId || selectedSession?.resumeId || selectedResume?.id || null;
    if (!resumeId || !generationPreview?.resume) return;
    setLoading('正在保存简历版本...');
    const res = await fetch(`/api/resumes/${resumeId}/versions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: generationPreview.resume,
        jobId: selectedJobId || null,
        matchScore: jdResult?.matchScore ?? null,
        label: selectedJobId ? `岗位定向版 · ${jobs.find((job) => job.id === selectedJobId)?.title || '目标岗位'}` : undefined
      })
    });
    const data = await res.json();
    if (data.version) setResumeVersions((current) => [data.version, ...current]);
    setLoading(null);
  }

  function previewGeneratedPdf() {
    const resumeNode = document.querySelector('.generated-resume-card');
    if (!resumeNode) return;
    const printWindow = window.open('', '_blank', 'width=900,height=1200');
    if (!printWindow) {
      window.print();
      return;
    }
    printWindow.document.write(`
      <!doctype html>
      <html>
        <head>
          <title>ResumePilot PDF Preview</title>
          <style>
            @page { size: A4; margin: 10mm; }
            * { box-sizing: border-box; }
            body {
              margin: 0;
              background: #fff;
              color: #111;
              font-family: Inter, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
            }
            .generated-resume-card {
              width: 100%;
              margin: 0;
              padding: 0;
              border: 0;
              box-shadow: none;
              background: #fff;
              font-size: 9pt;
              line-height: 1.28;
            }
            .generated-resume-head,
            .generated-item-title {
              display: flex;
              justify-content: space-between;
              gap: 10pt;
              align-items: flex-start;
            }
            .generated-resume-card h5 {
              margin: 0 0 4pt;
              font-size: 15pt;
              line-height: 1.15;
              color: #111;
            }
            .generated-resume-card p,
            .generated-item ul {
              margin: 0;
              color: #222;
              font-size: 9pt;
              line-height: 1.32;
            }
            .generated-contact,
            .generated-item-title span {
              color: #555;
              font-size: 8pt;
            }
            .generated-section {
              margin-top: 7pt;
              padding-top: 5pt;
              border-top: 0.5pt solid #bbb;
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .generated-section h6 {
              margin: 0 0 4pt;
              font-size: 9.5pt;
              color: #111;
              letter-spacing: 0.04em;
            }
            .generated-item {
              display: grid;
              gap: 3pt;
              padding: 3pt 0;
              break-inside: avoid;
              page-break-inside: avoid;
            }
            .generated-item + .generated-item {
              margin-top: 2pt;
              border-top: 0.5pt dashed #bbb;
            }
            .generated-item-title strong {
              color: #111;
              font-size: 9.2pt;
            }
            .generated-summary {
              padding-left: 6pt;
              border-left: 1.5pt solid #aaa;
            }
            .generated-item ul {
              padding-left: 13pt;
            }
            .generated-item li + li {
              margin-top: 1.5pt;
            }
            .chip {
              display: inline;
              padding: 0;
              border-radius: 0;
              background: transparent;
              color: #222;
            }
          </style>
        </head>
        <body>${resumeNode.outerHTML}</body>
      </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    window.setTimeout(() => printWindow.print(), 150);
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
  async function openResume(id: string) {
    const res = await fetch(`/api/resumes/${id}`);
    const data = await res.json();
    const resume = data.resume || null;
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
    await fetch(`/api/resumes/${id}`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    await loadResumes();
    if (selectedResume?.id === id) openResume(id);
  }

  async function deleteResume(id: string) {
    if (!window.confirm('确认删除这份简历？该操作不可撤销。')) return;
    await fetch(`/api/resumes/${id}`, { method: 'DELETE' });
    if (selectedResume?.id === id || parseResult?.resumeId === id) {
      setSelectedResume(null);
      setParseResult(null);
      setResumeText('');
    }
    await loadResumes();
    await loadDashboard();
  }
  async function openRun(id: string) { const res = await fetch(`/api/runs/${id}`); const data = await res.json(); setSelectedRun(data.run || null); }
  async function openSession(id: string) {
    const res = await fetch(`/api/sessions/${id}`);
    const data = await res.json();
    const session = data.session || null;
    setSelectedSession(session);
    if (session?.resumeId && session.resumeId !== parseResult?.resumeId) {
      await openResume(session.resumeId);
    }
  }

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
        loadJobMatches(),
        loadJobs()
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
                <div className="display-section">
                  <div className={currentQuestion ? 'question-board active' : 'question-board'}>
                    <span>面试官提问</span>
                    <h3>{currentQuestion || '点击左侧“开始面试”后，第一道问题会显示在这里。'}</h3>
                    <p>{currentQuestion ? '请在下方输入或语音回答，然后提交，系统会继续追问并给出反馈。' : '当前还没有待回答的问题。'}</p>
                  </div>
                    {agentProgress.length ? (
                        <div className={agentProgressCollapsed ? 'agent-progress-panel collapsed' : 'agent-progress-panel'}>
                          <div className="agent-progress-head">
                            <div>
                              <h4>AI 思考过程</h4>
                              <p>{agentProgressSummary}。这里展示每个 Agent 的显式分析路径：看了什么、怎么判断、下一步为什么这么走。</p>
                            </div>
                            <div className="agent-progress-head-actions">
                              {inspectedProgressId ? (
                                <button className="secondary-button collapse-button" type="button" onClick={() => setInspectedProgressId(null)}>
                                  回到实时
                                </button>
                              ) : null}
                              <button className="secondary-button collapse-button" type="button" onClick={() => setAgentProgressCollapsed((value) => !value)}>
                                {agentProgressCollapsed ? '展开' : '收起'}
                              </button>
                            </div>
                          </div>
                          {!agentProgressCollapsed ? <div className="agent-progress-list" ref={agentProgressListRef}>
                          {agentProgress.map((step) => {
                            const expanded = step.id === expandedProgressId || (!expandedProgressId && step.status !== 'done');
                            return (
                              <div className={`agent-progress-step ${step.status} ${expanded ? 'expanded' : 'folded'}`} key={step.id}>
                                <button
                                  className="agent-progress-status"
                                  type="button"
                                  onClick={() => setInspectedProgressId(expanded && inspectedProgressId === step.id ? null : step.id)}
                                  title={expanded ? '收起过程' : '查看过程'}
                                >
                                  {step.status === 'running' ? '思考中' : expanded ? '收起' : '查看'}
                                </button>
                                <div className="agent-progress-body">
                                  <div className="agent-progress-title-row">
                                    <strong>{step.title}</strong>
                                    {step.status === 'done' ? <small>{step.detail}</small> : null}
                                  </div>
                                  {expanded ? (
                                    <div className="agent-thought-stream">
                                      {step.meta?.length ? (
                                        <div className="agent-loaded-info">
                                          <span>加载信息</span>
                                          <div>
                                            {step.meta.slice(0, 3).map((item, index) => <em key={`${step.id}-loaded-${index}`}>{item}</em>)}
                                          </div>
                                        </div>
                                      ) : null}
                                      <div className="agent-thinking-entry">
                                        <b>{step.status === 'running' ? `正在思考：${step.title}` : step.title}</b>
                                        <p>{reasoningNarrative(step)}</p>
                                      </div>
                                    </div>
                                  ) : null}
                                </div>
                              </div>
                            );
                          })}
                          </div> : null}
                      </div>
                    ) : null}
                  <div className="answer-board">
                    <div className="answer-board-head">
                      <div>
                        <span>你的回答</span>
                        <strong>{currentQuestion ? `第 ${answeredTurns + 1} 题` : '等待问题'}</strong>
                      </div>
                        <button className={isListening ? 'danger-button voice-button' : 'secondary-button voice-button'} type="button" onClick={isListening ? stopVoiceAnswer : startVoiceAnswer} disabled={!currentQuestion}>
                          {isListening ? '停止录音' : '语音回答'}
                      </button>
                    </div>
                    <textarea className="answer-input" value={answerDraft} onChange={(e) => setAnswerDraft(e.target.value)} disabled={!currentQuestion} placeholder={currentQuestion ? '在这里输入回答；也可以点击“语音回答”自动转文字。' : '开始面试后，这里用于回答当前问题。'} />
                    <div className="answer-tools">
                      <button className="primary-action submit-answer-button" type="button" onClick={() => continueSession({ text: resumeText, answer: answerDraft })} disabled={!selectedSession || !currentQuestion || !answerDraft.trim()}>
                        提交回答并继续追问
                      </button>
                      {speechHint ? <small>{speechHint}</small> : <small>{currentQuestion ? '回答完成后直接提交，系统会生成下一轮追问，并把历史问答保留在下方。' : '当前还没有待回答的问题。'}</small>}
                    </div>
                  </div>
                  <div className="trace-row compact-trace">
                    {[
                      ['选择简历', Boolean(parseResult?.resumeId || selectedSession?.resumeId || selectedResume?.id)],
                      ['确认内容', Boolean(parseResult?.sections?.length || selectedResume?.sections?.length)],
                      ['设定目标', Boolean(goal.trim())],
                      ['生成问题', Boolean(currentQuestion)],
                      ['查看反馈', Boolean(activeCritique.length || activeImproved)],
                      ['生成简历', Boolean(generationPreview)]
                    ].map(([label, active]) => (
                      <div className={active ? 'trace-node active' : 'trace-node'} key={String(label)}>
                        <span>{label}</span>
                        <small>{active ? (label === '生成问题' ? '待回答' : '已就绪') : '待处理'}</small>
                      </div>
                    ))}
                  </div>
                  <div className="detail-block conversation-history">
                    <h4>历史问答</h4>
                    <ConversationTimeline turns={selectedSession?.turns || []} />
                  </div>
                </div>
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
                <div className="display-section">
                  <div className="generation-panel">
                    <div className="generation-control">
                      <div>
                        <h4>简历生成预览</h4>
                        <p className="muted">先生成预览，不覆盖原简历；调整要求会作为用户确认上下文参与事实校验。</p>
                      </div>
                      <button onClick={generateResumePreview} disabled={!(parseResult?.resumeId || selectedSession?.resumeId || selectedResume?.id)}>
                        生成预览
                      </button>
                    </div>
                    <textarea
                      className="generation-adjustment"
                      value={generationAdjustment}
                      onChange={(e) => setGenerationAdjustment(e.target.value)}
                      placeholder="输入调整要求，例如：目标岗位：高级前端工程师。突出 React、TypeScript、性能优化，不新增未确认指标。"
                    />
                    {generationPreview ? (
                      <div className="generation-result">
                        <div className="generation-status-row">
                          <span className={generationPreview.ok ? 'chip ok' : 'chip danger'}>{generationPreview.ok ? '事实校验通过' : '预览被拦截'}</span>
                          <span className="muted">资料校验：{generationPreview.profile_validation?.ok ? '通过' : '需处理'} · 简历校验：{generationPreview.resume_validation?.ok ? '通过' : '需处理'}</span>
                        </div>
                        {generationPreview.resume ? (
                          <div className="pdf-preview-shell">
                            <div className="pdf-preview-head">
                              <div>
                                <strong>编辑生成结果</strong>
                                <span>Skill 生成结构化 resume.json，这里渲染为紧凑 ATS 简历。</span>
                              </div>
                              <div className="pdf-preview-actions">
                                <select value={previewDensity} onChange={(event) => setPreviewDensity(event.target.value as PreviewDensity)}>
                                  <option value="standard">标准</option>
                                  <option value="compact">紧凑</option>
                                  <option value="dense">压缩</option>
                                </select>
                                <button className="secondary-button" onClick={previewGeneratedPdf}>浏览器 PDF 预览</button>
                                <button onClick={saveGeneratedVersion}>保存版本</button>
                                {resumeVersions[0] ? <a className="button-link" href={`/api/resume-versions/${resumeVersions[0].id}/export.docx`}>导出 DOCX</a> : null}
                              </div>
                            </div>
                            <div className="generated-workspace">
                              <div className="generated-edit-pane">
                                <div className="pane-title">
                                  <strong>内容编辑</strong>
                                  <span>用于微调生成结果，不会覆盖原始简历。</span>
                                </div>
                                <GeneratedResumeEditor resume={generationPreview.resume} onChange={updateGeneratedResume} />
                              </div>
                              <div className="generated-preview-pane">
                                <div className="pane-title">
                                  <strong>PDF 预览</strong>
                                  <span>真实分页以浏览器 PDF 预览为准。</span>
                                </div>
                                <GeneratedResumeCard resume={generationPreview.resume} density={previewDensity} />
                              </div>
                            </div>
                          </div>
                        ) : null}
                        {[
                          ...(generationPreview.profile_validation?.issues || []),
                          ...(generationPreview.resume_validation?.issues || [])
                        ].length ? (
                          <div className="validation-list">
                            <h5>需要处理的事实问题</h5>
                            {[...(generationPreview.profile_validation?.issues || []), ...(generationPreview.resume_validation?.issues || [])].map((issue, index) => (
                              <div className="validation-item" key={index}>
                                <strong>{issue.code} · {issue.path}</strong>
                                <p>{issue.message}</p>
                                {issue.value ? <p className="muted">{issue.value}</p> : null}
                                {issue.unsupported_tokens?.length ? <p className="muted">未支持事实：{issue.unsupported_tokens.join('、')}</p> : null}
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ) : <p className="empty">点击“生成预览”后，这里会展示 JSON Resume 和事实校验结果。</p>}
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
                      {jdResult.evidenceSummary ? (
                        <div className="detail-grid two-col">
                          <div className="detail-card"><span>证据支持分</span><strong>{jdResult.evidenceSummary.evidenceBackedScore}/100</strong></div>
                          <div className="detail-card"><span>证据分布</span><strong>{jdResult.evidenceSummary.strong} 强 · {jdResult.evidenceSummary.partial} 部分 · {jdResult.evidenceSummary.missing} 缺失</strong></div>
                        </div>
                      ) : null}
                      {(jdResult.coverage || []).length ? (
                        <div className="jd-suggestions">
                          <h5>岗位要求与简历证据</h5>
                          {(jdResult.coverage || []).map((item, index) => (
                            <div className="validation-item" key={`${item.requirement}-${index}`}>
                              <strong>{item.strength === 'strong' ? '强证据' : item.strength === 'partial' ? '部分证据' : '证据缺失'} · {item.requirement}</strong>
                              <p>{item.evidence || item.evidenceReason || '简历中未找到可引用事实。'}</p>
                            </div>
                          ))}
                        </div>
                      ) : null}
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

      {loading && <div className="loading">{loading}</div>}
    </div>
  );
}
