# ResumePilot Architecture

## Module boundaries

```text
frontend/src/
├── App.tsx                         # Page composition and cross-feature state
├── features/
│   ├── interview/                  # Workspace + streaming/voice workflow hook + styles
│   ├── job-match/                  # Workspace + matching workflow hook + styles
│   ├── applications/               # Job application board + workflow hook + styles
│   └── resume-generation/          # Workspace + generation/export hook + styles
├── components/                     # Reusable domain panels
├── services/
│   ├── apiClient.ts                # HTTP error and JSON transport contract
│   ├── resumePilotApi.ts           # Typed REST facade
│   └── sseClient.ts                # Shared SSE parser
├── types/                          # Frontend domain contracts
├── styles/                         # Shared foundation, operations and responsive layers
├── styles.css                      # Ordered CSS composition entry
└── utils/                          # Pure presentation helpers

server/
├── index.js                        # Express middleware and route assembly only
├── routes/
│   ├── systemRoutes.js             # Health, diagnostics, runs, MCP and RAG eval
│   ├── applicationRoutes.js        # Job application lifecycle and linked artifacts
│   ├── memoryRoutes.js             # Memory inspection, lifecycle and promotion management
│   ├── resumeRoutes.js             # Resume CRUD
│   ├── resumeAnalysisRoutes.js     # Parse, correction, comparison and generation
│   ├── sessionRoutes.js            # Session CRUD
│   ├── sessionExecutionRoutes.js   # Interview turn JSON/SSE transport
│   ├── agentRoutes.js              # Agent run JSON/SSE transport
│   ├── jobRoutes.js                # Job sources, scheduler and history
│   ├── jobMatchRoutes.js           # Evidence-based JD matching
│   ├── skillRoutes.js              # Skill selection and execution planning
│   └── productRoutes.js            # Profile, reports, versions and export
├── services/                       # Domain/application services
├── agents/                         # Agent role implementations
├── tools/                          # Tool Gateway, agent allowlists, timeout and audit
├── middleware/                     # HTTP errors and security
└── mcp/                            # MCP protocol runtime and tool implementations
```

## Dependency rules

1. Route modules may call services, but services must not import Express or route modules.
2. Frontend features may use shared services and domain types; shared components must not import `App.tsx`.
3. All ordinary JSON requests go through `apiClient`; all streaming requests go through `sseClient`.
4. Export renderers consume the current immutable resume snapshot. They do not read React state or database state directly.
5. Database providers implement the contract exported by `server/services/database.js`.
6. Agent orchestration owns execution order; individual agents remain stateless domain functions.
7. JSON and SSE endpoints share the same execution service; transport must not duplicate domain workflows.

## Next extraction points

Long-running workflows live in `agentExecutionService` and `interviewSessionExecution`. Route modules only
select JSON or SSE transport, while `sseResponse` owns the wire protocol and connection lifecycle.

Operational dashboard aggregation and Qdrant readiness checks live in `systemMetrics`; the application
entry point does not contain product logic.

Agent memory follows the same database provider boundary as resumes and sessions. A session is created
before its first agent run, so the run record and summary memory share the same session identity.
Subsequent runs retrieve prior run summaries by resume, session, or job; repeated retrieval can promote
run summaries into longer-lived resume/session/user memory.

Memory administration is exposed separately from runtime retrieval. Operators can list all statuses,
write scoped records, archive/restore them, set or clear expiration, trigger promotion and delete a
record. Deletion removes the database row first and then deletes the exact Qdrant point; a failed
vector cleanup is reported without resurrecting the deleted memory, and orphan vector hits are ignored
because retrieval always resolves candidates through the database status filter.

Parser, retriever, critic and writer actions cross `Tool Gateway` and invoke MCP tools instead of
calling their domain functions directly. The gateway enforces an agent-specific allowlist, timeout
budget and emits persisted tool-call audit events. The MCP runtime supports initialization, tool
discovery, schema-validated calls and standard text/structured tool results. The official MCP SDK
exposes the same handlers over stdio and stateless Streamable HTTP. External MCP servers connect
through cached stdio or Streamable HTTP clients and receive qualified `serverId::toolName` identities.

Each Skill has a versioned `manifest.json` containing input/output schemas, triggers, tool permissions,
runtime limits and a minimum routing confidence. Runs persist the selected manifest metadata; routing
below the declared threshold is rejected instead of silently choosing the first Skill.

Skill selection combines exact manifest triggers with a versioned character n-gram Naive Bayes
classifier. The classifier artifact records its dataset hash, validation-calibrated confidence/margin
thresholds and held-out metrics. An explicit `unknown` class and rejection policy prevent unrelated
requests from being forced into the nearest Skill; exact trigger matches remain a deterministic
override and missing model artifacts fall back to rule routing.

The embedding experiment keeps the dataset and rejection policy fixed while comparing the production
Naive Bayes baseline with a frozen BGE-M3 prototype classifier and a frozen BGE-M3 encoder plus trained
softmax head. Reports separate encoder latency from head latency. BGE variants remain offline/shadow
artifacts for now: they improve held-out quality, but loading and running the encoder adds materially
more latency than the production baseline.

Resume embeddings use versioned knowledge-base namespaces. A rebuild first creates a `building`
KnowledgeBaseVersion, writes all chunks to its own namespace, updates the Resume snapshot and only then
marks the version `active`; the previous active version becomes `retired`. Cleanup supports retention,
dry-run and exact Qdrant namespace deletion, while Resume deletion removes every recorded namespace.

`datasets/rag-golden.v1.json` is the versioned RAG quality contract. Its CLI/API evaluator reports
HitRate, Recall@K and MRR@K and fails when declared thresholds regress. The orchestration experiment
under `server/experiments/` holds domain stages constant while comparing native promises, LangChain
RunnableSequence and LangGraph StateGraph, so framework overhead is measurable without prompt variance.

`frontend/src/App.tsx` coordinates navigation and shared entities. `InterviewWorkspace`,
`JobMatchWorkspace` and `ResumeGenerationWorkspace` own feature presentation, while
`useInterviewWorkflow`, `useJobMatch` and `useResumeGeneration` own feature requests and local state.
Cross-feature refreshes remain at the page boundary.

The `Application` aggregate closes the product loop by linking one job to a targeted resume version,
interview sessions, the recruiting status and the next action. Status changes are guarded by
`applicationWorkflow` rather than being accepted as arbitrary strings. Application details also own
interview scheduling, notes, outcome text and a completable reminder timestamp; due reminders can be
queried independently for future notification adapters.
