import { detectRisks } from './resumeParser.js';
import { provider as defaultVectorProvider } from './vectorStore.js';
import { planNextStep } from '../agents/planner.js';
import { retrieveContext } from '../agents/retriever.js';
import { generateInterviewQuestions } from '../agents/interviewer.js';
import { critiqueAnswer } from '../agents/critic.js';
import { rewriteArtifacts } from '../agents/writer.js';
import { retrieveMemory, writeMemory } from './memoryManager.js';
import { logger } from './logger.js';
import { AgentRecoveryHardStopError, createRecoveryRuntime } from './agentRecovery.js';

function makeRuntimeId() {
  return `runtime_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

export function summarizeLlmTrace(trace = []) {
  const calls = trace.length;
  const liveCalls = trace.filter((t) => t.mode === 'live').length;
  const totalLatencyMs = trace.reduce((sum, t) => sum + (t.latencyMs || 0), 0);
  const totalTokens = trace.reduce((sum, t) => sum + (t.usage?.totalTokens || 0), 0);
  const models = [...new Set(trace.map((t) => t.model).filter(Boolean))];
  const errors = trace.filter((t) => t.error).map((t) => ({ agent: t.agent, error: t.error }));
  return {
    calls,
    liveCalls,
    fallbackCalls: calls - liveCalls,
    mode: calls === 0 ? 'none' : liveCalls === calls ? 'live' : liveCalls === 0 ? 'fallback' : 'mixed',
    totalLatencyMs,
    avgLatencyMs: calls ? Math.round(totalLatencyMs / calls) : 0,
    totalTokens,
    models,
    errors
  };
}

async function retrieveMemoryBucket({ label, query, scopes, types, userId, resumeId, sessionId, jobId, limit }) {
  try {
    const items = await retrieveMemory({
      query,
      scopes,
      types,
      userId,
      resumeId,
      sessionId,
      jobId,
      limit
    });
    return { label, items, error: null };
  } catch (error) {
    logger.info('agent_runtime.memory.retrieve_failed', {
      label,
      scopes,
      types,
      resumeId: resumeId || null,
      sessionId: sessionId || null,
      jobId: jobId || null,
      error: error.message
    });
    return { label, items: [], error: error.message };
  }
}

async function loadRuntimeMemory({ goal, userId, resumeId, sessionId, jobId }) {
  const query = goal || '';
  const buckets = await Promise.all([
    retrieveMemoryBucket({ label: 'global', query, scopes: ['global'], limit: 3 }),
    userId ? retrieveMemoryBucket({ label: 'user', query, scopes: ['user'], userId, limit: 3 }) : null,
    resumeId ? retrieveMemoryBucket({ label: 'resume', query, scopes: ['resume'], resumeId, limit: 5 }) : null,
    sessionId ? retrieveMemoryBucket({ label: 'session', query, scopes: ['session'], sessionId, limit: 5 }) : null,
    jobId ? retrieveMemoryBucket({ label: 'job', query, scopes: ['job'], jobId, limit: 5 }) : null
  ].filter(Boolean));

  const items = buckets.flatMap((bucket) => bucket.items);
  return {
    items,
    buckets: buckets.map((bucket) => ({
      label: bucket.label,
      count: bucket.items.length,
      error: bucket.error
    }))
  };
}

function buildRunSummary({ goal, plan, retrieved, questions, critique, rewrite, llmSummary, memoryContext }) {
  const question = questions?.detail?.[0] || questions?.basic?.[0] || '';
  const feedback = Array.isArray(critique?.feedback) ? critique.feedback : [];
  return [
    `Goal: ${goal || ''}`,
    plan?.currentStage ? `Stage: ${plan.currentStage}` : '',
    question ? `Primary question: ${question}` : '',
    feedback.length ? `Critique: ${feedback.slice(0, 3).join(' | ')}` : '',
    rewrite?.improvedAnswer ? `Improved answer generated: yes` : 'Improved answer generated: no',
    `Retrieved chunks: ${retrieved.length}`,
    `Memory items used: ${memoryContext.items.length}`,
    `LLM mode: ${llmSummary.mode}, calls: ${llmSummary.calls}, tokens: ${llmSummary.totalTokens}`
  ].filter(Boolean).join('\n');
}

async function writeRuntimeSummaryMemory({
  runtimeRunId,
  goal,
  sessionId,
  resumeId,
  jobId,
  plan,
  retrieved,
  questions,
  critique,
  rewrite,
  llmSummary,
  memoryContext
}) {
  const content = buildRunSummary({ goal, plan, retrieved, questions, critique, rewrite, llmSummary, memoryContext });
  try {
    const memory = await writeMemory({
      scope: 'run',
      type: 'summary',
      sessionId: sessionId || null,
      resumeId: resumeId || null,
      jobId: jobId || null,
      sourceKind: 'agent_runtime',
      sourceId: runtimeRunId,
      title: `Agent runtime summary: ${String(goal || '').slice(0, 60) || runtimeRunId}`,
      content,
      importance: 0.4,
      confidence: 0.8,
      metadata: {
        runtimeRunId,
        retrievedCount: retrieved.length,
        memoryContextCount: memoryContext.items.length,
        llmSummary
      }
    });
    return { memory, error: null };
  } catch (error) {
    logger.info('agent_runtime.memory.write_failed', {
      runtimeRunId,
      resumeId: resumeId || null,
      sessionId: sessionId || null,
      jobId: jobId || null,
      error: error.message
    });
    return { memory: null, error: error.message };
  }
}

export async function runAgentWorkflow({
  goal = '',
  answer = '',
  history = [],
  sourceText = '',
  sections = [],
  risks = [],
  executionPlan = [],
  sessionTurns = [],
  sessionId = null,
  resumeId = null,
  userId = null,
  jobId = null,
  vectorProvider = defaultVectorProvider
} = {}) {
  const runtimeRunId = makeRuntimeId();
  const startedAt = Date.now();
  logger.info('agent_runtime.run.start', {
    runtimeRunId,
    goal,
    hasAnswer: Boolean(answer),
    executionPlanLength: executionPlan.length,
    sessionId,
    resumeId,
    userId,
    jobId,
    vectorProvider
  });

  const memoryContext = await loadRuntimeMemory({ goal, userId, resumeId, sessionId, jobId });
  logger.info('agent_runtime.memory.loaded', {
    runtimeRunId,
    total: memoryContext.items.length,
    buckets: memoryContext.buckets
  });

  const agentOutputs = [];
  const llmTrace = [];
  const recoveryRuntime = createRecoveryRuntime({
    policy: {
      maxAttemptsPerStep: Number(process.env.AGENT_RECOVERY_MAX_ATTEMPTS_PER_STEP || 1),
      maxAttemptsPerRun: Number(process.env.AGENT_RECOVERY_MAX_ATTEMPTS_PER_RUN || 3),
      maxRecoveryTokens: Number(process.env.AGENT_RECOVERY_MAX_TOKENS || 8000),
      maxRecoveryCostUsd: Number(process.env.AGENT_RECOVERY_MAX_COST_USD || 0.02)
    }
  });
  let parseOutput = null;
  let plan = null;
  let retrieved = [];
  let questions = null;
  let critique = null;
  let rewrite = null;
  let retrievalMeta = null;
  const depth = sessionTurns.length;
  const askedQuestions = sessionTurns.map((turn) => turn.question).filter(Boolean);

  async function runWorkflowStep(step) {
    const stepStartedAt = Date.now();
    logger.info('agent_runtime.step.start', {
      runtimeRunId,
      order: step.order,
      agent: step.agent,
      text: step.text
    });

    if (step.agent === 'parser') {
      parseOutput = { sections, risks: risks.length ? risks : detectRisks(sourceText) };
      agentOutputs.push({ step, output: parseOutput });
    } else if (step.agent === 'planner') {
      plan = await planNextStep({ goal, history, sections });
      if (plan.llm) llmTrace.push({ agent: 'planner', ...plan.llm });
      agentOutputs.push({ step, output: plan });
    } else if (step.agent === 'retriever') {
      const result = await retrieveContext({ text: sourceText, query: goal, topK: 3, sessionTurns, resumeId });
      retrieved = result.retrieved;
      retrievalMeta = {
        resumeResults: result.resumeResults,
        historyResults: result.historyResults,
        kbSource: result.kbSource,
        resumeId: result.resumeId,
        memoryResults: memoryContext.items.length
      };
      agentOutputs.push({ step, output: { retrieved, retrievalMeta, memoryContext } });
    } else if (step.agent === 'interviewer') {
      const result = await generateInterviewQuestions({ goal, retrieved, previousAnswer: answer, depth, askedQuestions });
      questions = result.questions;
      if (result.llm) llmTrace.push({ agent: 'interviewer', ...result.llm });
      agentOutputs.push({ step, output: result });
    } else if (step.agent === 'critic' && answer) {
      critique = await critiqueAnswer({ answer, retrieved, question: questions?.detail?.[0] || questions?.basic?.[0] || '' });
      if (critique.llm) llmTrace.push({ agent: 'critic', ...critique.llm });
      agentOutputs.push({ step, output: critique });
    } else if (step.agent === 'writer' && answer) {
      rewrite = await rewriteArtifacts({ text: sourceText, answer, feedback: critique?.feedback || [] });
      if (rewrite.llm) llmTrace.push({ agent: 'writer', ...rewrite.llm });
      agentOutputs.push({ step, output: rewrite });
    }

    logger.info('agent_runtime.step.success', {
      runtimeRunId,
      order: step.order,
      agent: step.agent,
      latencyMs: Date.now() - stepStartedAt
    });
  }

  for (const step of executionPlan) {
    try {
      await recoveryRuntime.runStep({
        stepName: step.agent,
        args: { order: step.order, agent: step.agent, goal },
        operation: () => runWorkflowStep(step)
      });
    } catch (error) {
      const recovery = error instanceof AgentRecoveryHardStopError
        ? error.details?.recovery || recoveryRuntime.snapshot()
        : recoveryRuntime.snapshot();
      const classifiedError = {
        code: error.code || 'AGENT_RUNTIME_FAILED',
        message: error.message,
        stepName: step.agent,
        details: error.details || null
      };
      const llmSummary = summarizeLlmTrace(llmTrace);

      logger.info('agent_runtime.run.failed', {
        runtimeRunId,
        error: classifiedError,
        llmSummary,
        recovery,
        latencyMs: Date.now() - startedAt
      });

      return {
        runtimeRunId,
        status: error instanceof AgentRecoveryHardStopError ? 'hard_stopped' : 'failed',
        error: classifiedError,
        agentOutputs,
        llmTrace,
        llmSummary,
        parseOutput,
        plan,
        retrieved,
        questions,
        critique,
        rewrite,
        retrievalMeta,
        memoryContext,
        memoryWrite: null,
        recovery,
        vectorProvider
      };
    }
  }

  const llmSummary = summarizeLlmTrace(llmTrace);
  const memoryWrite = await writeRuntimeSummaryMemory({
    runtimeRunId,
    goal,
    sessionId,
    resumeId,
    jobId,
    plan,
    retrieved,
    questions,
    critique,
    rewrite,
    llmSummary,
    memoryContext
  });

  logger.info('agent_runtime.run.success', {
    runtimeRunId,
    outputSteps: agentOutputs.length,
    llmSummary,
    memoryWriteId: memoryWrite.memory?.id || null,
    memoryWriteError: memoryWrite.error,
    latencyMs: Date.now() - startedAt
  });

  return {
    runtimeRunId,
    status: 'succeeded',
    error: null,
    agentOutputs,
    llmTrace,
    llmSummary,
    parseOutput,
    plan,
    retrieved,
    questions,
    critique,
    rewrite,
    retrievalMeta,
    memoryContext,
    memoryWrite,
    recovery: recoveryRuntime.snapshot(),
    vectorProvider
  };
}
