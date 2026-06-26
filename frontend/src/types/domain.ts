export type LlmMode = 'live' | 'fallback';

export interface LlmUsage {
  promptTokens: number | null;
  completionTokens: number | null;
  totalTokens: number | null;
}

export interface LlmMeta {
  mode: LlmMode;
  model: string | null;
  latencyMs: number;
  usage: LlmUsage | null;
  error: string | null;
}

export interface LlmTraceItem extends LlmMeta {
  agent: string;
}

export interface LlmSummary {
  calls: number;
  liveCalls: number;
  fallbackCalls: number;
  mode: 'none' | 'live' | 'fallback' | 'mixed';
  totalLatencyMs: number;
  avgLatencyMs: number;
  totalTokens: number;
  models: string[];
  errors: { agent: string; error: string }[];
}

export interface Section {
  title: string;
  content: string[];
}

export interface Risk {
  term: string;
  reason: string;
}

export interface RetrievedChunk {
  source?: string;
  score: number;
  content: string;
  [key: string]: unknown;
}

export interface ParseResult {
  resumeId?: string;
  text: string;
  sections: Section[];
  risks: Risk[];
  kbSize: number;
  vectorProvider?: string;
  chunks?: RetrievedChunk[];
  error?: string;
}

export interface Resume {
  id: string;
  title?: string;
  text: string;
  sections?: Section[];
  risks?: Risk[];
  kbSize?: number;
  chunks?: RetrievedChunk[];
  vectorProvider?: string | null;
  createdAt: string;
  updatedAt?: string;
}

export interface ExecutionStep {
  agent: string;
  text?: string;
  [key: string]: unknown;
}

export interface AgentOutput {
  step: ExecutionStep;
  output: unknown;
}

export interface RetrievalMeta {
  resumeResults?: number;
  historyResults?: number;
  kbSource?: string;
  resumeId?: string | null;
}

export interface Run {
  id: string;
  goal?: string;
  skillId?: string | null;
  skill?: { id?: string; name?: string } | null;
  vectorProvider?: string | null;
  hasAnswer?: boolean;
  resumeId?: string | null;
  executionPlan?: ExecutionStep[];
  agentOutputs?: AgentOutput[];
  retrievalMeta?: RetrievalMeta | null;
  llmTrace?: LlmTraceItem[];
  llmSummary?: LlmSummary;
  createdAt: string;
}

export interface Turn {
  id: string;
  question?: string;
  answer?: string;
  critique?: string[] | string;
  improvedAnswer?: string;
  retrieved?: RetrievedChunk[];
  runId?: string;
  resumeId?: string | null;
  createdAt?: string;
}

export interface Session {
  id: string;
  title: string;
  goal?: string;
  createdAt: string;
  updatedAt?: string;
  turns?: Turn[];
  runs?: string[];
  resumeId?: string | null;
}

export interface JdCoverageItem {
  requirement: string;
  score: number;
  covered: boolean;
}

export interface JdMatchResult {
  resumeId?: string | null;
  matchScore: number;
  coverage: JdCoverageItem[];
  matched: string[];
  gaps: string[];
  suggestions: string[];
  mode: LlmMode;
  llm?: LlmMeta;
}

export interface LlmReadiness {
  mode: LlmMode;
  configured: boolean;
  model: string;
  baseUrl: string;
  notes?: string[];
}

export interface QdrantReadiness {
  provider: string;
  configured: boolean;
  serviceReachable: boolean;
  collectionReachable: boolean;
  env?: {
    QDRANT_URL: string | null;
    QDRANT_COLLECTION: string;
    QDRANT_VECTOR_SIZE?: string;
    QDRANT_API_KEY?: string;
  };
  notes?: string[];
}

export interface DashboardOverview {
  resumes: number;
  runs: number;
  sessions: number;
  totalTurns: number;
  vectorProvider?: string;
}

export interface DashboardQuality {
  avgRetrievalScore: number;
  avgSessionDepth: number;
  skillRoutedRuns: number;
  riskCoverage: number;
  avgCritiqueLength: number;
  improvedAnswerCoverage: number;
}

export interface DashboardTrendItem {
  title: string;
  turns: number;
  createdAt: string;
}

export interface DashboardRetrievalSample {
  session: string;
  question?: string;
  retrieved: RetrievedChunk[];
}

export interface Dashboard {
  overview?: DashboardOverview;
  quality?: DashboardQuality;
  sourceMix?: { resume: number; session_history: number };
  evalNotes?: string[];
  trend?: DashboardTrendItem[];
  retrievalSamples?: DashboardRetrievalSample[];
}
