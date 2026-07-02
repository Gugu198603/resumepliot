import type { ExecutionStep, Run, RunEvent } from '../types/domain';

function asRecord(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function eventTitle(event: RunEvent) {
  const agent = event.agent ? `${event.agent} · ` : '';
  const map: Record<string, string> = {
    run_start: '运行开始',
    run_transition: '状态迁移',
    orchestrator_decision: '调度决策',
    memory_loaded: '加载记忆',
    tool_call_start: '工具调用开始',
    tool_call_success: '工具调用成功',
    tool_call_error: '工具调用失败',
    step_start: '开始执行',
    rag_retrieval: 'RAG 检索',
    agent_observation: '协作观察',
    step_success: '执行完成',
    run_success: '运行成功',
    run_failed: '运行失败',
    guard_hard_stop: '保护停止'
  };
  return `${agent}${map[event.type || ''] || event.type || '事件'}`;
}

function eventDescription(event: RunEvent) {
  const payload = asRecord(event.payload);
  if (event.type === 'orchestrator_decision') {
    return `由 ${payload.reason || 'orchestrator'} 选择下一步，planner 建议：${payload.plannerNextAgent || '-'}`;
  }
  if (event.type === 'rag_retrieval') {
    const retrieved = Array.isArray(payload.retrieved) ? payload.retrieved.length : 0;
    return `query="${payload.query || '-'}"，召回 ${retrieved} 条，来源 ${payload.kbSource || '-'}`;
  }
  if (event.type === 'agent_observation') {
    return [payload.observation, payload.proposal ? `建议：${payload.proposal}` : ''].filter(Boolean).join(' ');
  }
  if (event.type?.startsWith('tool_call_')) {
    return `工具 ${payload.toolName || '-'}${event.latencyMs != null ? `，耗时 ${event.latencyMs} ms` : ''}`;
  }
  if (event.type === 'step_start') return payload.text || 'Agent 开始处理共享 workspace。';
  if (event.errorMessage) return event.errorMessage;
  if (payload.reason) return payload.reason;
  return '';
}

export default function RunDetailPanel({ run, onRetry }: { run: Run | null; onRetry?: (run: Run) => void }) {
  if (!run) return <p className="empty">点击左侧某条运行记录查看详情。</p>;

  const summary = run.llmSummary;
  const trace = run.llmTrace || [];
  const recovery = run.recovery;
  const recoveryEvents = recovery?.events || [];
  const hardStopped = run.status === 'hard_stopped';
    const runEvents = run.runEvents || [];

  return (
    <div className="detail-stack">
      <div className="detail-header">
        <h3>运行诊断</h3>
        <p>{run.createdAt}</p>
      </div>
      {run.status && run.status !== 'succeeded' ? (
        <div className={hardStopped ? 'recovery-banner hard-stop' : 'recovery-banner'}>
          <div>
            <span className="chip danger">{hardStopped ? '已强制停止' : run.status}</span>
            <h4>{run.error?.message || '执行未完成'}</h4>
            <p>
              {hardStopped
                ? '系统已停止自动恢复，避免重复错误继续消耗 token。你可以确认上下文后手动重试。'
                : '执行失败，已保留当前 run 的诊断信息。'}
            </p>
            {run.error?.code ? <p className="metric-footnote">错误码：{run.error.code}{run.error.stepName ? ` · step: ${run.error.stepName}` : ''}</p> : null}
          </div>
          {onRetry ? <button onClick={() => onRetry(run)}>手动重试</button> : null}
        </div>
      ) : null}
      <div className="detail-grid two-col">
        <div className="detail-card"><span>状态</span><strong>{run.status || 'succeeded'}</strong></div>
        <div className="detail-card"><span>目标</span><strong>{run.goal || '-'}</strong></div>
        <div className="detail-card"><span>调用能力</span><strong>{run.skill?.name || run.skillId || '-'}</strong></div>
        <div className="detail-card"><span>检索来源</span><strong>{run.vectorProvider || '-'}</strong></div>
        <div className="detail-card"><span>是否有回答</span><strong>{run.hasAnswer ? '是' : '否'}</strong></div>
      </div>
        <div className="detail-block">
          <h4>实时协作时间线</h4>
          {runEvents.length ? (
            <ol className="timeline-list run-event-list">
              {runEvents.map((event, idx) => {
                const payload = asRecord(event.payload);
                return (
                  <li key={event.id || `${event.sequence}-${idx}`}>
                    <strong>{event.sequence || idx + 1}. {eventTitle(event)}</strong>
                    <span className={event.status === 'succeeded' ? 'chip ok' : event.status === 'running' ? 'chip' : event.errorCode ? 'chip danger' : 'chip'}>{event.status || '-'}</span>
                    {event.latencyMs != null ? ` · ${event.latencyMs} ms` : ''}
                    {eventDescription(event) ? <p>{eventDescription(event)}</p> : null}
                    {payload.confidence != null ? <p className="metric-footnote">confidence: {payload.confidence}</p> : null}
                  </li>
                );
              })}
            </ol>
          ) : <p className="empty">暂无实时事件。启动流式运行后会逐步写入。</p>}
        </div>
      {summary && (
        <div className="detail-block">
          <h4>模型调用概览</h4>
          <div className="detail-grid two-col">
            <div className="detail-card"><span>模式</span><strong>{summary.mode}</strong></div>
            <div className="detail-card"><span>调用次数</span><strong>{summary.calls}（真实 {summary.liveCalls} / 兜底 {summary.fallbackCalls}）</strong></div>
            <div className="detail-card"><span>总延迟</span><strong>{summary.totalLatencyMs} ms</strong></div>
            <div className="detail-card"><span>平均延迟</span><strong>{summary.avgLatencyMs} ms</strong></div>
            <div className="detail-card"><span>Token 总量</span><strong>{summary.totalTokens}</strong></div>
            <div className="detail-card"><span>模型</span><strong>{summary.models.length ? summary.models.join(', ') : '-'}</strong></div>
          </div>
          {summary.errors?.length ? (
            <ul className="risk-list">
              {summary.errors.map((e, idx) => <li key={idx} className="jd-gap">[{e.agent}] {e.error}</li>)}
            </ul>
          ) : null}
        </div>
      )}
      {trace.length ? (
        <div className="detail-block">
          <h4>模型调用明细</h4>
          <ol className="timeline-list">
            {trace.map((item, idx) => (
              <li key={idx}>
                <strong>{item.agent}</strong>
                <span className={item.mode === 'live' ? 'chip ok' : 'chip'}>{item.mode}</span>
                {' · '}{item.latencyMs} ms{' · '}{item.model || '-'}
                {item.usage?.totalTokens != null ? ` · ${item.usage.totalTokens} tokens` : ''}
                {item.error ? ` · 错误：${item.error}` : ''}
              </li>
            ))}
          </ol>
        </div>
      ) : null}
      {recovery ? (
        <div className="detail-block">
          <h4>自动恢复保护</h4>
          <div className="detail-grid two-col">
            <div className="detail-card"><span>恢复 Token</span><strong>{recovery.budget?.usedTokens || 0} / {recovery.budget?.maxRecoveryTokens || 0}</strong></div>
            <div className="detail-card"><span>预估成本</span><strong>${recovery.budget?.estimatedCostUsd || 0} / ${recovery.budget?.maxRecoveryCostUsd || 0}</strong></div>
            <div className="detail-card"><span>错误指纹</span><strong>{recovery.fingerprints?.length || 0}</strong></div>
            <div className="detail-card"><span>恢复事件</span><strong>{recoveryEvents.length}</strong></div>
          </div>
          {recovery.fingerprints?.length ? (
            <div className="fingerprint-list">
              {recovery.fingerprints.map((item) => (
                <div className="fingerprint-item" key={item.fingerprint}>
                  <strong>{item.code || 'UNKNOWN'} · {item.stepName || '-'}</strong>
                  <p>{item.fingerprint} · attempts: {item.attempts || 0} · {item.lastOutcome || '-'}</p>
                  {item.lastMessage ? <p>{item.lastMessage}</p> : null}
                </div>
              ))}
            </div>
          ) : null}
          {recoveryEvents.length ? (
            <ol className="timeline-list">
              {recoveryEvents.slice(-8).map((event, idx) => (
                <li key={`${event.at || ''}-${idx}`}>
                  <strong>{event.type}</strong>
                  {event.stepName ? ` · ${event.stepName}` : ''}
                  {event.code ? ` · ${event.code}` : ''}
                  {event.tokens != null ? ` · ${event.tokens} tokens` : ''}
                  {event.message ? ` · ${event.message}` : ''}
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ) : null}
      <div className="detail-block">
        <h4>执行计划</h4>
        {run.executionPlan?.length ? (
          <ol className="timeline-list">
            {run.executionPlan.map((step: ExecutionStep, idx: number) => (
              <li key={idx}><strong>{step.agent}</strong> - {step.text}</li>
            ))}
          </ol>
        ) : <p className="empty">暂无执行计划。</p>}
      </div>
      <div className="detail-block">
        <h4>执行输出</h4>
        <pre>{JSON.stringify(run.agentOutputs || {}, null, 2)}</pre>
      </div>
    </div>
  );
}
