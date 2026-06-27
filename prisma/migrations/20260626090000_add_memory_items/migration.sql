-- CreateTable
CREATE TABLE "MemoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "userId" TEXT,
    "resumeId" TEXT,
    "sessionId" TEXT,
    "jobId" TEXT,
    "runId" TEXT,
    "scope" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "sourceKind" TEXT,
    "sourceId" TEXT,
    "title" TEXT,
    "content" TEXT NOT NULL,
    "contentHash" TEXT,
    "importance" REAL NOT NULL DEFAULT 0.5,
    "confidence" REAL NOT NULL DEFAULT 1.0,
    "accessCount" INTEGER NOT NULL DEFAULT 0,
    "lastAccessedAt" DATETIME,
    "embeddingProvider" TEXT,
    "vectorProvider" TEXT,
    "vectorNamespace" TEXT,
    "vectorPointId" TEXT,
    "vectorDim" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'active',
    "expiresAt" DATETIME,
    "metadataJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "MemoryItem_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MemoryItem_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MemoryItem_sessionId_fkey" FOREIGN KEY ("sessionId") REFERENCES "Session" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MemoryItem_jobId_fkey" FOREIGN KEY ("jobId") REFERENCES "JobDescription" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MemoryItem_runId_fkey" FOREIGN KEY ("runId") REFERENCES "Run" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

-- CreateIndex
CREATE INDEX "MemoryItem_scope_type_idx" ON "MemoryItem"("scope", "type");

-- CreateIndex
CREATE INDEX "MemoryItem_userId_scope_idx" ON "MemoryItem"("userId", "scope");

-- CreateIndex
CREATE INDEX "MemoryItem_resumeId_type_idx" ON "MemoryItem"("resumeId", "type");

-- CreateIndex
CREATE INDEX "MemoryItem_sessionId_type_idx" ON "MemoryItem"("sessionId", "type");

-- CreateIndex
CREATE INDEX "MemoryItem_jobId_type_idx" ON "MemoryItem"("jobId", "type");

-- CreateIndex
CREATE INDEX "MemoryItem_runId_idx" ON "MemoryItem"("runId");

-- CreateIndex
CREATE INDEX "MemoryItem_sourceKind_sourceId_idx" ON "MemoryItem"("sourceKind", "sourceId");

-- CreateIndex
CREATE INDEX "MemoryItem_vectorNamespace_idx" ON "MemoryItem"("vectorNamespace");

-- CreateIndex
CREATE INDEX "MemoryItem_status_expiresAt_idx" ON "MemoryItem"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "MemoryItem_contentHash_idx" ON "MemoryItem"("contentHash");
