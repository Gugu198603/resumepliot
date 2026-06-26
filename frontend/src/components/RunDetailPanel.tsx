import type { ExecutionStep, Run } from '../types/domain';

export default function RunDetailPanel({ run }: { run: Run | null }) {
  if (!run) return <p className="empty">点击左侧某条运行记录查看详情。</p>;

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
