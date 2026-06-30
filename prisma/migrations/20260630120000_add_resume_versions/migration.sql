CREATE TABLE "ResumeVersion" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "resumeId" TEXT NOT NULL,
    "jobId" TEXT,
    "label" TEXT,
    "versionNumber" INTEGER NOT NULL,
    "contentJson" TEXT NOT NULL,
    "candidateProfileJson" TEXT,
    "matchScore" INTEGER,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ResumeVersion_resumeId_fkey" FOREIGN KEY ("resumeId") REFERENCES "Resume" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ResumeVersion_resumeId_versionNumber_key" ON "ResumeVersion"("resumeId", "versionNumber");
CREATE INDEX "ResumeVersion_resumeId_createdAt_idx" ON "ResumeVersion"("resumeId", "createdAt");
CREATE INDEX "ResumeVersion_jobId_idx" ON "ResumeVersion"("jobId");
