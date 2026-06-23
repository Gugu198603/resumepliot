import ConversationTimeline from './ConversationTimeline';

function deriveTurns(session: any) {
  const runs = session?.runs || [];
  return runs.map((run: any) => ({
    question: run.goal || 'Mock interview question',
    answer: run.hasAnswer ? 'This run included an answer.' : 'No answer stored yet.',
    critique: run.agentOutputs?.find?.((x: any) => x.step?.agent === 'critic')?.output?.feedback || [],
    improvedAnswer: run.agentOutputs?.find?.((x: any) => x.step?.agent === 'writer')?.output?.improvedAnswer || ''
  }));
}

export default function SessionDetailPanel({ session }: { session: any | null }) {
  if (!session) return <p className="empty">点击左侧某个 session 查看详情结构。</p>;
  const turns = deriveTurns(session);

  return (
    <div className="detail-stack">
      <div className="detail-header">
        <h3>Session Detail</h3>
        <p>{session.title}</p>
      </div>
      <div className="detail-grid two-col">
        <div className="detail-card"><span>Session ID</span><strong>{session.id}</strong></div>
        <div className="detail-card"><span>Runs</span><strong>{(session.runs || []).length}</strong></div>
      </div>
      <div className="detail-block">
        <h4>Conversation Timeline</h4>
        <ConversationTimeline turns={turns} />
      </div>
      <div className="detail-block">
        <h4>Raw Session Data</h4>
        <pre>{JSON.stringify(session, null, 2)}</pre>
      </div>
    </div>
  );
}
