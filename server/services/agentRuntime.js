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

export async function loadRuntimeMemory({ goal, userId, resumeId, sessionId, jobId }) {
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

const AGENT_ORDER = ['parser', 'planner', 'retriever', 'interviewer', 'critic', 'writer'];

function normalizeConfidence(value, fallback = 0.7) {
  const n = Number(value);
  return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : fallback;
}

function makeCollaborativeOutput(agent, { observation, proposal, confidence = 0.7, nextAction = null, data = null } = {}) {
  return {
    agent,
    observation: observation || `${agent} completed its workspace update.`,
    proposal: proposal || 'Continue orchestration with the next best agent.',
    confidence: normalizeConfidence(confidence),
    nextAction,
    data
  };
}

function buildRuntimeStep({ agent, executionPlan = [], order }) {
  const template = executionPlan.find((step) => step.agent === agent);
  return {
    order,
    text: template?.text || `${agent} updates the shared workspace`,
    agent
  };
}

function pickPlannerNextAgent(plan, completedAgents) {
  const nextAgent = String(plan?.nextAgent || '').trim();
  if (AGENT_ORDER.includes(nextAgent) && !completedAgents.has(nextAgent)) return nextAgent;
  return null;
}

function determineNextAgent({ plan, completedAgents, answer, questions, critique, rewrite }) {
  if (!completedAgents.has('parser')) return 'parser';
  if (!completedAgents.has('planner')) return 'planner';

  const plannerNext = pickPlannerNextAgent(plan, completedAgents);
  if (plannerNext === 'retriever') return 'retriever';
  if (!completedAgents.has('retriever')) return 'retriever';

  if (plannerNext === 'interviewer') return 'interviewer';
  if (!questions && !completedAgents.has('interviewer')) return 'interviewer';

  if (!answer) return null;
  if (plannerNext === 'critic') return 'critic';
  if (!critique && !completedAgents.has('critic')) return 'critic';

  if (plannerNext === 'writer') return 'writer';
  if (!rewrite && !completedAgents.has('writer')) return 'writer';

  return null;
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
  vectorProvider = defaultVectorProvider,
  runtimeRunId: providedRuntimeRunId = null,
  onRunEvent = null
} = {}) {
  const runtimeRunId = providedRuntimeRunId || makeRuntimeId();
  const startedAt = Date.now();
  const limits = createRuntimeLimits();
  const runEvents = [];
  const toolCallCounts = new Map();
  let eventSequence = 0;
  let totalToolCalls = 0;
  let eventDelivery = Promise.resolve();

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
    if (onRunEvent) {
      eventDelivery = eventDelivery.then(() => onRunEvent(event)).catch((error) => {
        logger.info('agent_runtime.event_delivery_failed', {
          runtimeRunId,
          sequence: event.sequence,
          type,
          error: error.message
        });
      });
    }
    return event;
  }

  async function flushRunEvents() {
    await eventDelivery;
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
  const completedAgents = new Set();
  const orchestrationHistory = [];
  const workspaceState = {
    goal,
    answer,
    sourceText,
    sections,
    risks,
    memoryContext,
    retrieved,
    questions,
    critique,
    rewrite,
    observations: [],
    proposals: [],
    completedAgents: [],
    nextAction: null
  };

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

    let collaborativeOutput = null;
    if (step.agent === 'parser') {
      parseOutput = { sections, risks: risks.length ? risks : detectRisks(sourceText) };
      collaborativeOutput = makeCollaborativeOutput('parser', {
        observation: `识别到 ${parseOutput.sections.length} 个简历模块和 ${parseOutput.risks.length} 个风险提示。`,
        proposal: '将结构化模块交给 planner 判断下一位协作 agent。',
        confidence: parseOutput.sections.length ? 0.84 : 0.55,
        nextAction: 'planner',
        data: parseOutput
      });
    } else if (step.agent === 'planner') {
      plan = await planNextStep({ goal, history: orchestrationHistory.length ? orchestrationHistory : history, sections, memoryContext });
      if (plan.llm) llmTrace.push({ agent: 'planner', ...plan.llm });
      collaborativeOutput = makeCollaborativeOutput('planner', {
        observation: `当前阶段判断为「${plan.currentStage || 'general'}」。`,
        proposal: plan.reason || '根据目标、历史和简历模块决定下一位 specialist agent。',
        confidence: plan.mode === 'live' ? 0.82 : 0.64,
        nextAction: plan.nextAgent || 'retriever',
        data: plan
      });
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
      collaborativeOutput = makeCollaborativeOutput('retriever', {
        observation: `从 ${retrievalMeta.kbSource} 知识库取回 ${retrieved.length} 条上下文，长期记忆命中 ${memoryContext.items.length} 条。`,
        proposal: '将召回片段写入共享 workspace，供 interviewer/critic/writer 共同引用。',
        confidence: retrieved.length ? 0.78 : 0.48,
        nextAction: answer ? 'critic' : 'interviewer',
        data: { retrieved, retrievalMeta, memoryContext }
      });
    } else if (step.agent === 'interviewer') {
      const result = await generateInterviewQuestions({ goal, retrieved, previousAnswer: answer, depth, askedQuestions, memoryContext });
      questions = result.questions;
      if (result.llm) llmTrace.push({ agent: 'interviewer', ...result.llm });
      collaborativeOutput = makeCollaborativeOutput('interviewer', {
        observation: `生成第 ${depth + 1} 轮「${result.stage || '追问'}」问题。`,
        proposal: answer ? '已有回答，交给 critic 评估回答质量。' : '等待用户回答当前问题后再进入 critic/writer。',
        confidence: result.mode === 'live' ? 0.82 : 0.65,
        nextAction: answer ? 'critic' : null,
        data: result
      });
    } else if (step.agent === 'critic' && answer) {
      critique = await critiqueAnswer({ answer, retrieved, question: questions?.detail?.[0] || questions?.basic?.[0] || '', memoryContext });
      if (critique.llm) llmTrace.push({ agent: 'critic', ...critique.llm });
      collaborativeOutput = makeCollaborativeOutput('critic', {
        observation: `完成回答评估，语义匹配度 ${critique.scores?.semanticMatch ?? '-'}。`,
        proposal: '将反馈交给 writer 生成可改进表达。',
        confidence: critique.mode === 'live' ? 0.82 : 0.68,
        nextAction: 'writer',
        data: critique
      });
    } else if (step.agent === 'writer' && answer) {
      rewrite = await rewriteArtifacts({ text: sourceText, answer, feedback: critique?.feedback || [], memoryContext });
      if (rewrite.llm) llmTrace.push({ agent: 'writer', ...rewrite.llm });
      collaborativeOutput = makeCollaborativeOutput('writer', {
        observation: rewrite.improvedAnswer ? '已基于 critic 反馈生成改进回答。' : '未生成改进回答。',
        proposal: '本轮协作可以收束，等待用户确认或继续追问。',
        confidence: rewrite.mode === 'live' ? 0.8 : 0.62,
        nextAction: null,
        data: rewrite
      });
    } else {
      collaborativeOutput = makeCollaborativeOutput(step.agent, {
        observation: `${step.agent} 当前没有满足执行条件，已跳过。`,
        proposal: '继续由 orchestrator 选择下一步。',
        confidence: 0.5,
        nextAction: null,
        data: null
      });
    }

    workspaceState.retrieved = retrieved;
    workspaceState.questions = questions;
    workspaceState.critique = critique;
    workspaceState.rewrite = rewrite;
    workspaceState.observations.push({ agent: step.agent, value: collaborativeOutput.observation });
    workspaceState.proposals.push({ agent: step.agent, value: collaborativeOutput.proposal, confidence: collaborativeOutput.confidence });
    workspaceState.nextAction = collaborativeOutput.nextAction;
    completedAgents.add(step.agent);
    workspaceState.completedAgents = [...completedAgents];
    orchestrationHistory.push({
      agent: step.agent,
      observation: collaborativeOutput.observation,
      proposal: collaborativeOutput.proposal,
      confidence: collaborativeOutput.confidence,
      nextAction: collaborativeOutput.nextAction
    });
    agentOutputs.push({ step, output: collaborativeOutput, workspaceState: { ...workspaceState, sourceText: undefined } });
    recordRunEvent('agent_observation', {
      agent: step.agent,
      status: 'succeeded',
      payload: {
        observation: collaborativeOutput.observation,
        proposal: collaborativeOutput.proposal,
        confidence: collaborativeOutput.confidence,
        nextAction: collaborativeOutput.nextAction,
        completedAgents: workspaceState.completedAgents
      }
    });

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

  let nextAgent = determineNextAgent({ plan, completedAgents, answer, questions, critique, rewrite });
  while (nextAgent) {
    const step = buildRuntimeStep({ agent: nextAgent, executionPlan, order: orchestrationHistory.length + 1 });
    try {
      if (orchestrationHistory.length >= limits.maxSteps) {
        hardStop('AGENT_MAX_STEPS_EXCEEDED', `Agent runtime refused more than maxSteps=${limits.maxSteps}.`, {
          agent: step.agent,
          executionPlanLength: executionPlan.length,
          orchestrationHistoryLength: orchestrationHistory.length
        });
      }
      recordRunEvent('orchestrator_decision', {
        agent: step.agent,
        status: 'selected',
        payload: {
          reason: completedAgents.has('planner') ? 'planner_and_workspace_state' : 'bootstrap',
          plannerNextAgent: plan?.nextAgent || null,
          completedAgents: [...completedAgents],
          workspaceNextAction: workspaceState.nextAction
        }
      });
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

      const result = {
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
        vectorProvider,
        workspaceState,
        orchestrationHistory
      };
      await flushRunEvents();
      return result;
    }
    nextAgent = determineNextAgent({ plan, completedAgents, answer, questions, critique, rewrite });
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

  const result = {
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
    vectorProvider,
    workspaceState,
    orchestrationHistory
  };
  await flushRunEvents();
  return result;
}
