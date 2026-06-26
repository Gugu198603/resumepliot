import { useMemo, useState } from 'react';
import ConversationTimeline from './ConversationTimeline';
import type { Session } from '../types/domain';

export default function SessionDetailPanel({ session, resumeText, onContinueSession }: { session: Session | null; resumeText: string; onContinueSession?: (payload: { text: string; answer: string }) => Promise<void> | void }) {
  const [answer, setAnswer] = useState('');
  if (!session) return <p className="empty">点击左侧某个 session 查看详情结构。</p>;

  const nextQuestion = useMemo(() => {
    const turns = session.turns || [];
    const lastTurn = turns[turns.length - 1];
    if (!lastTurn) return session.goal || '请介绍一下这段经历。';
    if (lastTurn.answer) return `基于你上一轮回答“${String(lastTurn.answer).slice(0, 28)}...”，请继续补充最关键的实现细节与验证方式。`;
    return lastTurn.question || session.goal || '请继续介绍一下这段经历。';
  }, [session]);

  return (
    <div className="detail-stack">
      <div className="detail-header">
        <h3>Session Detail</h3>
        <p>{session.title}</p>
      </div>
      <div className="detail-grid two-col">
        <div className="detail-card"><span>Session ID</span><strong>{session.id}</strong></div>
        <div className="detail-card"><span>Turns</span><strong>{(session.turns || []).length}</strong></div>
      </div>
      <div className="detail-block">
        <h4>Conversation Timeline</h4>
        <ConversationTimeline turns={session.turns || []} />
      </div>
      <div className="detail-block">
        <h4>Continue Session</h4>
        <div className="message interviewer"><strong>Next Question</strong><p>{nextQuestion}</p></div>
        <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="输入这轮回答，系统会基于上一轮回答动态生成下一问，并自动生成 critique 和 improved answer。" />
        <button onClick={async () => {
          await onContinueSession?.({ text: resumeText, answer });
          setAnswer('');
        }}>提交并继续对话</button>
      </div>
    </div>
  );
}
