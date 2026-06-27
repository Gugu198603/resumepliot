import { useMemo, useState } from 'react';
import ConversationTimeline from './ConversationTimeline';
import type { Session } from '../types/domain';

const STAGES = ['背景澄清', '方案细节', '验证与结果', '反思与拓展'];

export default function SessionDetailPanel({ session, resumeText, onContinueSession }: { session: Session | null; resumeText: string; onContinueSession?: (payload: { text: string; answer: string }) => Promise<void> | void }) {
  const [answer, setAnswer] = useState('');

  const turns = session?.turns || [];
  const depth = turns.length;
  const stageLabel = STAGES[Math.min(depth, STAGES.length - 1)];

  const nextQuestion = useMemo(() => {
    const lastTurn = turns[turns.length - 1];
    if (!lastTurn) return session?.goal || '请介绍一下这段经历。';
    if (lastTurn.answer) return `进入第 ${depth + 1} 轮「${stageLabel}」：基于你上一轮回答“${String(lastTurn.answer).slice(0, 28)}...”，请继续深入这一阶段的关键细节。`;
    return lastTurn.question || session?.goal || '请继续介绍一下这段经历。';
  }, [session, depth, stageLabel]);

  if (!session) return <p className="empty">点击左侧某个 session 查看详情结构。</p>;

  return (
    <div className="detail-stack">
      <div className="detail-header">
        <h3>Session Detail</h3>
        <p>{session.title}</p>
      </div>
      <div className="detail-grid two-col">
        <div className="detail-card"><span>Session ID</span><strong>{session.id}</strong></div>
        <div className="detail-card"><span>Turns</span><strong>{depth}</strong></div>
      </div>
      <div className="interview-progress">
        {STAGES.map((label, idx) => (
          <div key={label} className={idx < depth ? 'interview-stage done' : idx === depth ? 'interview-stage active' : 'interview-stage'}>
            <span>{idx + 1}</span>
            <small>{label}</small>
          </div>
        ))}
      </div>
      <div className="detail-block">
        <h4>Conversation Timeline</h4>
        <ConversationTimeline turns={turns} />
      </div>
      <div className="detail-block">
        <h4>连续追问 · 第 {depth + 1} 轮「{stageLabel}」</h4>
        <div className="message interviewer"><strong>Next Question</strong><p>{nextQuestion}</p></div>
        <textarea value={answer} onChange={(e) => setAnswer(e.target.value)} placeholder="输入这轮回答，系统会基于上一轮回答按追问阶段递进生成下一问，并自动生成 critique 和 improved answer。" />
        <button onClick={async () => {
          await onContinueSession?.({ text: resumeText, answer });
          setAnswer('');
        }}>提交并继续追问</button>
      </div>
    </div>
  );
}
