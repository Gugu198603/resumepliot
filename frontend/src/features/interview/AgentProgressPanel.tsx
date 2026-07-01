import type { RefObject } from 'react';

export type AgentProgressStatus = 'running' | 'done' | 'failed';

export interface AgentProgressStep {
  id: string;
  title: string;
  detail: string;
  status: AgentProgressStatus;
  note?: string;
  meta?: string[];
  reasoning?: Array<{ label: string; text: string }>;
}

function reasoningNarrative(step: AgentProgressStep) {
  if (step.reasoning?.length) {
    return step.reasoning.map((item) => `${item.label}：${String(item.text || '').replace(/^判断：/, '').trim()}`).join(' ');
  }
  return String(step.note || step.detail || '').replace(/^判断：/, '').trim();
}

interface Props {
  steps: AgentProgressStep[];
  collapsed: boolean;
  summary: string;
  activeStep: AgentProgressStep | null;
  completedSteps: AgentProgressStep[];
  inspectedId: string | null;
  listRef: RefObject<HTMLDivElement | null>;
  onToggleCollapsed: () => void;
  onInspect: (id: string | null) => void;
}

export default function AgentProgressPanel({
  steps,
  collapsed,
  summary,
  activeStep,
  completedSteps,
  inspectedId,
  listRef,
  onToggleCollapsed,
  onInspect
}: Props) {
  if (!steps.length) return null;
  const inspected = inspectedId ? steps.find((item) => item.id === inspectedId) || null : null;

  return (
    <div className={collapsed ? 'agent-progress-panel collapsed' : 'agent-progress-panel'}>
      <div className="agent-progress-head">
        <div><h4>处理进度</h4><p>{summary}</p></div>
        <button className="secondary-button collapse-button" type="button" onClick={onToggleCollapsed}>{collapsed ? '查看' : '收起'}</button>
      </div>
      {!collapsed ? (
        <div className="stream-progress-body" ref={listRef}>
          {activeStep ? (
            <div className="stream-active-step" aria-live="polite">
              <span className="stream-spinner" />
              <div><strong>{activeStep.title}</strong><p>{activeStep.detail}</p></div>
            </div>
          ) : (
            <div className="stream-complete"><span>✓</span><div><strong>本轮处理完成</strong><p>反馈和下一轮问题已生成。</p></div></div>
          )}
          {completedSteps.length ? (
            <details className="stream-history">
              <summary>已完成 {completedSteps.length} 步</summary>
              <div className="stream-history-list">
                {completedSteps.map((step) => (
                  <button type="button" key={step.id} onClick={() => onInspect(inspectedId === step.id ? null : step.id)}>
                    <span>✓</span><strong>{step.title}</strong><small>{step.detail}</small>
                  </button>
                ))}
              </div>
            </details>
          ) : null}
          {inspected ? (
            <div className="stream-technical-detail">
              <strong>{inspected.title} · 技术详情</strong>
              <p>{reasoningNarrative(inspected)}</p>
              {inspected.meta?.length ? <ul>{inspected.meta.slice(0, 3).map((item) => <li key={item}>{item}</li>)}</ul> : null}
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
