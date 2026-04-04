/*
  Newton Centre — foundation_rag_v1 (CORRECTED drop-in migration.sql)

  This migration is written to be SAFE on an existing DB.

  Fixes vs the Prisma-generated SQL:
  - Adds new required columns as NULLABLE first, then backfills, then sets NOT NULL.
  - Backfills organisationId everywhere using existing relations.
  - Handles NULL sourceId on CurriculumObjective/ContentChunk by creating a per-org fallback CurriculumSource.
  - Generates contentSha256 deterministically and guarantees uniqueness (sha256(content || '|' || id)).
  - Prevents UNIQUE constraint failures for (organisationId, code) and (organisationId, slug) by de-duping if necessary.
  - Drops vectorRef after backfill is safe.
*/

-- Ensure required extensions (pgcrypto gives digest() and gen_random_uuid())
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- ────────────────────────────────────────────────────────────────────────────────
-- 1) Enums
-- ────────────────────────────────────────────────────────────────────────────────
DO $$ BEGIN
  CREATE TYPE "VisibilityScope" AS ENUM ('ORG_ONLY', 'COHORT', 'STAFF_ONLY', 'STUDENT_OWNED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "RagLane" AS ENUM ('STRUCTURED_OBJECTIVE', 'FREE_TEXT_LESSON', 'HOMEWORK_HELP');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "EmbeddingStatus" AS ENUM ('PENDING', 'READY', 'FAILED');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "HomeworkLinkType" AS ENUM ('SAME_OBJECTIVE', 'SAME_TOPIC', 'PREREQ_GAP', 'WORKED_EXAMPLE_MATCH');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "StudentVectorType" AS ENUM ('INTERESTS', 'MISCONCEPTIONS', 'STRENGTHS');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ────────────────────────────────────────────────────────────────────────────────
-- 2) Create new tables (safe)
-- ────────────────────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "Embedding" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "model" TEXT NOT NULL,
  "dims" INTEGER NOT NULL,
  "status" "EmbeddingStatus" NOT NULL DEFAULT 'PENDING',
  "error" TEXT,
  "inputSha256" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Embedding_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Embedding_inputSha256_key" ON "Embedding"("inputSha256");
CREATE INDEX IF NOT EXISTS "Embedding_organisationId_idx" ON "Embedding"("organisationId");
CREATE INDEX IF NOT EXISTS "Embedding_status_idx" ON "Embedding"("status");
CREATE INDEX IF NOT EXISTS "Embedding_model_idx" ON "Embedding"("model");
CREATE INDEX IF NOT EXISTS "Embedding_dims_idx" ON "Embedding"("dims");

CREATE TABLE IF NOT EXISTS "UploadChunk" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "uploadId" TEXT NOT NULL,
  "chunkIndex" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "tokenCount" INTEGER,
  "pageNumber" INTEGER,
  "locator" JSONB,
  "contentSha256" TEXT NOT NULL,
  "embeddingId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "UploadChunk_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "UploadChunk_uploadId_chunkIndex_key" ON "UploadChunk"("uploadId", "chunkIndex");
CREATE INDEX IF NOT EXISTS "UploadChunk_organisationId_idx" ON "UploadChunk"("organisationId");
CREATE INDEX IF NOT EXISTS "UploadChunk_uploadId_idx" ON "UploadChunk"("uploadId");
CREATE INDEX IF NOT EXISTS "UploadChunk_embeddingId_idx" ON "UploadChunk"("embeddingId");

CREATE TABLE IF NOT EXISTS "HomeworkLink" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "uploadId" TEXT NOT NULL,
  "objectiveId" TEXT,
  "contentChunkId" TEXT,
  "linkType" "HomeworkLinkType" NOT NULL,
  "score" DOUBLE PRECISION NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "HomeworkLink_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "HomeworkLink_organisationId_idx" ON "HomeworkLink"("organisationId");
CREATE INDEX IF NOT EXISTS "HomeworkLink_uploadId_idx" ON "HomeworkLink"("uploadId");
CREATE INDEX IF NOT EXISTS "HomeworkLink_objectiveId_idx" ON "HomeworkLink"("objectiveId");
CREATE INDEX IF NOT EXISTS "HomeworkLink_contentChunkId_idx" ON "HomeworkLink"("contentChunkId");
CREATE INDEX IF NOT EXISTS "HomeworkLink_linkType_idx" ON "HomeworkLink"("linkType");

CREATE TABLE IF NOT EXISTS "StudentVector" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "type" "StudentVectorType" NOT NULL,
  "embeddingId" TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "StudentVector_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StudentVector_studentId_type_key" ON "StudentVector"("studentId", "type");
CREATE INDEX IF NOT EXISTS "StudentVector_organisationId_idx" ON "StudentVector"("organisationId");
CREATE INDEX IF NOT EXISTS "StudentVector_studentId_idx" ON "StudentVector"("studentId");
CREATE INDEX IF NOT EXISTS "StudentVector_type_idx" ON "StudentVector"("type");

CREATE TABLE IF NOT EXISTS "RagTrace" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "studentId" TEXT,
  "threadId" TEXT,
  "lane" "RagLane" NOT NULL,
  "queryTextHash" TEXT NOT NULL,
  "filters" JSONB,
  "retrieved" JSONB,
  "promptHash" TEXT,
  "outputHash" TEXT,
  "modelUsed" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RagTrace_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "RagTrace_organisationId_createdAt_idx" ON "RagTrace"("organisationId","createdAt");
CREATE INDEX IF NOT EXISTS "RagTrace_studentId_createdAt_idx" ON "RagTrace"("studentId","createdAt");
CREATE INDEX IF NOT EXISTS "RagTrace_threadId_createdAt_idx" ON "RagTrace"("threadId","createdAt");
CREATE INDEX IF NOT EXISTS "RagTrace_lane_idx" ON "RagTrace"("lane");

-- ────────────────────────────────────────────────────────────────────────────────
-- 3) Make destructive/constraint-heavy changes safe: drop old uniques (if exist)
-- ────────────────────────────────────────────────────────────────────────────────
-- These were created by earlier schema. Safe to drop if they exist.
DROP INDEX IF EXISTS "CurriculumObjective_code_key";
DROP INDEX IF EXISTS "CurriculumSource_slug_key";

-- ────────────────────────────────────────────────────────────────────────────────
-- 4) Add new columns as NULLABLE first (no NOT NULL yet)
-- ────────────────────────────────────────────────────────────────────────────────

-- Attempt / AttemptItem / ObjectiveMastery / TutorThread / Upload: add organisationId nullable first
ALTER TABLE "Attempt"        ADD COLUMN IF NOT EXISTS "organisationId" TEXT;
ALTER TABLE "AttemptItem"    ADD COLUMN IF NOT EXISTS "organisationId" TEXT;
ALTER TABLE "ObjectiveMastery" ADD COLUMN IF NOT EXISTS "organisationId" TEXT;
ALTER TABLE "TutorThread"    ADD COLUMN IF NOT EXISTS "organisationId" TEXT;
ALTER TABLE "Upload"         ADD COLUMN IF NOT EXISTS "organisationId" TEXT;

-- AuditEvent organisationId (nullable)
ALTER TABLE "AuditEvent"     ADD COLUMN IF NOT EXISTS "organisationId" TEXT;

-- CurriculumSource visibility (safe default)
ALTER TABLE "CurriculumSource"
  ADD COLUMN IF NOT EXISTS "visibility" "VisibilityScope" NOT NULL DEFAULT 'ORG_ONLY';

-- CurriculumObjective: add org + visibility + isActive as safe additions
ALTER TABLE "CurriculumObjective"
  ADD COLUMN IF NOT EXISTS "organisationId" TEXT,
  ADD COLUMN IF NOT EXISTS "visibility" "VisibilityScope" NOT NULL DEFAULT 'ORG_ONLY',
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

-- ContentChunk: add orgId + contentSha256 nullable, plus embeddingId + visibility default
ALTER TABLE "ContentChunk"
  ADD COLUMN IF NOT EXISTS "organisationId" TEXT,
  ADD COLUMN IF NOT EXISTS "contentSha256" TEXT,
  ADD COLUMN IF NOT EXISTS "embeddingId" TEXT,
  ADD COLUMN IF NOT EXISTS "visibility" "VisibilityScope" NOT NULL DEFAULT 'ORG_ONLY';

-- ────────────────────────────────────────────────────────────────────────────────
-- 5) Backfill organisationId and repair NULL sourceId before making sourceId NOT NULL
-- ────────────────────────────────────────────────────────────────────────────────

-- Helper: choose a default org (old system may have only one org).
-- If Organisation table exists but empty (unlikely), create one.
DO $$
DECLARE
  org_id TEXT;
BEGIN
  SELECT id INTO org_id FROM "Organisation" ORDER BY "createdAt" ASC LIMIT 1;

  IF org_id IS NULL THEN
    INSERT INTO "Organisation"(id, name, slug, "isActive", "createdAt", "updatedAt")
    VALUES (gen_random_uuid()::text, 'Default Organisation', 'default', true, now(), now())
    RETURNING id INTO org_id;
  END IF;
END $$;

-- Convenience CTE
WITH d AS (
  SELECT id AS org_id FROM "Organisation" ORDER BY "createdAt" ASC LIMIT 1
)

-- Backfill NULL organisationId on CurriculumSource (you reported 1 NULL)
UPDATE "CurriculumSource" cs
SET "organisationId" = (SELECT org_id FROM d)
WHERE cs."organisationId" IS NULL;

-- Backfill NULL organisationId on User/Student (you reported 1 NULL each)
WITH d AS (SELECT id AS org_id FROM "Organisation" ORDER BY "createdAt" ASC LIMIT 1)
UPDATE "User" u
SET "organisationId" = (SELECT org_id FROM d)
WHERE u."organisationId" IS NULL;

WITH d AS (SELECT id AS org_id FROM "Organisation" ORDER BY "createdAt" ASC LIMIT 1)
UPDATE "Student" s
SET "organisationId" = (SELECT org_id FROM d)
WHERE s."organisationId" IS NULL;

-- Create a per-org fallback CurriculumSource to attach orphaned objectives/chunks (NULL sourceId).
-- One row per org, slug 'fallback-source'.
INSERT INTO "CurriculumSource"(
  id, "organisationId", name, slug, description, license, attribution, url, "isActive", "createdAt", "updatedAt", visibility
)
SELECT
  gen_random_uuid()::text,
  o.id,
  'Fallback Source',
  'fallback-source',
  'Auto-created to attach legacy rows missing sourceId',
  'INTERNAL',
  NULL,
  NULL,
  true,
  now(),
  now(),
  'ORG_ONLY'::"VisibilityScope"
FROM "Organisation" o
WHERE NOT EXISTS (
  SELECT 1 FROM "CurriculumSource" cs WHERE cs."organisationId" = o.id AND cs.slug = 'fallback-source'
);

-- Fix NULL CurriculumObjective.sourceId by attaching to fallback-source of same org
UPDATE "CurriculumObjective" co
SET "sourceId" = (
  SELECT cs.id FROM "CurriculumSource" cs
  WHERE cs."organisationId" = COALESCE(co."organisationId", (SELECT s."organisationId" FROM "Student" s LIMIT 1), (SELECT id FROM "Organisation" ORDER BY "createdAt" ASC LIMIT 1))
    AND cs.slug = 'fallback-source'
  LIMIT 1
)
WHERE co."sourceId" IS NULL;

-- Backfill CurriculumObjective.organisationId from its source
UPDATE "CurriculumObjective" co
SET "organisationId" = cs."organisationId"
FROM "CurriculumSource" cs
WHERE co."organisationId" IS NULL
  AND co."sourceId" = cs.id;

-- If any still NULL (shouldn't), assign default org
WITH d AS (SELECT id AS org_id FROM "Organisation" ORDER BY "createdAt" ASC LIMIT 1)
UPDATE "CurriculumObjective"
SET "organisationId" = (SELECT org_id FROM d)
WHERE "organisationId" IS NULL;

-- Fix NULL ContentChunk.sourceId by attaching to fallback-source of default org (since chunk had no org yet)
WITH d AS (SELECT id AS org_id FROM "Organisation" ORDER BY "createdAt" ASC LIMIT 1)
UPDATE "ContentChunk" c
SET "sourceId" = (
  SELECT cs.id FROM "CurriculumSource" cs
  WHERE cs."organisationId" = (SELECT org_id FROM d) AND cs.slug = 'fallback-source'
  LIMIT 1
)
WHERE c."sourceId" IS NULL;

-- Backfill ContentChunk.organisationId from source
UPDATE "ContentChunk" c
SET "organisationId" = cs."organisationId"
FROM "CurriculumSource" cs
WHERE c."organisationId" IS NULL
  AND c."sourceId" = cs.id;

-- If any still NULL, assign default org
WITH d AS (SELECT id AS org_id FROM "Organisation" ORDER BY "createdAt" ASC LIMIT 1)
UPDATE "ContentChunk"
SET "organisationId" = (SELECT org_id FROM d)
WHERE "organisationId" IS NULL;

-- Backfill Attempt.organisationId from Student
UPDATE "Attempt" a
SET "organisationId" = s."organisationId"
FROM "Student" s
WHERE a."organisationId" IS NULL AND a."studentId" = s.id;

-- Backfill AttemptItem.organisationId from Attempt
UPDATE "AttemptItem" ai
SET "organisationId" = a."organisationId"
FROM "Attempt" a
WHERE ai."organisationId" IS NULL AND ai."attemptId" = a.id;

-- Backfill ObjectiveMastery.organisationId from Student
UPDATE "ObjectiveMastery" om
SET "organisationId" = s."organisationId"
FROM "Student" s
WHERE om."organisationId" IS NULL AND om."studentId" = s.id;

-- Backfill TutorThread.organisationId from Student
UPDATE "TutorThread" tt
SET "organisationId" = s."organisationId"
FROM "Student" s
WHERE tt."organisationId" IS NULL AND tt."studentId" = s.id;

-- Backfill Upload.organisationId from Student
UPDATE "Upload" u
SET "organisationId" = s."organisationId"
FROM "Student" s
WHERE u."organisationId" IS NULL AND u."studentId" = s.id;

-- Backfill AuditEvent.organisationId from User if possible
UPDATE "AuditEvent" ae
SET "organisationId" = u."organisationId"
FROM "User" u
WHERE ae."organisationId" IS NULL AND ae."userId" = u.id;

-- ────────────────────────────────────────────────────────────────────────────────
-- 6) contentSha256 backfill (guaranteed unique) + dedupe for new unique constraints
-- ────────────────────────────────────────────────────────────────────────────────

-- Use sha256(content || '|' || id) to guarantee uniqueness even if content is identical.
UPDATE "ContentChunk"
SET "contentSha256" = encode(digest(COALESCE(content,'') || '|' || id, 'sha256'), 'hex')
WHERE "contentSha256" IS NULL;

-- De-dupe CurriculumObjective codes within org if duplicates exist (rare).
-- Only touches duplicates: appends "-dup-<id>" for all but the first.
WITH ranked AS (
  SELECT
    id,
    "organisationId",
    code,
    ROW_NUMBER() OVER (PARTITION BY "organisationId", code ORDER BY id) AS rn
  FROM "CurriculumObjective"
)
UPDATE "CurriculumObjective" co
SET code = co.code || '-dup-' || co.id
FROM ranked r
WHERE co.id = r.id AND r.rn > 1;

-- De-dupe CurriculumSource slugs within org if duplicates exist (rare).
WITH ranked AS (
  SELECT
    id,
    "organisationId",
    slug,
    ROW_NUMBER() OVER (PARTITION BY "organisationId", slug ORDER BY id) AS rn
  FROM "CurriculumSource"
)
UPDATE "CurriculumSource" cs
SET slug = cs.slug || '-dup-' || cs.id
FROM ranked r
WHERE cs.id = r.id AND r.rn > 1;

-- ────────────────────────────────────────────────────────────────────────────────
-- 7) Now enforce NOT NULL requirements (safe after backfill)
-- ────────────────────────────────────────────────────────────────────────────────

-- Make required orgId fields non-null
ALTER TABLE "User" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "Student" ALTER COLUMN "organisationId" SET NOT NULL;

ALTER TABLE "CurriculumSource" ALTER COLUMN "organisationId" SET NOT NULL;

ALTER TABLE "CurriculumObjective" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "CurriculumObjective" ALTER COLUMN "sourceId" SET NOT NULL;

ALTER TABLE "ContentChunk" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "ContentChunk" ALTER COLUMN "sourceId" SET NOT NULL;
ALTER TABLE "ContentChunk" ALTER COLUMN "contentSha256" SET NOT NULL;

ALTER TABLE "Attempt" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "AttemptItem" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "ObjectiveMastery" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "TutorThread" ALTER COLUMN "organisationId" SET NOT NULL;
ALTER TABLE "Upload" ALTER COLUMN "organisationId" SET NOT NULL;

-- ────────────────────────────────────────────────────────────────────────────────
-- 8) Drop vectorRef safely (after we’re done using the old schema)
-- ────────────────────────────────────────────────────────────────────────────────
ALTER TABLE "ContentChunk" DROP COLUMN IF EXISTS "vectorRef";

-- ────────────────────────────────────────────────────────────────────────────────
-- 9) Indexes + uniqueness constraints (safe after dedupe/backfill)
-- ────────────────────────────────────────────────────────────────────────────────

-- New indexes that Prisma expected
CREATE INDEX IF NOT EXISTS "Attempt_organisationId_idx" ON "Attempt"("organisationId");
CREATE INDEX IF NOT EXISTS "Attempt_status_idx" ON "Attempt"("status");

CREATE INDEX IF NOT EXISTS "AttemptItem_organisationId_idx" ON "AttemptItem"("organisationId");

CREATE INDEX IF NOT EXISTS "AuditEvent_organisationId_createdAt_idx" ON "AuditEvent"("organisationId","createdAt");

CREATE UNIQUE INDEX IF NOT EXISTS "ContentChunk_contentSha256_key" ON "ContentChunk"("contentSha256");
CREATE INDEX IF NOT EXISTS "ContentChunk_organisationId_idx" ON "ContentChunk"("organisationId");
CREATE INDEX IF NOT EXISTS "ContentChunk_difficulty_idx" ON "ContentChunk"("difficulty");
CREATE INDEX IF NOT EXISTS "ContentChunk_visibility_idx" ON "ContentChunk"("visibility");
CREATE INDEX IF NOT EXISTS "ContentChunk_isActive_idx" ON "ContentChunk"("isActive");
CREATE INDEX IF NOT EXISTS "ContentChunk_embeddingId_idx" ON "ContentChunk"("embeddingId");

CREATE INDEX IF NOT EXISTS "CurriculumObjective_organisationId_idx" ON "CurriculumObjective"("organisationId");
CREATE INDEX IF NOT EXISTS "CurriculumObjective_visibility_idx" ON "CurriculumObjective"("visibility");
CREATE INDEX IF NOT EXISTS "CurriculumObjective_sourceId_idx" ON "CurriculumObjective"("sourceId");
CREATE INDEX IF NOT EXISTS "CurriculumObjective_isActive_idx" ON "CurriculumObjective"("isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "CurriculumObjective_organisationId_code_key" ON "CurriculumObjective"("organisationId","code");

CREATE INDEX IF NOT EXISTS "CurriculumSource_visibility_idx" ON "CurriculumSource"("visibility");
CREATE INDEX IF NOT EXISTS "CurriculumSource_isActive_idx" ON "CurriculumSource"("isActive");
CREATE UNIQUE INDEX IF NOT EXISTS "CurriculumSource_organisationId_slug_key" ON "CurriculumSource"("organisationId","slug");

CREATE INDEX IF NOT EXISTS "ObjectiveMastery_organisationId_idx" ON "ObjectiveMastery"("organisationId");

CREATE INDEX IF NOT EXISTS "TutorThread_organisationId_idx" ON "TutorThread"("organisationId");
CREATE INDEX IF NOT EXISTS "Upload_organisationId_idx" ON "Upload"("organisationId");
CREATE INDEX IF NOT EXISTS "Upload_createdAt_idx" ON "Upload"("createdAt");

CREATE INDEX IF NOT EXISTS "User_organisationId_idx" ON "User"("organisationId");
CREATE INDEX IF NOT EXISTS "User_role_idx" ON "User"("role");
CREATE INDEX IF NOT EXISTS "User_isActive_idx" ON "User"("isActive");

-- ────────────────────────────────────────────────────────────────────────────────
-- 10) Foreign keys (only add if missing)
-- ────────────────────────────────────────────────────────────────────────────────

-- Organisation FKs
DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Student" ADD CONSTRAINT "Student_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "CurriculumSource" ADD CONSTRAINT "CurriculumSource_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "CurriculumObjective" ADD CONSTRAINT "CurriculumObjective_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "CurriculumObjective" ADD CONSTRAINT "CurriculumObjective_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "CurriculumSource"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ContentChunk" ADD CONSTRAINT "ContentChunk_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ContentChunk" ADD CONSTRAINT "ContentChunk_sourceId_fkey"
    FOREIGN KEY ("sourceId") REFERENCES "CurriculumSource"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ContentChunk" ADD CONSTRAINT "ContentChunk_embeddingId_fkey"
    FOREIGN KEY ("embeddingId") REFERENCES "Embedding"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Embedding" ADD CONSTRAINT "Embedding_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Upload" ADD CONSTRAINT "Upload_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "UploadChunk" ADD CONSTRAINT "UploadChunk_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "UploadChunk" ADD CONSTRAINT "UploadChunk_uploadId_fkey"
    FOREIGN KEY ("uploadId") REFERENCES "Upload"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "UploadChunk" ADD CONSTRAINT "UploadChunk_embeddingId_fkey"
    FOREIGN KEY ("embeddingId") REFERENCES "Embedding"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "HomeworkLink" ADD CONSTRAINT "HomeworkLink_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "HomeworkLink" ADD CONSTRAINT "HomeworkLink_uploadId_fkey"
    FOREIGN KEY ("uploadId") REFERENCES "Upload"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "HomeworkLink" ADD CONSTRAINT "HomeworkLink_objectiveId_fkey"
    FOREIGN KEY ("objectiveId") REFERENCES "CurriculumObjective"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "HomeworkLink" ADD CONSTRAINT "HomeworkLink_contentChunkId_fkey"
    FOREIGN KEY ("contentChunkId") REFERENCES "ContentChunk"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "TutorThread" ADD CONSTRAINT "TutorThread_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "AttemptItem" ADD CONSTRAINT "AttemptItem_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "ObjectiveMastery" ADD CONSTRAINT "ObjectiveMastery_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "StudentVector" ADD CONSTRAINT "StudentVector_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "StudentVector" ADD CONSTRAINT "StudentVector_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "StudentVector" ADD CONSTRAINT "StudentVector_embeddingId_fkey"
    FOREIGN KEY ("embeddingId") REFERENCES "Embedding"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "RagTrace" ADD CONSTRAINT "RagTrace_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "RagTrace" ADD CONSTRAINT "RagTrace_studentId_fkey"
    FOREIGN KEY ("studentId") REFERENCES "Student"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "RagTrace" ADD CONSTRAINT "RagTrace_threadId_fkey"
    FOREIGN KEY ("threadId") REFERENCES "TutorThread"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

DO $$ BEGIN
  ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organisationId_fkey"
    FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN null; END $$;

-- Done.