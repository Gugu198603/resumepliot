import { retrieveContext } from '../agents/retriever.js';
import { generateInterviewQuestions } from '../agents/interviewer.js';
import { critiqueAnswer } from '../agents/critic.js';
import { rewriteArtifacts } from '../agents/writer.js';
import { loadRuntimeMemory } from './agentRuntime.js';
import { updateSessionTurns } from './database.js';
import { makeId } from './idFactory.js';

const noop = () => {};

export async function executeInterviewTurn({ session, text = '', answer = '', resumeId = null, onProgress = noop }) {
  const turns = session.turns || [];
  const lastTurn = turns[turns.length - 1] || null;
  const depth = turns.filter((turn) => String(turn.answer || '').trim()).length;
  const askedQuestions = turns.map((turn) => turn.question).filter(Boolean);
  const currentQuestion = lastTurn?.question || session.goal || session.title || '请介绍你的经历。';
  const goal = session.goal || session.title || '';

  onProgress({
    id: 'memory', title: '读取上下文', detail: '正在读取本场面试历史和简历记忆。', status: 'running',
    reasoning: [{ label: '输入识别', text: `当前问题：${currentQuestion}` }, { label: '处理意图', text: '先建立事实边界，再评估回答。' }]
  });
  const memoryContext = await loadRuntimeMemory({ goal, resumeId, sessionId: session.id });
  onProgress({
    id: 'memory', title: '读取上下文', detail: `已读取 ${memoryContext.items.length} 条相关记忆。`, status: 'done',
    meta: Object.entries(memoryContext.buckets || {}).map(([key, value]) => `${key}: ${value}`)
  });

  onProgress({
    id: 'retriever', title: '检索相关经历', detail: '正在从简历和历史回答中召回依据。', status: 'running',
    reasoning: [{ label: '检索目标', text: `围绕「${goal || '当前面试目标'}」查找事实依据。` }]
  });
  const retrieval = await retrieveContext({ text, query: goal, topK: 3, sessionTurns: turns, resumeId });
  const retrieved = retrieval.retrieved;
  onProgress({
    id: 'retriever', title: '检索相关经历', detail: `已召回 ${retrieved.length} 条可参考经历。`, status: 'done',
    meta: retrieved.slice(0, 3).map((item) => String(item.content || '').slice(0, 90))
  });

  onProgress({
    id: 'critic', title: '分析你的回答', detail: '正在评价具体性、可信度和经历匹配度。', status: 'running',
    reasoning: [{ label: '评分方向', text: '检查动作、技术细节、结果、复盘和事实一致性。' }]
  });
  const critique = await critiqueAnswer({ answer, retrieved, question: currentQuestion, memoryContext });
  onProgress({
    id: 'critic', title: '分析你的回答', detail: `已生成 ${critique?.feedback?.length || 0} 条反馈。`, status: 'done',
    meta: (critique?.feedback || []).slice(0, 3)
  });

  onProgress({
    id: 'writer', title: '整理反馈表达', detail: '正在整理更好的回答表达。', status: 'running',
    reasoning: [{ label: '事实约束', text: '仅使用简历、回答和检索记忆中已有的信息。' }]
  });
  const rewrite = await rewriteArtifacts({ text, answer, feedback: critique?.feedback || [], memoryContext });
  onProgress({
    id: 'writer', title: '整理反馈表达', detail: rewrite?.improvedAnswer ? '已整理出可参考的改进回答。' : '已完成反馈整理。', status: 'done',
    meta: rewrite?.improvedAnswer ? [String(rewrite.improvedAnswer).slice(0, 120)] : []
  });

  const answeredTurn = lastTurn
    ? { ...lastTurn, answer, critique: critique?.feedback || [], scores: critique?.scores || {}, assessment: critique?.assessment || null, improvedAnswer: rewrite?.improvedAnswer || '', retrieved, resumeId, depth }
    : { id: makeId('turn'), question: currentQuestion, answer, critique: critique?.feedback || [], scores: critique?.scores || {}, assessment: critique?.assessment || null, improvedAnswer: rewrite?.improvedAnswer || '', retrieved, resumeId, depth };
  const answeredTurns = lastTurn ? [...turns.slice(0, -1), answeredTurn] : [answeredTurn];

  onProgress({
    id: 'interviewer', title: '生成下一轮追问', detail: '正在基于回答和反馈继续追问。', status: 'running',
    reasoning: [{ label: '追问方向', text: '优先验证薄弱点、关键技术选择和高价值项目细节。' }]
  });
  const interview = await generateInterviewQuestions({
    goal,
    retrieved,
    previousAnswer: answer,
    previousQuestion: currentQuestion,
    depth: depth + 1,
    askedQuestions,
    memoryContext
  });
  const questions = interview.questions;
  const question = questions?.detail?.[0] || questions?.basic?.[0] || '请继续介绍你的经历。';
  const nextTurn = { id: makeId('turn'), question, answer: '', critique: [], improvedAnswer: '', retrieved: [], resumeId, depth: depth + 1, stage: interview.stage };
  const updatedSession = await updateSessionTurns(session.id, [...answeredTurns, nextTurn]);
  onProgress({
    id: 'interviewer', title: '生成下一轮追问', detail: '下一轮问题已生成。', status: 'done',
    meta: [question], reasoning: [{ label: '阶段判断', text: `本轮进入「${interview.stage || '追问'}」阶段。` }]
  });

  return {
    session: updatedSession,
    turn: nextTurn,
    answeredTurn,
    critique,
    rewrite,
    questions,
    depth: depth + 1,
    stage: interview.stage,
    retrieved,
    memoryContext,
    retrievalMeta: {
      resumeResults: retrieval.resumeResults,
      historyResults: retrieval.historyResults,
      kbSource: retrieval.kbSource,
      resumeId: retrieval.resumeId
    }
  };
}
