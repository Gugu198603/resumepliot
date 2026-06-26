// Aggregates LLM call traces (collected per run) into cost & latency metrics.
// Pricing is per 1M tokens (USD), overridable via LLM_PRICING env (JSON map of
// model -> { prompt, completion }). Unknown models fall back to DEFAULT pricing.

const DEFAULT_PRICING = {
  'deepseek-chat': { prompt: 0.27, completion: 1.1 },
  'gpt-4o-mini': { prompt: 0.15, completion: 0.6 },
  'gpt-4o': { prompt: 2.5, completion: 10 },
  default: { prompt: 0.5, completion: 1.5 }
};

function loadPricing() {
  const raw = process.env.LLM_PRICING;
  if (!raw) return DEFAULT_PRICING;
  try {
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_PRICING, ...parsed };
  } catch {
    return DEFAULT_PRICING;
  }
}

function priceFor(pricing, model) {
  return pricing[model] || pricing.default || DEFAULT_PRICING.default;
}

function estimateCost(pricing, model, promptTokens, completionTokens) {
  const rate = priceFor(pricing, model);
  const p = (Number(promptTokens) || 0) / 1_000_000 * rate.prompt;
  const c = (Number(completionTokens) || 0) / 1_000_000 * rate.completion;
  return p + c;
}

function emptyBucket() {
  return { calls: 0, liveCalls: 0, fallbackCalls: 0, errorCalls: 0, totalLatencyMs: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, costUsd: 0 };
}

function addToBucket(bucket, item, costUsd) {
  bucket.calls += 1;
  if (item.mode === 'live') bucket.liveCalls += 1; else bucket.fallbackCalls += 1;
  if (item.error) bucket.errorCalls += 1;
  bucket.totalLatencyMs += Number(item.latencyMs) || 0;
  bucket.promptTokens += Number(item.usage?.promptTokens) || 0;
  bucket.completionTokens += Number(item.usage?.completionTokens) || 0;
  bucket.totalTokens += Number(item.usage?.totalTokens) || 0;
  bucket.costUsd += costUsd;
}

function finalizeBucket(bucket) {
  return {
    ...bucket,
    avgLatencyMs: bucket.calls ? Math.round(bucket.totalLatencyMs / bucket.calls) : 0,
    costUsd: Number(bucket.costUsd.toFixed(6))
  };
}

// runs: array of run records, each may carry an llmTrace array of
// { agent, mode, model, latencyMs, usage:{promptTokens,completionTokens,totalTokens}, error }.
export function computeLlmMetrics(runs = []) {
  const pricing = loadPricing();
  const overall = emptyBucket();
  const byModel = new Map();
  const byAgent = new Map();
  let runsWithLlm = 0;
  let latestAt = null;

  for (const run of runs) {
    const trace = Array.isArray(run.llmTrace) ? run.llmTrace : [];
    if (trace.length) {
      runsWithLlm += 1;
      if (run.createdAt && (!latestAt || run.createdAt > latestAt)) latestAt = run.createdAt;
    }
    for (const item of trace) {
      const model = item.model || 'unknown';
      const cost = estimateCost(pricing, item.model, item.usage?.promptTokens, item.usage?.completionTokens);
      addToBucket(overall, item, cost);
      if (!byModel.has(model)) byModel.set(model, emptyBucket());
      addToBucket(byModel.get(model), item, cost);
      const agent = item.agent || 'unknown';
      if (!byAgent.has(agent)) byAgent.set(agent, emptyBucket());
      addToBucket(byAgent.get(agent), item, cost);
    }
  }

  return {
    overview: {
      runs: runs.length,
      runsWithLlm,
      ...finalizeBucket(overall),
      latestRunAt: latestAt
    },
    byModel: [...byModel.entries()].map(([model, b]) => ({ model, ...finalizeBucket(b) })).sort((a, b) => b.costUsd - a.costUsd),
    byAgent: [...byAgent.entries()].map(([agent, b]) => ({ agent, ...finalizeBucket(b) })).sort((a, b) => b.totalLatencyMs - a.totalLatencyMs),
    pricing: { source: process.env.LLM_PRICING ? 'env' : 'default', unit: 'USD per 1M tokens', table: pricing }
  };
}
