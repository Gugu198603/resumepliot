CREATE TABLE "KnowledgeBaseVersion" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "resumeId" TEXT NOT NULL,
  "versionNumber" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "namespace" TEXT NOT NULL,
  "vectorProvider" TEXT NOT NULL,
  "chunkCount" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'building',
  "activatedAt" DATETIME,
  "retiredAt" DATETIME,
  "deletedAt" DATETIME,
  "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" DATETIME NOT NULL,
  CONSTRAINT "KnowledgeBaseVersion_resumeId_fkey"
    FOREIGN KEY ("resumeId") REFERENCES "Resume" ("id")
    ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "KnowledgeBaseVersion_namespace_key" ON "KnowledgeBaseVersion"("namespace");
CREATE UNIQUE INDEX "KnowledgeBaseVersion_resumeId_versionNumber_key" ON "KnowledgeBaseVersion"("resumeId", "versionNumber");
CREATE INDEX "KnowledgeBaseVersion_resumeId_status_idx" ON "KnowledgeBaseVersion"("resumeId", "status");
CREATE INDEX "KnowledgeBaseVersion_status_retiredAt_idx" ON "KnowledgeBaseVersion"("status", "retiredAt");
