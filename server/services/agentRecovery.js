import crypto from 'node:crypto';

const DEFAULT_POLICY = {
  maxAttemptsPerStep: 1,
  maxAttemptsPerRun: 3,
  maxSameErrorPerRun: 2,
  maxRecoveryTokens: 8000,
  maxRecoveryCostUsd: 0.02,
  retryBaseDelayMs: 200,
  tokenCostPer1M: 0.14
};

const TRANSIENT_CODES = new Set(['LLM_TIMEOUT', 'LLM_RATE_LIMIT', 'TOOL_TIMEOUT', 'TOOL_TEMPORARY_FAILURE']);

export class AgentRecoveryHardStopError extends Error {
  constructor(message, details = {}) {
    super(message);
    this.name = 'AgentRecoveryHardStopError';
    this.code = details.code || 'AGENT_RECOVERY_HARD_STOP';
    this.details = details;
  }
}

function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  return `{${Object.keys(value).sort().map((key) => `${JSON.stringify(key)}:${stableStringify(value[key])}`).join(',')}}`;
}

function hashValue(value) {
  return crypto.createHash('sha256').update(stableStringify(value)).digest('hex').slice(0, 16);
}

function estimateTokens(value) {
  if (value === undefined || value === null) return 0;
  const text = typeof value === 'string' ? value : stableStringify(value);
  return Math.ceil(text.length / 4);
}

function resolvePolicy(policy = {}) {
  return { ...DEFAULT_POLICY, ...policy };
}

export function classifyAgentError(error = {}) {
  const message = String(error.message || error.error || error || '');
  const status = Number(error.status || error.statusCode || 0);
  const lower = message.toLowerCase();

  if (error.name === 'AbortError' || lower.includes('timeout') || lower.includes('timed out')) return { code: 'LLM_TIMEOUT', retryable: true };
  if (status === 429 || lower.includes('rate limit') || lower.includes('too many requests')) return { code: 'LLM_RATE_LIMIT', retryable: true };
  if (lower.includes('json') && (lower.includes('parse') || lower.includes('unexpected'))) return { code: 'LLM_BAD_RESPONSE', retryable: true };
  if (lower.includes('invalid') && lower.includes('arg')) return { code: 'TOOL_INVALID_ARGS', retryable: true };
  if (lower.includes('auth') || status === 401 || status === 403) return { code: 'AUTH_FAILED', retryable: false };
  if (lower.includes('schema') || lower.includes('migration')) return { code: 'SCHEMA_MISMATCH', retryable: false };

  return { code: error.code || 'UNKNOWN', retryable: Boolean(error.retryable) };
}

export function createErrorFingerprint({ error, stepName = '', toolName = '', args = null }) {
  const classified = classifyAgentError(error);
  return {
    fingerprint: hashValue({
      code: classified.code,
      stepName,
      toolName,
      args
    }),
    code: classified.code,
    stepName,
    toolName,
    argsHash: args == null ? null : hashValue(args)
  };
}

export function createFingerprintCache(initialEntries = []) {
  const entries = new Map();
  for (const entry of initialEntries) {
    if (entry?.fingerprint) entries.set(entry.fingerprint, { ...entry });
  }

  return {
    get(fingerprint) {
      return entries.get(fingerprint) || null;
    },
    record({ fingerprint, code, stepName, toolName, argsHash, message, outcome = 'pending' }) {
      const now = new Date().toISOString();
      const current = entries.get(fingerprint);
      const next = {
        fingerprint,
        code,
        stepName,
        toolName,
        argsHash,
        firstSeenAt: current?.firstSeenAt || now,
        lastSeenAt: now,
        attempts: (current?.attempts || 0) + 1,
        lastOutcome: outcome,
        lastMessage: message || current?.lastMessage || ''
      };
      entries.set(fingerprint, next);
      return next;
    },
    markOutcome(fingerprint, outcome) {
      const current = entries.get(fingerprint);
      if (!current) return null;
      const next = { ...current, lastSeenAt: new Date().toISOString(), lastOutcome: outcome };
      entries.set(fingerprint, next);
      return next;
    },
    toJSON() {
      return [...entries.values()];
    }
  };
}

function stripJsonMarkdown(raw) {
  const text = String(raw || '').trim();
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] || text).trim();
}

export function ruleRepairJson(raw) {
  const attempts = [];
  const stripped = stripJsonMarkdown(raw);
  attempts.push({ name: 'strip_markdown_fence', value: stripped });

  const objectStart = stripped.indexOf('{');
  const objectEnd = stripped.lastIndexOf('}');
  if (objectStart >= 0 && objectEnd > objectStart) {
    attempts.push({ name: 'extract_object', value: stripped.slice(objectStart, objectEnd + 1) });
  }

  const arrayStart = stripped.indexOf('[');
  const arrayEnd = stripped.lastIndexOf(']');
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    attempts.push({ name: 'extract_array', value: stripped.slice(arrayStart, arrayEnd + 1) });
  }

  for (const attempt of attempts) {
    const normalized = attempt.value.replace(/,\s*([}\]])/g, '$1');
    try {
      return {
        ok: true,
        object: JSON.parse(normalized),
        rule: normalized === attempt.value ? attempt.name : `${attempt.name}_remove_trailing_commas`
      };
    } catch {
      // Try the next deterministic repair.
    }
  }

  return { ok: false, error: 'Unable to repair JSON with deterministic rules' };
}

export function createRecoveryRuntime({ policy = {}, initialFingerprints = [] } = {}) {
  const resolvedPolicy = resolvePolicy(policy);
  const fingerprintCache = createFingerprintCache(initialFingerprints);
  const events = [];
  const budget = {
    usedTokens: 0,
    estimatedCostUsd: 0
  };
  let attemptsPerRun = 0;

  function recordEvent(event) {
    events.push({ at: new Date().toISOString(), ...event });
  }

  function consumeBudget(payload, reason) {
    const tokens = estimateTokens(payload);
    const cost = (tokens / 1_000_000) * resolvedPolicy.tokenCostPer1M;
    budget.usedTokens += tokens;
    budget.estimatedCostUsd += cost;
    recordEvent({ type: 'recovery_budget', reason, tokens, costUsd: Number(cost.toFixed(8)) });

    if (budget.usedTokens > resolvedPolicy.maxRecoveryTokens) {
      throw new AgentRecoveryHardStopError('自动恢复已停止：恢复 token 预算耗尽。', {
        code: 'RECOVERY_TOKEN_BUDGET_EXCEEDED',
        budget: { ...budget }
      });
    }
    if (budget.estimatedCostUsd > resolvedPolicy.maxRecoveryCostUsd) {
      throw new AgentRecoveryHardStopError('自动恢复已停止：恢复成本预算耗尽。', {
        code: 'RECOVERY_COST_BUDGET_EXCEEDED',
        budget: { ...budget }
      });
    }
  }

  function shouldStopForFingerprint(fingerprintEntry) {
    return fingerprintEntry.attempts > resolvedPolicy.maxSameErrorPerRun || fingerprintEntry.lastOutcome === 'failed';
  }

  function snapshot() {
    return {
      policy: resolvedPolicy,
      budget: {
        usedTokens: budget.usedTokens,
        maxRecoveryTokens: resolvedPolicy.maxRecoveryTokens,
        estimatedCostUsd: Number(budget.estimatedCostUsd.toFixed(8)),
        maxRecoveryCostUsd: resolvedPolicy.maxRecoveryCostUsd
      },
      fingerprints: fingerprintCache.toJSON(),
      events
    };
  }

  async function runStep({ stepName, args = null, operation }) {
    let attempt = 0;
    let lastFingerprint = null;
    while (true) {
      try {
        const result = await operation({ attempt });
        if (attempt > 0) {
          if (lastFingerprint) fingerprintCache.markOutcome(lastFingerprint, 'recovered');
          recordEvent({ type: 'recovery_success', stepName, attempts: attempt });
        }
        return result;
      } catch (error) {
        if (error instanceof AgentRecoveryHardStopError) {
          recordEvent({
            type: 'recovery_hard_stop',
            stepName,
            code: error.code,
            message: error.message
          });
          throw error;
        }
        const classified = classifyAgentError(error);
        const fp = createErrorFingerprint({ error, stepName, args });
        const entry = fingerprintCache.record({
          ...fp,
          message: error.message,
          outcome: 'pending'
        });
        lastFingerprint = fp.fingerprint;

        recordEvent({
          type: 'recovery_error',
          stepName,
          code: classified.code,
          fingerprint: fp.fingerprint,
          message: error.message
        });

        if (!classified.retryable || shouldStopForFingerprint(entry)) {
          fingerprintCache.markOutcome(fp.fingerprint, 'failed');
          throw new AgentRecoveryHardStopError('自动恢复已停止：错误不可恢复或重复出现。', {
            code: classified.retryable ? 'RECOVERY_REPEATED_ERROR' : 'RECOVERY_UNSUPPORTED_ERROR',
            originalCode: classified.code,
            fingerprint: fp.fingerprint,
            stepName,
            message: error.message,
            recovery: snapshot()
          });
        }

        if (attempt >= resolvedPolicy.maxAttemptsPerStep || attemptsPerRun >= resolvedPolicy.maxAttemptsPerRun) {
          fingerprintCache.markOutcome(fp.fingerprint, 'failed');
          throw new AgentRecoveryHardStopError('自动恢复已停止：恢复次数达到上限。', {
            code: 'RECOVERY_ATTEMPT_LIMIT_EXCEEDED',
            originalCode: classified.code,
            fingerprint: fp.fingerprint,
            stepName,
            message: error.message,
            recovery: snapshot()
          });
        }

        attempt += 1;
        attemptsPerRun += 1;
        consumeBudget({ stepName, args, error: error.message, code: classified.code }, 'step_retry');

        if (!TRANSIENT_CODES.has(classified.code)) {
          fingerprintCache.markOutcome(fp.fingerprint, 'failed');
          throw new AgentRecoveryHardStopError('自动恢复已停止：该错误需要专用修复策略。', {
            code: 'RECOVERY_RULE_NOT_FOUND',
            originalCode: classified.code,
            fingerprint: fp.fingerprint,
            stepName,
            message: error.message,
            recovery: snapshot()
          });
        }

        const delayMs = resolvedPolicy.retryBaseDelayMs * attempt;
        recordEvent({ type: 'recovery_retry', stepName, attempt, delayMs, fingerprint: fp.fingerprint });
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }

  function repairJson({ stepName = 'json_parse', raw }) {
    const result = ruleRepairJson(raw);
    consumeBudget({ stepName, raw: String(raw || '').slice(0, 4000) }, 'json_rule_repair');
    recordEvent({
      type: result.ok ? 'recovery_rule_success' : 'recovery_rule_failed',
      stepName,
      rule: result.rule || null,
      error: result.error || null
    });
    return result;
  }

  return {
    runStep,
    repairJson,
    snapshot
  };
}
