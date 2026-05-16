CREATE TABLE "GeneratedLessonContent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "studentId" TEXT,
    "objectiveId" TEXT,
    "cacheKey" TEXT NOT NULL,
    "blockKey" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'APPROVED',
    "contentJson" JSONB NOT NULL,
    "guardrailJson" JSONB NOT NULL,
    "promptMeta" JSONB,
    "modelUsed" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "GeneratedLessonContent_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "GeneratedLessonContent_cacheKey_key" ON "GeneratedLessonContent"("cacheKey");
CREATE INDEX "GeneratedLessonContent_organisationId_idx" ON "GeneratedLessonContent"("organisationId");
CREATE INDEX "GeneratedLessonContent_studentId_idx" ON "GeneratedLessonContent"("studentId");
CREATE INDEX "GeneratedLessonContent_objectiveId_idx" ON "GeneratedLessonContent"("objectiveId");
CREATE INDEX "GeneratedLessonContent_blockKey_idx" ON "GeneratedLessonContent"("blockKey");
CREATE INDEX "GeneratedLessonContent_source_idx" ON "GeneratedLessonContent"("source");
CREATE INDEX "GeneratedLessonContent_status_idx" ON "GeneratedLessonContent"("status");
CREATE INDEX "GeneratedLessonContent_createdAt_idx" ON "GeneratedLessonContent"("createdAt");
