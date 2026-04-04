-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "public"."AssessmentContext" AS ENUM ('HOMEWORK', 'CLASSWORK', 'REVISION', 'ASSESSED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "public"."AttemptStatus" AS ENUM ('STARTED', 'SUBMITTED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "public"."ChunkType" AS ENUM ('OBJECTIVE', 'EXPLANATION', 'WORKED_EXAMPLE', 'MISCONCEPTION', 'PRACTICE', 'COMMAND_WORDS', 'GLOSSARY');

-- CreateEnum
CREATE TYPE "public"."ConsentState" AS ENUM ('UNKNOWN', 'GRANTED', 'DENIED');

-- CreateEnum
CREATE TYPE "public"."DifficultyBand" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "public"."EmbeddingStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "public"."HelpLevel" AS ENUM ('NONE', 'HINT', 'EXAMPLE', 'MICRO_LESSON');

-- CreateEnum
CREATE TYPE "public"."HomeworkLinkType" AS ENUM ('SAME_OBJECTIVE', 'SAME_TOPIC', 'PREREQ_GAP', 'WORKED_EXAMPLE_MATCH');

-- CreateEnum
CREATE TYPE "public"."KeyStage" AS ENUM ('KS1', 'KS2', 'KS3', 'KS4');

-- CreateEnum
CREATE TYPE "public"."MasteryTrend" AS ENUM ('IMPROVING', 'FLAT', 'DECLINING');

-- CreateEnum
CREATE TYPE "public"."RagLane" AS ENUM ('STRUCTURED_OBJECTIVE', 'FREE_TEXT_LESSON', 'HOMEWORK_HELP');

-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('STUDENT', 'PARENT', 'STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "public"."ScienceDomain" AS ENUM ('BIOLOGY', 'CHEMISTRY', 'PHYSICS', 'GENERAL_SCIENCE');

-- CreateEnum
CREATE TYPE "public"."StepSize" AS ENUM ('SMALL', 'NORMAL');

-- CreateEnum
CREATE TYPE "public"."StorageProvider" AS ENUM ('LOCAL', 'S3', 'AZURE_BLOB');

-- CreateEnum
CREATE TYPE "public"."StudentVectorType" AS ENUM ('INTERESTS', 'MISCONCEPTIONS', 'STRENGTHS');

-- CreateEnum
CREATE TYPE "public"."Subject" AS ENUM ('MATHS', 'SCIENCE', 'COMPUTING');

-- CreateEnum
CREATE TYPE "public"."TaskType" AS ENUM ('CHAT', 'CHECK_WORK', 'MICRO_LESSON', 'MINI_QUIZ', 'PRACTICE_SET');

-- CreateEnum
CREATE TYPE "public"."TutoringMode" AS ENUM ('AUTO', 'GENTLE', 'COACH');

-- CreateEnum
CREATE TYPE "public"."UploadType" AS ENUM ('QUESTION', 'STUDENT_WORK', 'SUPPORTING_MATERIAL');

-- CreateEnum
CREATE TYPE "public"."Verbosity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "public"."VisibilityScope" AS ENUM ('ORG_ONLY', 'COHORT', 'STAFF_ONLY', 'STUDENT_OWNED');

-- CreateTable
CREATE TABLE "public"."Attempt" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subject" "public"."Subject" NOT NULL,
    "taskType" "public"."TaskType" NOT NULL,
    "assessmentContext" "public"."AssessmentContext" NOT NULL DEFAULT 'UNKNOWN',
    "primaryObjectiveId" TEXT,
    "threadId" TEXT,
    "status" "public"."AttemptStatus" NOT NULL DEFAULT 'STARTED',
    "score" DOUBLE PRECISION,
    "helpUsed" "public"."HelpLevel" NOT NULL DEFAULT 'NONE',
    "timeOnTaskSec" INTEGER,
    "frustration" TEXT,
    "notes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "organisationId" TEXT NOT NULL,

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AttemptItem" (
    "id" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "objectiveId" TEXT,
    "prompt" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "difficulty" "public"."DifficultyBand" NOT NULL DEFAULT 'MEDIUM',
    "response" TEXT,
    "isCorrect" BOOLEAN,
    "score" DOUBLE PRECISION,
    "errorTags" TEXT[],
    "misconceptionCodes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organisationId" TEXT NOT NULL,

    CONSTRAINT "AttemptItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."AuditEvent" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organisationId" TEXT,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CommandWord" (
    "id" TEXT NOT NULL,
    "subject" "public"."Subject" NOT NULL,
    "word" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "scaffolds" TEXT[],
    "examples" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommandWord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ContentChunk" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "objectiveId" TEXT,
    "subject" "public"."Subject" NOT NULL,
    "keyStage" "public"."KeyStage" NOT NULL,
    "yearGroup" INTEGER,
    "strand" TEXT,
    "type" "public"."ChunkType" NOT NULL,
    "difficulty" "public"."DifficultyBand" NOT NULL DEFAULT 'MEDIUM',
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER,
    "citations" TEXT[],
    "tags" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "scienceDomain" "public"."ScienceDomain",
    "scienceDomainConfidence" DOUBLE PRECISION,
    "scienceDomainModel" TEXT,
    "scienceDomainTaggedAt" TIMESTAMP(3),
    "organisationId" TEXT NOT NULL,
    "contentSha256" TEXT NOT NULL,
    "embeddingId" TEXT,
    "visibility" "public"."VisibilityScope" NOT NULL DEFAULT 'ORG_ONLY',

    CONSTRAINT "ContentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CurriculumObjective" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "subject" "public"."Subject" NOT NULL,
    "keyStage" "public"."KeyStage" NOT NULL,
    "yearGroup" INTEGER,
    "strand" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "statutory" BOOLEAN NOT NULL DEFAULT true,
    "keywords" TEXT[],
    "sourceId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organisationId" TEXT NOT NULL,
    "visibility" "public"."VisibilityScope" NOT NULL DEFAULT 'ORG_ONLY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "CurriculumObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."CurriculumSource" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "license" TEXT NOT NULL,
    "attribution" TEXT,
    "url" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "slug" TEXT NOT NULL,
    "visibility" "public"."VisibilityScope" NOT NULL DEFAULT 'ORG_ONLY',

    CONSTRAINT "CurriculumSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Embedding" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dims" INTEGER NOT NULL,
    "status" "public"."EmbeddingStatus" NOT NULL DEFAULT 'PENDING',
    "error" TEXT,
    "inputSha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "vector" vector(1536),

    CONSTRAINT "Embedding_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."HomeworkLink" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "objectiveId" TEXT,
    "contentChunkId" TEXT,
    "linkType" "public"."HomeworkLinkType" NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HomeworkLink_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."ObjectiveMastery" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "masteryScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "stabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "trend" "public"."MasteryTrend" NOT NULL DEFAULT 'FLAT',
    "commonErrorTags" TEXT[],
    "lastSeenAt" TIMESTAMP(3),
    "attemptsCount" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "organisationId" TEXT NOT NULL,

    CONSTRAINT "ObjectiveMastery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Organisation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."RagTrace" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "studentId" TEXT,
    "threadId" TEXT,
    "lane" "public"."RagLane" NOT NULL,
    "queryTextHash" TEXT NOT NULL,
    "filters" JSONB,
    "retrieved" JSONB,
    "promptHash" TEXT,
    "outputHash" TEXT,
    "modelUsed" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RagTrace_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Student" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "age" INTEGER NOT NULL,
    "keyStage" "public"."KeyStage",
    "subjects" "public"."Subject"[],
    "guardianEmail" TEXT,
    "consentState" "public"."ConsentState" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StudentPreference" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "tutoringMode" "public"."TutoringMode" NOT NULL DEFAULT 'AUTO',
    "verbosity" "public"."Verbosity" NOT NULL DEFAULT 'LOW',
    "stepSize" "public"."StepSize" NOT NULL DEFAULT 'SMALL',
    "lowStimulus" BOOLEAN NOT NULL DEFAULT true,
    "avoidMetaphors" BOOLEAN NOT NULL DEFAULT false,
    "useBullets" BOOLEAN NOT NULL DEFAULT true,
    "moreExamples" BOOLEAN NOT NULL DEFAULT true,
    "frequentCheckIns" BOOLEAN NOT NULL DEFAULT true,
    "readingLevel" INTEGER,
    "attentionSpanMins" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentPreference_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."StudentVector" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" "public"."StudentVectorType" NOT NULL,
    "embeddingId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentVector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TutorMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TutorMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."TutorThread" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subject" "public"."Subject" NOT NULL,
    "taskType" "public"."TaskType" NOT NULL DEFAULT 'CHAT',
    "assessmentContext" "public"."AssessmentContext" NOT NULL DEFAULT 'UNKNOWN',
    "state" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "organisationId" TEXT NOT NULL,

    CONSTRAINT "TutorThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."Upload" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" "public"."UploadType" NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "storage" "public"."StorageProvider" NOT NULL DEFAULT 'LOCAL',
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT,
    "extractedText" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "attemptId" TEXT,
    "threadId" TEXT,
    "organisationId" TEXT NOT NULL,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."UploadChunk" (
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

-- CreateTable
CREATE TABLE "public"."User" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "public"."Role" NOT NULL DEFAULT 'STUDENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Attempt_organisationId_idx" ON "public"."Attempt"("organisationId" ASC);

-- CreateIndex
CREATE INDEX "Attempt_primaryObjectiveId_idx" ON "public"."Attempt"("primaryObjectiveId" ASC);

-- CreateIndex
CREATE INDEX "Attempt_status_idx" ON "public"."Attempt"("status" ASC);

-- CreateIndex
CREATE INDEX "Attempt_studentId_createdAt_idx" ON "public"."Attempt"("studentId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Attempt_subject_idx" ON "public"."Attempt"("subject" ASC);

-- CreateIndex
CREATE INDEX "Attempt_taskType_idx" ON "public"."Attempt"("taskType" ASC);

-- CreateIndex
CREATE INDEX "Attempt_threadId_idx" ON "public"."Attempt"("threadId" ASC);

-- CreateIndex
CREATE INDEX "AttemptItem_attemptId_idx" ON "public"."AttemptItem"("attemptId" ASC);

-- CreateIndex
CREATE INDEX "AttemptItem_objectiveId_idx" ON "public"."AttemptItem"("objectiveId" ASC);

-- CreateIndex
CREATE INDEX "AttemptItem_organisationId_idx" ON "public"."AttemptItem"("organisationId" ASC);

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "public"."AuditEvent"("action" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "public"."AuditEvent"("entityType" ASC, "entityId" ASC);

-- CreateIndex
CREATE INDEX "AuditEvent_organisationId_createdAt_idx" ON "public"."AuditEvent"("organisationId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "public"."AuditEvent"("userId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CommandWord_subject_word_key" ON "public"."CommandWord"("subject" ASC, "word" ASC);

-- CreateIndex
CREATE INDEX "CommandWord_word_idx" ON "public"."CommandWord"("word" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ContentChunk_contentSha256_key" ON "public"."ContentChunk"("contentSha256" ASC);

-- CreateIndex
CREATE INDEX "ContentChunk_difficulty_idx" ON "public"."ContentChunk"("difficulty" ASC);

-- CreateIndex
CREATE INDEX "ContentChunk_embeddingId_idx" ON "public"."ContentChunk"("embeddingId" ASC);

-- CreateIndex
CREATE INDEX "ContentChunk_isActive_idx" ON "public"."ContentChunk"("isActive" ASC);

-- CreateIndex
CREATE INDEX "ContentChunk_objectiveId_idx" ON "public"."ContentChunk"("objectiveId" ASC);

-- CreateIndex
CREATE INDEX "ContentChunk_organisationId_idx" ON "public"."ContentChunk"("organisationId" ASC);

-- CreateIndex
CREATE INDEX "ContentChunk_scienceDomainConfidence_idx" ON "public"."ContentChunk"("scienceDomainConfidence" ASC);

-- CreateIndex
CREATE INDEX "ContentChunk_scienceDomain_idx" ON "public"."ContentChunk"("scienceDomain" ASC);

-- CreateIndex
CREATE INDEX "ContentChunk_sourceId_idx" ON "public"."ContentChunk"("sourceId" ASC);

-- CreateIndex
CREATE INDEX "ContentChunk_subject_keyStage_yearGroup_idx" ON "public"."ContentChunk"("subject" ASC, "keyStage" ASC, "yearGroup" ASC);

-- CreateIndex
CREATE INDEX "ContentChunk_type_idx" ON "public"."ContentChunk"("type" ASC);

-- CreateIndex
CREATE INDEX "ContentChunk_visibility_idx" ON "public"."ContentChunk"("visibility" ASC);

-- CreateIndex
CREATE INDEX "CurriculumObjective_isActive_idx" ON "public"."CurriculumObjective"("isActive" ASC);

-- CreateIndex
CREATE INDEX "CurriculumObjective_keyStage_yearGroup_idx" ON "public"."CurriculumObjective"("keyStage" ASC, "yearGroup" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumObjective_organisationId_code_key" ON "public"."CurriculumObjective"("organisationId" ASC, "code" ASC);

-- CreateIndex
CREATE INDEX "CurriculumObjective_organisationId_idx" ON "public"."CurriculumObjective"("organisationId" ASC);

-- CreateIndex
CREATE INDEX "CurriculumObjective_sourceId_idx" ON "public"."CurriculumObjective"("sourceId" ASC);

-- CreateIndex
CREATE INDEX "CurriculumObjective_strand_idx" ON "public"."CurriculumObjective"("strand" ASC);

-- CreateIndex
CREATE INDEX "CurriculumObjective_subject_keyStage_idx" ON "public"."CurriculumObjective"("subject" ASC, "keyStage" ASC);

-- CreateIndex
CREATE INDEX "CurriculumObjective_visibility_idx" ON "public"."CurriculumObjective"("visibility" ASC);

-- CreateIndex
CREATE INDEX "CurriculumSource_isActive_idx" ON "public"."CurriculumSource"("isActive" ASC);

-- CreateIndex
CREATE INDEX "CurriculumSource_organisationId_idx" ON "public"."CurriculumSource"("organisationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumSource_organisationId_slug_key" ON "public"."CurriculumSource"("organisationId" ASC, "slug" ASC);

-- CreateIndex
CREATE INDEX "CurriculumSource_visibility_idx" ON "public"."CurriculumSource"("visibility" ASC);

-- CreateIndex
CREATE INDEX "Embedding_dims_idx" ON "public"."Embedding"("dims" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Embedding_inputSha256_key" ON "public"."Embedding"("inputSha256" ASC);

-- CreateIndex
CREATE INDEX "Embedding_model_idx" ON "public"."Embedding"("model" ASC);

-- CreateIndex
CREATE INDEX "Embedding_organisationId_idx" ON "public"."Embedding"("organisationId" ASC);

-- CreateIndex
CREATE INDEX "Embedding_status_idx" ON "public"."Embedding"("status" ASC);

-- CreateIndex
CREATE INDEX "embedding_vector_hnsw_idx" ON "public"."Embedding"("vector" ASC);

-- CreateIndex
CREATE INDEX "HomeworkLink_contentChunkId_idx" ON "public"."HomeworkLink"("contentChunkId" ASC);

-- CreateIndex
CREATE INDEX "HomeworkLink_linkType_idx" ON "public"."HomeworkLink"("linkType" ASC);

-- CreateIndex
CREATE INDEX "HomeworkLink_objectiveId_idx" ON "public"."HomeworkLink"("objectiveId" ASC);

-- CreateIndex
CREATE INDEX "HomeworkLink_organisationId_idx" ON "public"."HomeworkLink"("organisationId" ASC);

-- CreateIndex
CREATE INDEX "HomeworkLink_uploadId_idx" ON "public"."HomeworkLink"("uploadId" ASC);

-- CreateIndex
CREATE INDEX "ObjectiveMastery_masteryScore_idx" ON "public"."ObjectiveMastery"("masteryScore" ASC);

-- CreateIndex
CREATE INDEX "ObjectiveMastery_objectiveId_idx" ON "public"."ObjectiveMastery"("objectiveId" ASC);

-- CreateIndex
CREATE INDEX "ObjectiveMastery_organisationId_idx" ON "public"."ObjectiveMastery"("organisationId" ASC);

-- CreateIndex
CREATE INDEX "ObjectiveMastery_studentId_idx" ON "public"."ObjectiveMastery"("studentId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "ObjectiveMastery_studentId_objectiveId_key" ON "public"."ObjectiveMastery"("studentId" ASC, "objectiveId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_slug_key" ON "public"."Organisation"("slug" ASC);

-- CreateIndex
CREATE INDEX "RagTrace_lane_idx" ON "public"."RagTrace"("lane" ASC);

-- CreateIndex
CREATE INDEX "RagTrace_organisationId_createdAt_idx" ON "public"."RagTrace"("organisationId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "RagTrace_studentId_createdAt_idx" ON "public"."RagTrace"("studentId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "RagTrace_threadId_createdAt_idx" ON "public"."RagTrace"("threadId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "public"."Session"("expiresAt" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "public"."Session"("tokenHash" ASC);

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "public"."Session"("userId" ASC);

-- CreateIndex
CREATE INDEX "Student_keyStage_idx" ON "public"."Student"("keyStage" ASC);

-- CreateIndex
CREATE INDEX "Student_organisationId_idx" ON "public"."Student"("organisationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "Student_userId_key" ON "public"."Student"("userId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "StudentPreference_studentId_key" ON "public"."StudentPreference"("studentId" ASC);

-- CreateIndex
CREATE INDEX "StudentVector_organisationId_idx" ON "public"."StudentVector"("organisationId" ASC);

-- CreateIndex
CREATE INDEX "StudentVector_studentId_idx" ON "public"."StudentVector"("studentId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "StudentVector_studentId_type_key" ON "public"."StudentVector"("studentId" ASC, "type" ASC);

-- CreateIndex
CREATE INDEX "StudentVector_type_idx" ON "public"."StudentVector"("type" ASC);

-- CreateIndex
CREATE INDEX "TutorMessage_threadId_createdAt_idx" ON "public"."TutorMessage"("threadId" ASC, "createdAt" ASC);

-- CreateIndex
CREATE INDEX "TutorThread_organisationId_idx" ON "public"."TutorThread"("organisationId" ASC);

-- CreateIndex
CREATE INDEX "TutorThread_studentId_idx" ON "public"."TutorThread"("studentId" ASC);

-- CreateIndex
CREATE INDEX "TutorThread_subject_idx" ON "public"."TutorThread"("subject" ASC);

-- CreateIndex
CREATE INDEX "TutorThread_taskType_idx" ON "public"."TutorThread"("taskType" ASC);

-- CreateIndex
CREATE INDEX "Upload_attemptId_idx" ON "public"."Upload"("attemptId" ASC);

-- CreateIndex
CREATE INDEX "Upload_createdAt_idx" ON "public"."Upload"("createdAt" ASC);

-- CreateIndex
CREATE INDEX "Upload_organisationId_idx" ON "public"."Upload"("organisationId" ASC);

-- CreateIndex
CREATE INDEX "Upload_studentId_idx" ON "public"."Upload"("studentId" ASC);

-- CreateIndex
CREATE INDEX "Upload_threadId_idx" ON "public"."Upload"("threadId" ASC);

-- CreateIndex
CREATE INDEX "Upload_type_idx" ON "public"."Upload"("type" ASC);

-- CreateIndex
CREATE INDEX "UploadChunk_embeddingId_idx" ON "public"."UploadChunk"("embeddingId" ASC);

-- CreateIndex
CREATE INDEX "UploadChunk_organisationId_idx" ON "public"."UploadChunk"("organisationId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "UploadChunk_uploadId_chunkIndex_key" ON "public"."UploadChunk"("uploadId" ASC, "chunkIndex" ASC);

-- CreateIndex
CREATE INDEX "UploadChunk_uploadId_idx" ON "public"."UploadChunk"("uploadId" ASC);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "public"."User"("email" ASC);

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "public"."User"("isActive" ASC);

-- CreateIndex
CREATE INDEX "User_organisationId_idx" ON "public"."User"("organisationId" ASC);

-- CreateIndex
CREATE INDEX "User_role_idx" ON "public"."User"("role" ASC);

-- AddForeignKey
ALTER TABLE "public"."Attempt" ADD CONSTRAINT "Attempt_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Attempt" ADD CONSTRAINT "Attempt_primaryObjectiveId_fkey" FOREIGN KEY ("primaryObjectiveId") REFERENCES "public"."CurriculumObjective"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Attempt" ADD CONSTRAINT "Attempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "public"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Attempt" ADD CONSTRAINT "Attempt_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "public"."TutorThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AttemptItem" ADD CONSTRAINT "AttemptItem_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "public"."Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AttemptItem" ADD CONSTRAINT "AttemptItem_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "public"."CurriculumObjective"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AttemptItem" ADD CONSTRAINT "AttemptItem_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditEvent" ADD CONSTRAINT "AuditEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContentChunk" ADD CONSTRAINT "ContentChunk_embeddingId_fkey" FOREIGN KEY ("embeddingId") REFERENCES "public"."Embedding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContentChunk" ADD CONSTRAINT "ContentChunk_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "public"."CurriculumObjective"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ContentChunk" ADD CONSTRAINT "ContentChunk_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."CurriculumObjective" ADD CONSTRAINT "CurriculumObjective_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Embedding" ADD CONSTRAINT "Embedding_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HomeworkLink" ADD CONSTRAINT "HomeworkLink_contentChunkId_fkey" FOREIGN KEY ("contentChunkId") REFERENCES "public"."ContentChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HomeworkLink" ADD CONSTRAINT "HomeworkLink_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "public"."CurriculumObjective"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HomeworkLink" ADD CONSTRAINT "HomeworkLink_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."HomeworkLink" ADD CONSTRAINT "HomeworkLink_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "public"."Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ObjectiveMastery" ADD CONSTRAINT "ObjectiveMastery_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "public"."CurriculumObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ObjectiveMastery" ADD CONSTRAINT "ObjectiveMastery_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."ObjectiveMastery" ADD CONSTRAINT "ObjectiveMastery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "public"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RagTrace" ADD CONSTRAINT "RagTrace_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RagTrace" ADD CONSTRAINT "RagTrace_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "public"."Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."RagTrace" ADD CONSTRAINT "RagTrace_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "public"."TutorThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Student" ADD CONSTRAINT "Student_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StudentPreference" ADD CONSTRAINT "StudentPreference_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "public"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StudentVector" ADD CONSTRAINT "StudentVector_embeddingId_fkey" FOREIGN KEY ("embeddingId") REFERENCES "public"."Embedding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StudentVector" ADD CONSTRAINT "StudentVector_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."StudentVector" ADD CONSTRAINT "StudentVector_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "public"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TutorMessage" ADD CONSTRAINT "TutorMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "public"."TutorThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TutorThread" ADD CONSTRAINT "TutorThread_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."TutorThread" ADD CONSTRAINT "TutorThread_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "public"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Upload" ADD CONSTRAINT "Upload_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "public"."Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Upload" ADD CONSTRAINT "Upload_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Upload" ADD CONSTRAINT "Upload_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "public"."Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."Upload" ADD CONSTRAINT "Upload_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "public"."TutorThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UploadChunk" ADD CONSTRAINT "UploadChunk_embeddingId_fkey" FOREIGN KEY ("embeddingId") REFERENCES "public"."Embedding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UploadChunk" ADD CONSTRAINT "UploadChunk_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "public"."Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."UploadChunk" ADD CONSTRAINT "UploadChunk_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "public"."Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

