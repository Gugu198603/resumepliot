import type { ExecutionStep, Run } from '../types/domain';

export default function RunDetailPanel({ run, onRetry }: { run: Run | null; onRetry?: (run: Run) => void }) {
  if (!run) return <p className="empty">点击左侧某条运行记录查看详情。</p>;

  const summary = run.llmSummary;
  const trace = run.llmTrace || [];
  const recovery = run.recovery;
  const recoveryEvents = recovery?.events || [];
  const hardStopped = run.status === 'hard_stopped';

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
