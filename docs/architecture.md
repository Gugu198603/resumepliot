# ResumePilot Architecture

## Module boundaries

```text
frontend/src/
├── App.tsx                         # Page composition and cross-feature state
├── features/
│   ├── interview/                  # Workspace + streaming/voice workflow hook + styles
│   ├── job-match/                  # Workspace + matching workflow hook + styles
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
├── middleware/                     # HTTP errors and security
└── mcp/                            # MCP protocol adapter
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

`frontend/src/App.tsx` coordinates navigation and shared entities. `InterviewWorkspace`,
`JobMatchWorkspace` and `ResumeGenerationWorkspace` own feature presentation, while
`useInterviewWorkflow`, `useJobMatch` and `useResumeGeneration` own feature requests and local state.
Cross-feature refreshes remain at the page boundary.
