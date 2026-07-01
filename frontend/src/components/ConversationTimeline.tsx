import type { RetrievedChunk, Turn } from '../types/domain';

export default function ConversationTimeline({ turns }: { turns: Turn[] }) {
  const answeredTurns = (turns || []).filter((turn) => String(turn.answer || '').trim());
  if (!answeredTurns.length) return <p className="empty">暂无已提交的对话轮次。</p>;

  return (
    <div className="conversation-stream">
      {answeredTurns.map((turn, idx) => (
        <article key={idx} className="conversation-turn">
          <header>
            <span>{idx + 1}</span>
            <div>
              <small>{turn.stage ? `第 ${(turn.depth ?? idx) + 1} 轮 · ${turn.stage}` : `第 ${idx + 1} 轮`}</small>
              <strong>{turn.question || '-'}</strong>
            </div>
          </header>
          <div className="conversation-answer">
            <span>你</span>
            <p>{turn.answer || '-'}</p>
          </div>
          {(turn.critique || turn.improvedAnswer || turn.retrieved?.length) ? (
            <details className="conversation-review">
              <summary>查看本轮反馈</summary>
              {turn.critique ? <div><strong>反馈</strong><p>{Array.isArray(turn.critique) ? turn.critique.join('；') : turn.critique}</p></div> : null}
              {turn.improvedAnswer ? <div><strong>参考表达</strong><p>{turn.improvedAnswer}</p></div> : null}
              {turn.retrieved?.length ? (
                <div>
                  <strong>参考依据</strong>
                  <ul>
                    {turn.retrieved.map((item: RetrievedChunk, i: number) => (
                      <li key={i}>[{item.source || 'resume'}] {String(item.content || '').slice(0, 120)}...</li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </details>
          ) : null}
        </article>
      ))}
    </div>
  );
}
