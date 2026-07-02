import { createHash } from 'crypto';
import { performance } from 'perf_hooks';
import { RunnableLambda, RunnableSequence } from '@langchain/core/runnables';
import { Annotation, END, START, StateGraph } from '@langchain/langgraph';
import { chunkText } from '../services/vectorStore.shared.js';
import { detectRisks, splitSections } from '../services/resumeParser.js';

function tokenize(value = '') {
  return [...new Set(String(value).toLowerCase().match(/[a-z0-9+#.]+|[\u3400-\u9fff]{2,}/g) || [])];
}

function parseStage(state) {
  return {
    ...state,
    sections: splitSections(state.text),
    risks: detectRisks(state.text),
    chunks: chunkText(state.text, 120)
  };
}

function retrieveStage(state) {
  const terms = tokenize(state.goal);
  const retrieved = state.chunks
    .map((content, index) => ({
      id: index + 1,
      content,
      score: terms.reduce((score, term) => score + (content.toLowerCase().includes(term) ? 1 : 0), 0)
    }))
    .sort((a, b) => b.score - a.score || a.id - b.id)
    .slice(0, 3);
  return { ...state, retrieved };
}

function summarizeStage(state) {
  return {
    ...state,
    result: {
      sectionCount: state.sections.length,
      riskCount: state.risks.length,
      retrievedIds: state.retrieved.map((item) => item.id),
      topContent: state.retrieved[0]?.content || ''
    }
  };
}

export async function runNativeOrchestration(input) {
  return summarizeStage(retrieveStage(parseStage({ ...input })));
}

export function createLangChainOrchestration() {
  return RunnableSequence.from([
    new RunnableLambda({ func: async (state) => parseStage(state) }),
    new RunnableLambda({ func: async (state) => retrieveStage(state) }),
    new RunnableLambda({ func: async (state) => summarizeStage(state) })
  ]);
}

export function createLangGraphOrchestration() {
  const State = Annotation.Root({
    text: Annotation(),
    goal: Annotation(),
    sections: Annotation(),
    risks: Annotation(),
    chunks: Annotation(),
    retrieved: Annotation(),
    result: Annotation()
  });
  return new StateGraph(State)
    .addNode('parse', (state) => parseStage(state))
    .addNode('retrieve', (state) => retrieveStage(state))
    .addNode('summarize', (state) => summarizeStage(state))
    .addEdge(START, 'parse')
    .addEdge('parse', 'retrieve')
    .addEdge('retrieve', 'summarize')
    .addEdge('summarize', END)
    .compile();
}

function percentile(values, p) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * p))];
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

async function benchmark(name, invoke, input, iterations) {
  const latencies = [];
  let output;
  await invoke(input);
  for (let index = 0; index < iterations; index += 1) {
    const startedAt = performance.now();
    output = await invoke(input);
    latencies.push(performance.now() - startedAt);
  }
  return {
    name,
    iterations,
    avgMs: Number((latencies.reduce((sum, item) => sum + item, 0) / latencies.length).toFixed(3)),
    p50Ms: Number(percentile(latencies, 0.5).toFixed(3)),
    p95Ms: Number(percentile(latencies, 0.95).toFixed(3)),
    outputHash: digest(output.result),
    result: output.result
  };
}

export async function runOrchestrationComparison({
  input = {
    text: '项目经历\n负责 ResumePilot RAG 检索与多 Agent 面试系统，使用 Node.js、Qdrant 和 MCP。\n技能\nReact TypeScript LangGraph',
    goal: 'RAG Agent 面试'
  },
  iterations = 20
} = {}) {
  const safeIterations = Math.max(1, Math.min(Number(iterations) || 20, 500));
  const langChain = createLangChainOrchestration();
  const langGraph = createLangGraphOrchestration();
  const results = await Promise.all([
    benchmark('native', runNativeOrchestration, input, safeIterations),
    benchmark('langchain-runnable-sequence', (value) => langChain.invoke(value), input, safeIterations),
    benchmark('langgraph-state-graph', (value) => langGraph.invoke(value), input, safeIterations)
  ]);
  const outputHashes = [...new Set(results.map((item) => item.outputHash))];
  return {
    experiment: 'orchestration-comparison',
    versions: {
      protocol: '1.0.0',
      workload: 'resume-parse-lexical-retrieve-summarize-v1'
    },
    iterations: safeIterations,
    outputParity: outputHashes.length === 1,
    results
  };
}
