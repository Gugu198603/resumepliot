import type { RefObject } from 'react';
import ConversationTimeline from '../../components/ConversationTimeline';
import type { Session } from '../../types/domain';
import AgentProgressPanel from './AgentProgressPanel';
import type { AgentProgressStep } from './AgentProgressPanel';

interface InterviewWorkspaceProps {
  session: Session | null;
  currentQuestion: string;
  answeredTurns: number;
  answerDraft: string;
  isListening: boolean;
  speechHint: string;
  liveProgressId: string | null;
  progress: AgentProgressStep[];
  progressCollapsed: boolean;
  progressSummary: string;
  activeProgress: AgentProgressStep | null;
  completedProgress: AgentProgressStep[];
  inspectedProgressId: string | null;
  currentRoundRef: RefObject<HTMLElement>;
  progressListRef: RefObject<HTMLDivElement>;
  onAnswerChange: (value: string) => void;
  onToggleVoice: () => void;
  onSubmit: () => void;
  onToggleProgress: () => void;
  onInspectProgress: (id: string | null) => void;
}

export default function InterviewWorkspace({
  session,
  currentQuestion,
  answeredTurns,
  answerDraft,
  isListening,
  speechHint,
  liveProgressId,
  progress,
  progressCollapsed,
  progressSummary,
  activeProgress,
  completedProgress,
  inspectedProgressId,
  currentRoundRef,
  progressListRef,
  onAnswerChange,
  onToggleVoice,
  onSubmit,
  onToggleProgress,
  onInspectProgress
}: InterviewWorkspaceProps) {
  return (
    <div className="display-section interview-flow">
      <section className="conversation-history">
        <div className="flow-section-head">
          <div>
            <span>会话记录</span>
            <h4>{answeredTurns ? `已完成 ${answeredTurns} 轮` : '尚无历史对话'}</h4>
          </div>
        </div>
        <ConversationTimeline turns={session?.turns || []} />
      </section>

      <section className="current-round" ref={currentRoundRef}>
        <div className="flow-section-head current-round-head">
          <div>
            <span>本轮对话</span>
            <h4>{currentQuestion ? `第 ${answeredTurns + 1} 题` : '等待开始'}</h4>
          </div>
        </div>
        <div className={currentQuestion ? 'question-board active' : 'question-board'}>
          <span>面试官</span>
          <h3>{currentQuestion || '点击左侧“开始面试”后，第一道问题会显示在这里。'}</h3>
        </div>
        <div className="answer-board">
          <div className="answer-board-head">
            <span>你的回答</span>
            <button
              className={isListening ? 'danger-button voice-button' : 'secondary-button voice-button'}
              type="button"
              onClick={onToggleVoice}
              disabled={!currentQuestion}
            >
              {isListening ? '停止录音' : '语音回答'}
            </button>
          </div>
          <textarea
            className="answer-input"
            value={answerDraft}
            onChange={(event) => onAnswerChange(event.target.value)}
            disabled={!currentQuestion}
            placeholder={currentQuestion ? '在这里输入回答；也可以点击“语音回答”自动转文字。' : '开始面试后，这里用于回答当前问题。'}
          />
          <div className="answer-tools">
            <button
              className="primary-action submit-answer-button"
              type="button"
              onClick={onSubmit}
              disabled={!session || !currentQuestion || !answerDraft.trim() || Boolean(liveProgressId)}
            >
              {liveProgressId ? '正在分析回答…' : '提交回答并继续追问'}
            </button>
            <small>{speechHint || (currentQuestion ? '系统会保留本轮回答，并在上方追加反馈记录。' : '当前还没有待回答的问题。')}</small>
          </div>
        </div>
        <AgentProgressPanel
          steps={progress}
          collapsed={progressCollapsed}
          summary={progressSummary}
          activeStep={activeProgress}
          completedSteps={completedProgress}
          inspectedId={inspectedProgressId}
          listRef={progressListRef}
          onToggleCollapsed={onToggleProgress}
          onInspect={onInspectProgress}
        />
      </section>
    </div>
  );
}
