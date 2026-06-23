export default function ConversationTimeline({ turns }: { turns: any[] }) {
  if (!turns?.length) return <p className="empty">暂无对话轮次。</p>;

  return (
    <div className="timeline">
      {turns.map((turn, idx) => (
        <div key={idx} className="timeline-item">
          <div className="timeline-node">{idx + 1}</div>
          <div className="timeline-content">
            <div className="message interviewer"><strong>Question</strong><p>{turn.question || '-'}</p></div>
            <div className="message user"><strong>Answer</strong><p>{turn.answer || '-'}</p></div>
            <div className="message critic"><strong>Critique</strong><p>{Array.isArray(turn.critique) ? turn.critique.join('；') : (turn.critique || '-')}</p></div>
            <div className="message writer"><strong>Improved</strong><p>{turn.improvedAnswer || '-'}</p></div>
          </div>
        </div>
      ))}
    </div>
  );
}
