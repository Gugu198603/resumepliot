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

export interface ResumeCorrectionSummary {
  beforeSectionCount?: number;
  afterSectionCount?: number;
  changedSectionTitles?: number;
  addedSections?: number;
  removedSections?: number;
  lineDelta?: number;
  contentChanged?: boolean;
}

export interface ResumeCorrectionEvent {
  id: string;
  resumeId: string;
  errorTypes: string[];
  beforeSections?: Section[];
  afterSections?: Section[];
  summary?: ResumeCorrectionSummary;
  createdAt: string;
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
  duplicateOf?: string;
  reusedExisting?: boolean;
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
  duplicateCount?: number;
  duplicateIds?: string[];
  createdAt: string;
  updatedAt?: string;
}

export interface ResumeGenerationIssue {
  path: string;
  code: string;
  message: string;
  value?: string;
  unsupported_tokens?: string[];
  source_ids?: string[];
}

export interface ResumeGenerationValidation {
  ok: boolean;
  issues: ResumeGenerationIssue[];
}

export interface ResumeGenerationPreview {
  ok: boolean;
  resumeId?: string;
  adjustment?: string;
  resume?: Record<string, unknown>;
  careerProfile?: Record<string, unknown>;
  optimization?: Record<string, unknown>;
  profile_validation?: ResumeGenerationValidation;
  resume_validation?: ResumeGenerationValidation;
  error?: string;
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

export interface RunError {
  code?: string;
  message?: string;
  stepName?: string;
  details?: unknown;
}

export interface RecoveryFingerprint {
  fingerprint: string;
  code?: string;
  stepName?: string;
  toolName?: string;
  argsHash?: string | null;
  firstSeenAt?: string;
  lastSeenAt?: string;
  attempts?: number;
  lastOutcome?: string;
  lastMessage?: string;
}

export interface RecoveryEvent {
  at?: string;
  type: string;
  stepName?: string;
  code?: string;
  fingerprint?: string;
  message?: string;
  reason?: string;
  tokens?: number;
  costUsd?: number;
  rule?: string | null;
  error?: string | null;
  attempt?: number;
  delayMs?: number;
}

export interface RecoverySnapshot {
  budget?: {
    usedTokens?: number;
    maxRecoveryTokens?: number;
    estimatedCostUsd?: number;
    maxRecoveryCostUsd?: number;
  };
  fingerprints?: RecoveryFingerprint[];
  events?: RecoveryEvent[];
}

export interface Run {
  id: string;
  status?: 'pending' | 'running' | 'succeeded' | 'failed' | 'timeout' | 'hard_stopped' | 'cancelled' | string;
  error?: RunError | null;
  runtimeRunId?: string | null;
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
  recovery?: RecoverySnapshot;
  runEvents?: RunEvent[];
  stateTransitions?: unknown[];
  runtimeLimits?: unknown;
  createdAt: string;
  updatedAt?: string;
}

export interface RunEvent {
  id?: string;
  runId?: string;
  runtimeRunId?: string | null;
  sequence?: number;
  type?: string;
  agent?: string | null;
  status?: string | null;
  latencyMs?: number | null;
  errorCode?: string | null;
  errorMessage?: string | null;
  payload?: unknown;
  createdAt?: string;
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
  depth?: number;
  stage?: string;
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

export interface JdGapReport {
  summary: string;
  matchedKeywords: string[];
  missingKeywords: string[];
}

export interface JdMatchResult {
  resumeId?: string | null;
  jobId?: string | null;
  matchId?: string | null;
  matchScore: number;
  coverage: JdCoverageItem[];
  matched: string[];
  gaps: string[];
  suggestions: string[];
  gapReport?: JdGapReport | null;
  mode: LlmMode;
  llm?: LlmMeta;
}

export interface JobDescription {
  id: string;
  title?: string | null;
  company?: string | null;
  source?: string | null;
  sourceUrl?: string | null;
  text: string;
  createdAt: string;
  updatedAt?: string;
}

export interface JobMatch {
  id: string;
  jobId: string;
  resumeId?: string | null;
  matchScore: number;
  result?: JdMatchResult | null;
  job?: JobDescription | null;
  createdAt: string;
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
  correctionMetrics?: {
    totalCorrections: number;
    correctedResumes: number;
    correctionRate: number;
    sectionChangeRatio: number;
    avgLineDelta: number;
    commonErrorTypes: { type: string; count: number }[];
  };
  sourceMix?: { resume: number; session_history: number };
  evalNotes?: string[];
  trend?: DashboardTrendItem[];
  retrievalSamples?: DashboardRetrievalSample[];
}

export interface LlmMetricBucket {
  calls: number;
  liveCalls: number;
  fallbackCalls: number;
  errorCalls: number;
  totalLatencyMs: number;
  avgLatencyMs: number;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  costUsd: number;
}

export interface LlmMetrics {
  overview: LlmMetricBucket & { runs: number; runsWithLlm: number; latestRunAt: string | null };
  byModel: (LlmMetricBucket & { model: string })[];
  byAgent: (LlmMetricBucket & { agent: string })[];
  pricing: { source: 'env' | 'default'; unit: string; table: Record<string, { prompt: number; completion: number }> };
}

export interface ResumeCompareMetrics {
  sections: number;
  risks: number;
  kbSize: number;
  chars: number;
}

export interface ResumeCompareItem {
  id: string;
  title: string;
  createdAt: string | null;
  metrics: ResumeCompareMetrics;
  uniqueKeywords: string[];
  riskTerms: string[];
}

export interface ResumeJobMatchScore {
  id: string;
  matchScore: number;
  mode: LlmMode;
}

export interface ResumeComparison {
  items: ResumeCompareItem[];
  commonKeywords: string[];
  jobMatchScores?: ResumeJobMatchScore[] | null;
  jobId?: string | null;
}
