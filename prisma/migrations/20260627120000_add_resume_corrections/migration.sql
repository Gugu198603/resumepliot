CREATE TABLE "ResumeCorrectionEvent" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resumeId" TEXT NOT NULL,
    "errorTypes" TEXT,
    "beforeJson" TEXT,
    "afterJson" TEXT,
    "summaryJson" TEXT,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResumeCorrectionEvent_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "ResumeCorrectionEvent_resumeId_createdAt_idx" ON "ResumeCorrectionEvent"("resumeId", "createdAt");
CREATE INDEX "ResumeCorrectionEvent_createdAt_idx" ON "ResumeCorrectionEvent"("createdAt");
