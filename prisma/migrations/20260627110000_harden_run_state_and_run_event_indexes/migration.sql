-- Run state columns make the current status queryable without parsing resultJson.
ALTER TABLE "Run" ADD COLUMN "runtimeRunId" TEXT;
ALTER TABLE "Run" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "Run" ADD COLUMN "errorCode" TEXT;
ALTER TABLE "Run" ADD COLUMN "errorMessage" TEXT;
ALTER TABLE "Run" ADD COLUMN "startedAt" DATETIME;
ALTER TABLE "Run" ADD COLUMN "finishedAt" DATETIME;
ALTER TABLE "Run" ADD COLUMN "latencyMs" INTEGER;
ALTER TABLE "Run" ADD COLUMN "updatedAt" DATETIME;

-- Backfill existing historical runs as succeeded unless resultJson already carries a status.
UPDATE "Run"
SET
  "status" = COALESCE(json_extract("resultJson", '$.status'), 'succeeded'),
  "runtimeRunId" = json_extract("resultJson", '$.runtimeRunId'),
  "errorCode" = json_extract("resultJson", '$.error.code'),
  "errorMessage" = json_extract("resultJson", '$.error.message'),
  "startedAt" = "createdAt",
  "finishedAt" = "createdAt",
  "updatedAt" = "createdAt";

CREATE INDEX "Run_status_createdAt_idx" ON "Run"("status", "createdAt");
CREATE INDEX "Run_runtimeRunId_idx" ON "Run"("runtimeRunId");
CREATE INDEX "Run_sessionId_status_createdAt_idx" ON "Run"("sessionId", "status", "createdAt");
CREATE INDEX "Run_resumeId_status_createdAt_idx" ON "Run"("resumeId", "status", "createdAt");

-- The original migration created a non-unique runId+sequence index. Keep audit order unique per run.
DROP INDEX IF EXISTS "RunEvent_runId_sequence_idx";
CREATE UNIQUE INDEX "RunEvent_runId_sequence_key" ON "RunEvent"("runId", "sequence");

DROP INDEX IF EXISTS "RunEvent_runtimeRunId_idx";
CREATE INDEX "RunEvent_runtimeRunId_sequence_idx" ON "RunEvent"("runtimeRunId", "sequence");
CREATE INDEX "RunEvent_runId_type_sequence_idx" ON "RunEvent"("runId", "type", "sequence");
CREATE INDEX "RunEvent_runId_status_sequence_idx" ON "RunEvent"("runId", "status", "sequence");
CREATE INDEX "RunEvent_agent_createdAt_idx" ON "RunEvent"("agent", "createdAt");
CREATE INDEX "RunEvent_errorCode_createdAt_idx" ON "RunEvent"("errorCode", "createdAt");
