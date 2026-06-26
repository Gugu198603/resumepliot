import type { ExecutionStep, Run } from '../types/domain';

export default function RunDetailPanel({ run }: { run: Run | null }) {
  if (!run) return <p className="empty">点击左侧某条运行记录查看详情。</p>;

  const summary = run.llmSummary;
  const trace = run.llmTrace || [];

  return (
    <div className="detail-stack">
      <div className="detail-header">
        <h3>Run Detail</h3>
        <p>{run.createdAt}</p>
      </div>
      <div className="detail-grid two-col">
        <div className="detail-card"><span>Goal</span><strong>{run.goal || '-'}</strong></div>
        <div className="detail-card"><span>Skill</span><strong>{run.skill?.name || run.skillId || '-'}</strong></div>
        <div className="detail-card"><span>Vector</span><strong>{run.vectorProvider || '-'}</strong></div>
        <div className="detail-card"><span>Answer</span><strong>{run.hasAnswer ? 'Yes' : 'No'}</strong></div>
      </div>
      {summary && (
        <div className="detail-block">
          <h4>LLM Summary</h4>
          <div className="detail-grid two-col">
            <div className="detail-card"><span>Mode</span><strong>{summary.mode}</strong></div>
            <div className="detail-card"><span>Calls</span><strong>{summary.calls}（live {summary.liveCalls} / fallback {summary.fallbackCalls}）</strong></div>
            <div className="detail-card"><span>Total Latency</span><strong>{summary.totalLatencyMs} ms</strong></div>
            <div className="detail-card"><span>Avg Latency</span><strong>{summary.avgLatencyMs} ms</strong></div>
            <div className="detail-card"><span>Total Tokens</span><strong>{summary.totalTokens}</strong></div>
            <div className="detail-card"><span>Models</span><strong>{summary.models.length ? summary.models.join(', ') : '-'}</strong></div>
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
          <h4>LLM Trace</h4>
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
      <div className="detail-block">
        <h4>Execution Plan</h4>
        {run.executionPlan?.length ? (
          <ol className="timeline-list">
            {run.executionPlan.map((step: ExecutionStep, idx: number) => (
              <li key={idx}><strong>{step.agent}</strong> - {step.text}</li>
            ))}
          </ol>
        ) : <p className="empty">暂无 execution plan。</p>}
      </div>
      <div className="detail-block">
        <h4>Agent Outputs</h4>
        <pre>{JSON.stringify(run.agentOutputs || {}, null, 2)}</pre>
      </div>
    </div>
  );
}
