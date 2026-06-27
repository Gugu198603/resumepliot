import { useMemo } from 'react';
import ConversationTimeline from './ConversationTimeline';
import { buildSectionBlocks } from '../utils/sectionBlocks';
import type { Resume, Section, Session } from '../types/domain';

const STAGES = ['背景澄清', '方案细节', '验证与结果', '反思与拓展'];

export default function SessionDetailPanel({ session, resume, onResumeSession }: { session: Session | null; resume?: Resume | null; onResumeSession?: () => void }) {
  const turns = session?.turns || [];
  const depth = turns.filter((turn) => String(turn.answer || '').trim()).length;
  const stageLabel = STAGES[Math.min(depth, STAGES.length - 1)];
  const hasPendingQuestion = turns.some((turn) => turn.question && !turn.answer);

  const nextQuestion = useMemo(() => {
    const lastTurn = turns[turns.length - 1];
    if (!lastTurn) return session?.goal || '请介绍一下这段经历。';
    if (lastTurn.answer) return `进入第 ${depth + 1} 轮「${stageLabel}」：基于你上一轮回答“${String(lastTurn.answer).slice(0, 28)}...”，请继续深入这一阶段的关键细节。`;
    return lastTurn.question || session?.goal || '请继续介绍一下这段经历。';
  }, [session, depth, stageLabel]);

  if (!session) return <p className="empty">点击左侧某场面试查看详情。</p>;

  return (
    <div className="detail-stack session-detail-stack">
      <div className="detail-header">
        <h3>面试详情</h3>
        <p>{session.title}</p>
        <button className="secondary-button" onClick={onResumeSession}>回到工作台继续</button>
      </div>
      <div className="detail-grid two-col">
        <div className="detail-card"><span>面试目标</span><strong>{session.goal || session.title}</strong></div>
        <div className="detail-card"><span>追问进度</span><strong>{hasPendingQuestion ? `第 ${depth + 1} 题待回答` : depth > 0 ? `已回答 ${depth} 轮` : '待开始'}</strong></div>
      </div>
      <div className="interview-progress">
        {STAGES.map((label, idx) => (
          <div key={label} className={idx < depth ? 'interview-stage done' : idx === depth ? 'interview-stage active' : 'interview-stage'}>
            <span>{idx + 1}</span>
            <small>{label}</small>
          </div>
        ))}
      </div>
      <div className="session-workbench">
        <div className="detail-block scroll-block resume-context-panel">
          <h4>当前简历上下文</h4>
          {resume?.sections?.length ? (
            <div className="section-list compact">
              {resume.sections.map((section: Section) => (
                <div className="section-item" key={section.title}>
                  <h5>{section.title}</h5>
                  <div className="section-content">{buildSectionBlocks(section.content || []).map((block, idx: number) => <p className={`section-block ${block.kind}`} key={idx}>{block.text}</p>)}</div>
                </div>
              ))}
            </div>
          ) : <p className="empty">当前面试暂未关联简历，或简历模块还未加载。</p>}
        </div>
        <div className="session-chat-panel">
          <div className="detail-block scroll-block">
            <h4>对话时间线</h4>
            <ConversationTimeline turns={turns} />
          </div>
          <div className="detail-block followup-block">
            <h4>{hasPendingQuestion ? `待回答 · 第 ${depth + 1} 题「${stageLabel}」` : '继续练习'}</h4>
            <div className="message interviewer"><strong>{hasPendingQuestion ? '当前问题' : '下一步'}</strong><p>{hasPendingQuestion ? nextQuestion : '这场面试暂无待回答问题。回到工作台后可以重开一场面试，或基于当前简历生成新的问题。'}</p></div>
            <button onClick={onResumeSession}>回到工作台</button>
          </div>
        </div>
      </div>
    </div>
  );
}
