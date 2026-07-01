import { useMemo, useRef, useState } from 'react';
import { streamJsonEvents } from '../../services/sseClient';
import type { Run, RunEvent, Session } from '../../types/domain';
import type { AgentProgressStep } from './AgentProgressPanel';

type SpeechRecognitionResultEvent = Event & {
  resultIndex: number;
  results: ArrayLike<{ isFinal: boolean; 0: { transcript: string } }>;
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

interface UseInterviewWorkflowOptions {
  initialAnswer?: string;
  goal: string;
  selectedSession: Session | null;
  setLoading: (message: string | null) => void;
  upsertRun: (run: Run) => void;
  appendRunEvent: (runId: string, event: RunEvent) => void;
}

function reasoning(items: Array<{ label: string; text?: unknown }>) {
  return items
    .map((item) => ({ label: item.label, text: String(item.text || '').trim() }))
    .filter((item) => item.text);
}

export function useInterviewWorkflow({
  initialAnswer = '',
  goal,
  selectedSession,
  setLoading,
  upsertRun,
  appendRunEvent
}: UseInterviewWorkflowOptions) {
  const [activeQuestion, setActiveQuestion] = useState('');
  const [answerDraft, setAnswerDraft] = useState(initialAnswer);
  const [isListening, setIsListening] = useState(false);
  const [speechHint, setSpeechHint] = useState('');
  const [progress, setProgress] = useState<AgentProgressStep[]>([]);
  const [progressCollapsed, setProgressCollapsed] = useState(false);
  const [inspectedProgressId, setInspectedProgressId] = useState<string | null>(null);
  const recognitionRef = useRef<SpeechRecognitionInstance | null>(null);
  const voiceStopRequestedRef = useRef(false);
  const progressListRef = useRef<HTMLDivElement | null>(null);

  const currentQuestion = useMemo(() => {
    const turns = selectedSession?.turns || [];
    const pending = [...turns].reverse().find((turn) => turn.question && !String(turn.answer || '').trim());
    return pending?.question || activeQuestion || '';
  }, [activeQuestion, selectedSession]);
  const answeredTurns = useMemo(
    () => (selectedSession?.turns || []).filter((turn) => String(turn.answer || '').trim()).length,
    [selectedSession]
  );
  const progressSummary = useMemo(() => {
    const done = progress.filter((step) => step.status === 'done').length;
    const running = [...progress].reverse().find((step) => step.status === 'running');
    return running ? `正在处理：${running.title}` : `${done}/${progress.length} 个步骤已完成`;
  }, [progress]);
  const liveProgressId = useMemo(
    () => [...progress].reverse().find((step) => step.status === 'running')?.id || null,
    [progress]
  );
  const activeProgress = useMemo(
    () => [...progress].reverse().find((step) => step.status === 'running') || null,
    [progress]
  );
  const completedProgress = useMemo(
    () => progress.filter((step) => step.status === 'done' && step.id !== 'done'),
    [progress]
  );

  function updateProgress(step: AgentProgressStep) {
    setProgress((current) => {
      const settled = step.status === 'running'
        ? current.map((item) => item.status === 'running' && item.id !== step.id
          ? { ...item, status: 'done' as const }
          : item)
        : current;
      const exists = settled.some((item) => item.id === step.id);
      const next = exists
        ? settled.map((item) => item.id === step.id ? { ...item, ...step } : item)
        : [...settled, step];
      return next.slice(-12);
    });
  }

  function completeProgress(id: string, detail?: string) {
    setProgress((current) => current.map((item) => item.id === id
      ? { ...item, status: 'done', detail: detail || item.detail }
      : item));
  }

  function completeAllProgress() {
    setProgress((current) => current.map((item) => item.status === 'running'
      ? { ...item, status: 'done' }
      : item));
  }

  function applyRunEvent(event: RunEvent) {
    const payload = event.payload && typeof event.payload === 'object' && !Array.isArray(event.payload)
      ? event.payload as Record<string, any>
      : {};
    if (event.type === 'run_start') {
      updateProgress({
        id: 'start',
        title: '启动协作流程',
        detail: '正在读取目标、简历和历史上下文。',
        note: '先确认本轮任务边界和事实来源。',
        reasoning: reasoning([
          { label: '输入识别', text: `目标：${goal || '模拟面试'}。` },
          { label: '下一步', text: '把上下文交给规划与检索节点。' }
        ]),
        status: 'running'
      });
    }
    if (event.type === 'memory_loaded') {
      completeProgress('start', `已读取 ${payload.total ?? 0} 条相关记忆。`);
    }
    if (event.type === 'step_start') {
      const labels: Record<string, [string, string]> = {
        parser: ['解析简历内容', '把原始简历拆成结构化模块。'],
        planner: ['制定出题计划', '判断当前最该深挖的方向。'],
        retriever: ['检索相关经历', '从简历和历史问答中查找事实依据。'],
        interviewer: ['生成面试问题', '基于目标和依据形成下一轮追问。'],
        critic: ['分析你的回答', '检查回答的具体性、可信度和贴题程度。'],
        writer: ['整理反馈表达', '把评估结论转成更适合面试的表达。']
      };
      const [title, detail] = labels[event.agent || ''] || ['执行协作步骤', 'Agent 正在处理当前任务。'];
      updateProgress({
        id: event.agent || `step-${event.sequence}`,
        title,
        detail,
        note: detail,
        reasoning: reasoning([{ label: '当前任务', text: detail }]),
        status: 'running'
      });
    }
    if (event.type === 'rag_retrieval') {
      const retrieved = Array.isArray(payload.retrieved) ? payload.retrieved : [];
      updateProgress({
        id: 'retriever',
        title: '检索相关经历',
        detail: `已召回 ${retrieved.length} 条可参考经历。`,
        note: '优先用这些经历检查回答是否贴合事实。',
        meta: retrieved.slice(0, 3).map((item: Record<string, unknown>) => String(item.content || '').slice(0, 90)).filter(Boolean),
        reasoning: reasoning([
          { label: '检索目标', text: goal },
          { label: '依据来源', text: payload.kbSource || '简历知识库' }
        ]),
        status: 'done'
      });
    }
    if (event.type === 'agent_observation') {
      updateProgress({
        id: event.agent || `observation-${event.sequence}`,
        title: event.agent === 'interviewer' ? '生成面试问题' : event.agent === 'planner' ? '制定出题计划' : '完成协作步骤',
        detail: '该 Agent 已形成阶段性结论。',
        note: payload.observation || payload.proposal || '当前步骤已完成。',
        meta: [payload.proposal, payload.nextAction ? `下一步：${payload.nextAction}` : ''].filter(Boolean),
        reasoning: reasoning([
          { label: '观察', text: payload.observation },
          { label: '推导', text: payload.proposal }
        ]),
        status: 'done'
      });
    }
    if (event.type === 'run_success') {
      updateProgress({ id: 'done', title: '本轮协作完成', detail: '问题或反馈已生成，可以继续回答。', status: 'done' });
    }
  }

  function resetProgress(id: 'connect' | 'submit') {
    setProgress([{
      id,
      title: id === 'connect' ? '连接实时通道' : '提交回答',
      detail: id === 'connect' ? '正在建立流式连接。' : '回答已提交，正在等待实时分析。',
      status: 'running'
    }]);
    setInspectedProgressId(null);
    setProgressCollapsed(false);
  }

  function startVoice() {
    if (typeof window === 'undefined' || isListening) return;
    const speechWindow = window as typeof window & {
      SpeechRecognition?: new () => SpeechRecognitionInstance;
      webkitSpeechRecognition?: new () => SpeechRecognitionInstance;
    };
    const SpeechRecognition = speechWindow.SpeechRecognition || speechWindow.webkitSpeechRecognition;
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
        if (event.results[index].isFinal) finalText += event.results[index][0]?.transcript || '';
      }
      if (finalText.trim()) {
        setAnswerDraft((current) => `${current}${current.trim() ? '\n' : ''}${finalText.trim()}`);
      }
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
          // Browser refused to restart recognition.
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

  function stopVoice() {
    voiceStopRequestedRef.current = true;
    recognitionRef.current?.stop();
    recognitionRef.current = null;
    setIsListening(false);
    setSpeechHint('录音已停止。你可以继续编辑文字，或提交回答。');
  }

  async function streamAgent(payload: Record<string, unknown>) {
    let activeRunId = '';
    let finalData: Record<string, any> | null = null;
    await streamJsonEvents('/api/agent-run/stream', payload, ({ event, data }) => {
      if (event === 'run_created') {
        activeRunId = data.runId;
        upsertRun({
          id: data.runId,
          runtimeRunId: data.runtimeRunId,
          status: 'running',
          goal,
          skill: data.skill?.selectedSkill || data.skill,
          executionPlan: data.executionPlan || [],
          runEvents: [],
          createdAt: new Date().toISOString()
        });
        completeProgress('connect', '流式通道已连接，开始接收协作事件。');
        setLoading('Agent 已启动，正在实时协作...');
      } else if (event === 'run_event') {
        if (activeRunId) appendRunEvent(activeRunId, data as RunEvent);
        applyRunEvent(data as RunEvent);
        if (data.type === 'step_start') setLoading(`${data.agent ? `${data.agent} ` : ''}正在执行...`);
      } else if (event === 'run_complete') {
        completeAllProgress();
        finalData = data;
        upsertRun({
          ...data,
          id: data.runId,
          goal,
          skill: data.skill?.selectedSkill || data.skill,
          createdAt: new Date().toISOString()
        } as Run);
      } else if (event === 'run_error') {
        throw new Error(data.error || '流式运行失败。');
      }
    });
    return finalData;
  }

  async function streamContinue(payload: { text: string; answer: string; resumeId?: string | null }) {
    if (!selectedSession?.id) return null;
    let finalData: Record<string, any> | null = null;
    await streamJsonEvents(`/api/sessions/${selectedSession.id}/continue/stream`, payload, ({ event, data }) => {
      if (event === 'process_event') {
        completeProgress('submit', '流式通道已连接，开始分析回答。');
        updateProgress(data as AgentProgressStep);
        setLoading(data.detail || data.title || 'Agent 正在协作...');
      } else if (event === 'run_complete') {
        completeAllProgress();
        finalData = data;
        updateProgress({ id: 'done', title: '本轮协作完成', detail: '反馈和下一轮追问已生成。', status: 'done' });
      } else if (event === 'run_error') {
        throw new Error(data.error || '继续对话失败。');
      }
    });
    return finalData;
  }

  return {
    activeQuestion,
    setActiveQuestion,
    answerDraft,
    setAnswerDraft,
    currentQuestion,
    answeredTurns,
    isListening,
    speechHint,
    progress,
    progressCollapsed,
    setProgressCollapsed,
    progressSummary,
    liveProgressId,
    activeProgress,
    completedProgress,
    inspectedProgressId,
    setInspectedProgressId,
    progressListRef,
    resetProgress,
    startVoice,
    stopVoice,
    streamAgent,
    streamContinue
  };
}
