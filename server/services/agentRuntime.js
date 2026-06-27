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
import { RUN_STATUS, createRunStateMachine, deriveFailureStatus } from './runStateMachine.js';

function makeRuntimeId() {
  return `runtime_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
}

function asPositiveInt(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

function createRuntimeLimits() {
  return {
    maxSteps: asPositiveInt(process.env.AGENT_MAX_STEPS, 12),
    maxToolCalls: asPositiveInt(process.env.AGENT_MAX_TOOL_CALLS, 20),
    maxSameToolCalls: asPositiveInt(process.env.AGENT_MAX_SAME_TOOL_CALLS, 4),
    timeoutMs: asPositiveInt(process.env.AGENT_TIMEOUT_MS, 120000)
  };
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
  const limits = createRuntimeLimits();
  const runEvents = [];
  const toolCallCounts = new Map();
  let eventSequence = 0;
  let totalToolCalls = 0;

  function recordRunEvent(type, payload = {}) {
    const event = {
      runtimeRunId,
      sequence: ++eventSequence,
      type,
      agent: payload.agent || null,
      status: payload.status || null,
      latencyMs: Number.isFinite(payload.latencyMs) ? payload.latencyMs : null,
      errorCode: payload.errorCode || null,
      errorMessage: payload.errorMessage || null,
      payload: payload.payload || null
    };
    runEvents.push(event);
    return event;
  }

  const stateMachine = createRunStateMachine({
    onTransition: ({ from, to, at, ...payload }) => {
      recordRunEvent('run_transition', {
        status: to,
        payload: { from, to, at, ...payload }
      });
    }
  });

  function hardStop(code, message, payload = {}) {
    const status = code === 'AGENT_TIMEOUT' ? RUN_STATUS.TIMEOUT : RUN_STATUS.HARD_STOPPED;
    recordRunEvent('guard_hard_stop', {
      agent: payload.agent || null,
      status,
      errorCode: code,
      errorMessage: message,
      payload: { limits, ...payload }
    });
    throw new AgentRecoveryHardStopError(message, {
      code,
      limits,
      ...payload
    });
  }

  function assertNotTimedOut(agent = null) {
    const elapsedMs = Date.now() - startedAt;
    if (elapsedMs > limits.timeoutMs) {
      hardStop('AGENT_TIMEOUT', `Agent runtime timeout after ${elapsedMs}ms.`, { agent, elapsedMs });
    }
  }

  function recordToolCall(agent) {
    totalToolCalls += 1;
    const nextSameCount = (toolCallCounts.get(agent) || 0) + 1;
    toolCallCounts.set(agent, nextSameCount);
    if (totalToolCalls > limits.maxToolCalls) {
      hardStop('AGENT_MAX_TOOL_CALLS_EXCEEDED', `Agent runtime exceeded maxToolCalls=${limits.maxToolCalls}.`, {
        agent,
        totalToolCalls
      });
    }
    if (nextSameCount > limits.maxSameToolCalls) {
      hardStop('AGENT_MAX_SAME_TOOL_CALLS_EXCEEDED', `Agent runtime exceeded maxSameToolCalls=${limits.maxSameToolCalls} for ${agent}.`, {
        agent,
        sameToolCalls: nextSameCount
      });
    }
  }

  stateMachine.transition(RUN_STATUS.RUNNING, {
    reason: 'agent_workflow_started',
    goal,
    hasAnswer: Boolean(answer),
    executionPlanLength: executionPlan.length,
    sessionId,
    resumeId,
    userId,
    jobId,
    vectorProvider,
    limits
  });

  recordRunEvent('run_start', {
    status: stateMachine.status,
    payload: {
      goal,
      hasAnswer: Boolean(answer),
      executionPlanLength: executionPlan.length,
      sessionId,
      resumeId,
      userId,
      jobId,
      vectorProvider,
      limits
    }
  });

  logger.info('agent_runtime.run.start', {
    runtimeRunId,
    goal,
    hasAnswer: Boolean(answer),
    executionPlanLength: executionPlan.length,
    sessionId,
    resumeId,
    userId,
    jobId,
    vectorProvider,
    limits
  });

  assertNotTimedOut();
  const memoryContext = await loadRuntimeMemory({ goal, userId, resumeId, sessionId, jobId });
  recordRunEvent('memory_loaded', {
    status: 'succeeded',
    payload: {
      total: memoryContext.items.length,
      buckets: memoryContext.buckets
    }
  });
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
    assertNotTimedOut(step.agent);
    recordToolCall(step.agent);
    const stepStartedAt = Date.now();
    recordRunEvent('step_start', {
      agent: step.agent,
      status: 'running',
      payload: { order: step.order, text: step.text, totalToolCalls }
    });
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
        query: result.query,
        topK: result.topK,
        resumeResults: result.resumeResults,
        historyResults: result.historyResults,
        kbSource: result.kbSource,
        resumeId: result.resumeId,
        memoryResults: memoryContext.items.length,
        vectorProvider
      };
      recordRunEvent('rag_retrieval', {
        agent: step.agent,
        status: 'succeeded',
        latencyMs: Date.now() - stepStartedAt,
        payload: {
          query: result.query,
          topK: result.topK,
          kbSource: result.kbSource,
          resumeId: result.resumeId,
          vectorProvider,
          retrieved: result.retrieved.map((item) => ({
            id: item.id,
            source: item.source,
            score: item.score,
            pointId: item.pointId || null,
            content: item.content
          }))
        }
      });
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
    recordRunEvent('step_success', {
      agent: step.agent,
      status: 'succeeded',
      latencyMs: Date.now() - stepStartedAt,
      payload: { order: step.order }
    });
    assertNotTimedOut(step.agent);
  }

  for (const step of executionPlan) {
    try {
      if (executionPlan.length > limits.maxSteps) {
        hardStop('AGENT_MAX_STEPS_EXCEEDED', `Agent runtime refused executionPlan length ${executionPlan.length}; maxSteps=${limits.maxSteps}.`, {
          agent: step.agent,
          executionPlanLength: executionPlan.length
        });
      }
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
      const terminalStatus = deriveFailureStatus(error);
      if (!stateMachine.isTerminal()) {
        stateMachine.transition(terminalStatus, {
          reason: 'agent_workflow_failed',
          errorCode: classifiedError.code,
          stepName: step.agent
        });
      }
      recordRunEvent('run_failed', {
        agent: step.agent,
        status: stateMachine.status,
        errorCode: classifiedError.code,
        errorMessage: classifiedError.message,
        latencyMs: Date.now() - startedAt,
        payload: {
          stepName: step.agent,
          llmSummary,
          recovery,
          limits,
          totalToolCalls,
          toolCallCounts: Object.fromEntries(toolCallCounts.entries())
        }
      });

      logger.info('agent_runtime.run.failed', {
        runtimeRunId,
        error: classifiedError,
        llmSummary,
        recovery,
        latencyMs: Date.now() - startedAt
      });

      return {
        runtimeRunId,
        status: stateMachine.status,
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
        runEvents,
        stateTransitions: stateMachine.transitions,
        runtimeLimits: limits,
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
  if (!stateMachine.isTerminal()) {
    stateMachine.transition(RUN_STATUS.SUCCEEDED, {
      reason: 'agent_workflow_completed',
      outputSteps: agentOutputs.length,
      totalToolCalls
    });
  }
  recordRunEvent('run_success', {
    status: stateMachine.status,
    latencyMs: Date.now() - startedAt,
    payload: {
      outputSteps: agentOutputs.length,
      llmSummary,
      memoryWriteId: memoryWrite.memory?.id || null,
      memoryWriteError: memoryWrite.error,
      limits,
      totalToolCalls,
      toolCallCounts: Object.fromEntries(toolCallCounts.entries())
    }
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
      status: stateMachine.status,
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
    runEvents,
      stateTransitions: stateMachine.transitions,
    runtimeLimits: limits,
    vectorProvider
  };
}
