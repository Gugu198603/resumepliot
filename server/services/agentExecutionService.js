import { splitSections, detectRisks } from './resumeParser.js';
import { provider as vectorProvider } from './vectorStore.js';
import { routeSkill } from '../router/skillRouter.js';
import { resolveExecutionPlan } from './skillWorkflow.js';
import { runAgentWorkflow } from './agentRuntime.js';
import {
  appendRunEvent,
  appendSessionTurn,
  createRunRecord,
  createSession,
  finalizeRunRecord,
  getResume,
  getSession
} from './database.js';
import { makeId } from './idFactory.js';

export async function executeAgentRun(input = {}, { onCreated, onEvent } = {}) {
  const { text = '', goal, answer = '', history = [], sessionId = null, resumeId = null, startNewSession = false } = input;
  const persistedResume = resumeId ? await getResume(resumeId) : null;
  const effectiveResumeId = persistedResume?.id || resumeId || null;
  const sourceText = persistedResume?.text || text || '';
  const sections = persistedResume?.sections || splitSections(sourceText);
  const risks = persistedResume?.risks || detectRisks(sourceText);
  const skill = await routeSkill({ goal: goal || '' });
  const executionPlan = resolveExecutionPlan({ content: skill.rawContent || '' });
  const existingSession = sessionId ? await getSession(sessionId) : null;
  const session = existingSession && !startNewSession
    ? existingSession
    : goal
      ? await createSession({
          title: goal || '模拟面试',
          goal: goal || '模拟面试',
          resumeId: effectiveResumeId
        })
      : null;
  const effectiveSessionId = session?.id || sessionId || null;
  const runtimeRunId = makeId('runtime');
  const run = await createRunRecord({
    runtimeRunId,
    status: 'running',
    goal,
    hasAnswer: Boolean(answer),
    sessionId: effectiveSessionId,
    resumeId: effectiveResumeId,
    skill: skill.selectedSkill,
    executionPlan,
    vectorProvider,
    resultJson: { runtimeRunId, status: 'running', goal, hasAnswer: Boolean(answer), skill: skill.selectedSkill, executionPlan, vectorProvider }
  });
  await onCreated?.({ run, runtimeRunId, executionPlan, skill });

  const runtime = await runAgentWorkflow({
    goal,
    answer,
    history,
    sourceText,
    sections,
    risks,
    executionPlan,
    sessionTurns: session?.turns || [],
    sessionId: effectiveSessionId,
    resumeId: effectiveResumeId,
    vectorProvider,
    runtimeRunId,
    allowedTools: skill.selectedSkill?.allowedTools || null,
    runtimePolicy: skill.selectedSkill?.runtime || {},
    onRunEvent: async (event) => {
      const savedEvent = await appendRunEvent(run.id, event);
      await onEvent?.(savedEvent || event);
    }
  });

  const {
    status, error, agentOutputs, llmTrace, llmSummary, parseOutput, plan, retrieved,
    questions, critique, rewrite, retrievalMeta, memoryContext, memoryWrite, recovery,
    runEvents, runtimeLimits, workspaceState, orchestrationHistory
  } = runtime;

  let updatedSession = session;
  if (status === 'succeeded' && updatedSession) {
      updatedSession = await appendSessionTurn(updatedSession.id, {
        id: makeId('turn'),
        question: questions?.detail?.[0] || questions?.basic?.[0] || goal,
        answer,
        critique: critique?.feedback || [],
        improvedAnswer: rewrite?.improvedAnswer || '',
        retrieved,
        runId: run.id,
        resumeId: effectiveResumeId
      }, run.id);
  }

  const result = {
    runId: run.id,
    runtimeRunId,
    status,
    error,
    sessionId: updatedSession?.id || effectiveSessionId,
    resumeId: effectiveResumeId,
    skill,
    executionPlan,
    agentOutputs,
    plan,
    parseOutput,
    retrieved,
    questions,
    critique,
    rewrite,
    retrievalMeta,
    memoryContext,
    memoryWrite,
    recovery,
    runEvents,
    runtimeLimits,
    workspaceState,
    orchestrationHistory,
    vectorProvider,
    llmTrace,
    llmSummary
  };
  const finalRecord = await finalizeRunRecord(run.id, {
    ...result,
    skill: skill.selectedSkill,
    hasAnswer: Boolean(answer),
    sessionId: updatedSession?.id || effectiveSessionId,
    latencyMs: runtime.runEvents?.findLast?.((event) => event.type === 'run_success' || event.type === 'run_failed')?.latencyMs
  });
  return { ...result, runEvents: finalRecord?.runEvents || runEvents };
}
