import type { RetrievedChunk, Turn } from '../types/domain';

export default function ConversationTimeline({ turns }: { turns: Turn[] }) {
  if (!turns?.length) return <p className="empty">暂无对话轮次。</p>;

  return (
    <div className="timeline">
      {turns.map((turn, idx) => (
        <div key={idx} className="timeline-item">
          <div className="timeline-node">{idx + 1}</div>
          <div className="timeline-content">
            {turn.stage ? <span className="timeline-stage">第 {(turn.depth ?? idx) + 1} 轮 · {turn.stage}</span> : null}
            <div className="message interviewer"><strong>问题</strong><p>{turn.question || '-'}</p></div>
            <div className="message user"><strong>回答</strong><p>{turn.answer || '-'}</p></div>
            <div className="message critic"><strong>反馈</strong><p>{Array.isArray(turn.critique) ? turn.critique.join('；') : (turn.critique || '-')}</p></div>
            <div className="message writer"><strong>改进回答</strong><p>{turn.improvedAnswer || '-'}</p></div>
            {turn.retrieved?.length ? (
              <div className="message retriever">
                <strong>参考材料</strong>
                <ul>
                  {turn.retrieved.map((item: RetrievedChunk, i: number) => (
                    <li key={i}>[{item.source || 'resume'}] score={item.score} {String(item.content || '').slice(0, 120)}...</li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  );
}
