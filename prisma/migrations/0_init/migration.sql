-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "ScienceDomain" AS ENUM ('BIOLOGY', 'CHEMISTRY', 'PHYSICS', 'GENERAL_SCIENCE');

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('STUDENT', 'PARENT', 'STAFF', 'ADMIN');

-- CreateEnum
CREATE TYPE "Subject" AS ENUM ('MATHS', 'SCIENCE', 'COMPUTING');

-- CreateEnum
CREATE TYPE "KeyStage" AS ENUM ('KS1', 'KS2', 'KS3', 'KS4');

-- CreateEnum
CREATE TYPE "TutoringMode" AS ENUM ('AUTO', 'GENTLE', 'COACH');

-- CreateEnum
CREATE TYPE "Verbosity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "StepSize" AS ENUM ('SMALL', 'NORMAL');

-- CreateEnum
CREATE TYPE "TaskType" AS ENUM ('CHAT', 'CHECK_WORK', 'MICRO_LESSON', 'MINI_QUIZ', 'PRACTICE_SET');

-- CreateEnum
CREATE TYPE "AssessmentContext" AS ENUM ('HOMEWORK', 'CLASSWORK', 'REVISION', 'ASSESSED', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "AttemptStatus" AS ENUM ('STARTED', 'SUBMITTED', 'ABANDONED');

-- CreateEnum
CREATE TYPE "HelpLevel" AS ENUM ('NONE', 'HINT', 'EXAMPLE', 'MICRO_LESSON');

-- CreateEnum
CREATE TYPE "UploadType" AS ENUM ('QUESTION', 'STUDENT_WORK', 'SUPPORTING_MATERIAL');

-- CreateEnum
CREATE TYPE "StorageProvider" AS ENUM ('LOCAL', 'S3', 'AZURE_BLOB');

-- CreateEnum
CREATE TYPE "ChunkType" AS ENUM ('OBJECTIVE', 'EXPLANATION', 'WORKED_EXAMPLE', 'MISCONCEPTION', 'PRACTICE', 'COMMAND_WORDS', 'GLOSSARY');

-- CreateEnum
CREATE TYPE "DifficultyBand" AS ENUM ('EASY', 'MEDIUM', 'HARD');

-- CreateEnum
CREATE TYPE "MasteryTrend" AS ENUM ('IMPROVING', 'FLAT', 'DECLINING');

-- CreateEnum
CREATE TYPE "ConsentState" AS ENUM ('UNKNOWN', 'GRANTED', 'DENIED');

-- CreateEnum
CREATE TYPE "VisibilityScope" AS ENUM ('ORG_ONLY', 'COHORT', 'STAFF_ONLY', 'STUDENT_OWNED');

-- CreateEnum
CREATE TYPE "RagLane" AS ENUM ('STRUCTURED_OBJECTIVE', 'FREE_TEXT_LESSON', 'HOMEWORK_HELP');

-- CreateEnum
CREATE TYPE "EmbeddingStatus" AS ENUM ('PENDING', 'READY', 'FAILED');

-- CreateEnum
CREATE TYPE "HomeworkLinkType" AS ENUM ('SAME_OBJECTIVE', 'SAME_TOPIC', 'PREREQ_GAP', 'WORKED_EXAMPLE_MATCH');

-- CreateEnum
CREATE TYPE "StudentVectorType" AS ENUM ('INTERESTS', 'MISCONCEPTIONS', 'STRENGTHS');

-- CreateTable
CREATE TABLE "Organisation" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organisation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'STUDENT',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
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
CREATE TABLE "Student" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "age" INTEGER NOT NULL,
    "keyStage" "KeyStage",
    "subjects" "Subject"[],
    "guardianEmail" TEXT,
    "consentState" "ConsentState" NOT NULL DEFAULT 'UNKNOWN',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Student_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentPreference" (
    "id" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "tutoringMode" "TutoringMode" NOT NULL DEFAULT 'AUTO',
    "verbosity" "Verbosity" NOT NULL DEFAULT 'LOW',
    "stepSize" "StepSize" NOT NULL DEFAULT 'SMALL',
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
CREATE TABLE "CurriculumSource" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "license" TEXT NOT NULL,
    "attribution" TEXT,
    "url" TEXT,
    "visibility" "VisibilityScope" NOT NULL DEFAULT 'ORG_ONLY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurriculumSource_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CurriculumObjective" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "subject" "Subject" NOT NULL,
    "keyStage" "KeyStage" NOT NULL,
    "yearGroup" INTEGER,
    "strand" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "statutory" BOOLEAN NOT NULL DEFAULT true,
    "keywords" TEXT[],
    "sourceId" TEXT NOT NULL,
    "visibility" "VisibilityScope" NOT NULL DEFAULT 'ORG_ONLY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurriculumObjective_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ContentChunk" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "objectiveId" TEXT,
    "subject" "Subject" NOT NULL,
    "keyStage" "KeyStage" NOT NULL,
    "yearGroup" INTEGER,
    "strand" TEXT,
    "type" "ChunkType" NOT NULL,
    "difficulty" "DifficultyBand" NOT NULL DEFAULT 'MEDIUM',
    "content" TEXT NOT NULL,
    "tokenCount" INTEGER,
    "contentSha256" TEXT NOT NULL,
    "citations" TEXT[],
    "tags" TEXT[],
    "visibility" "VisibilityScope" NOT NULL DEFAULT 'ORG_ONLY',
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "scienceDomain" "ScienceDomain",
    "scienceDomainConfidence" DOUBLE PRECISION,
    "scienceDomainModel" TEXT,
    "scienceDomainTaggedAt" TIMESTAMP(3),
    "embeddingId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ContentChunk_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CommandWord" (
    "id" TEXT NOT NULL,
    "subject" "Subject" NOT NULL,
    "word" TEXT NOT NULL,
    "definition" TEXT NOT NULL,
    "scaffolds" TEXT[],
    "examples" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CommandWord_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Embedding" (
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

-- CreateTable
CREATE TABLE "Upload" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" "UploadType" NOT NULL,
    "originalName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" BIGINT NOT NULL,
    "storage" "StorageProvider" NOT NULL DEFAULT 'LOCAL',
    "storageKey" TEXT NOT NULL,
    "checksumSha256" TEXT,
    "extractedText" TEXT,
    "ocrConfidence" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "attemptId" TEXT,
    "threadId" TEXT,

    CONSTRAINT "Upload_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UploadChunk" (
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
CREATE TABLE "HomeworkLink" (
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

-- CreateTable
CREATE TABLE "TutorThread" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subject" "Subject" NOT NULL,
    "taskType" "TaskType" NOT NULL DEFAULT 'CHAT',
    "assessmentContext" "AssessmentContext" NOT NULL DEFAULT 'UNKNOWN',
    "state" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TutorThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TutorMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TutorMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Attempt" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subject" "Subject" NOT NULL,
    "taskType" "TaskType" NOT NULL,
    "assessmentContext" "AssessmentContext" NOT NULL DEFAULT 'UNKNOWN',
    "primaryObjectiveId" TEXT,
    "threadId" TEXT,
    "status" "AttemptStatus" NOT NULL DEFAULT 'STARTED',
    "score" DOUBLE PRECISION,
    "helpUsed" "HelpLevel" NOT NULL DEFAULT 'NONE',
    "timeOnTaskSec" INTEGER,
    "frustration" TEXT,
    "notes" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "Attempt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AttemptItem" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "attemptId" TEXT NOT NULL,
    "objectiveId" TEXT,
    "prompt" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "difficulty" "DifficultyBand" NOT NULL DEFAULT 'MEDIUM',
    "response" TEXT,
    "isCorrect" BOOLEAN,
    "score" DOUBLE PRECISION,
    "errorTags" TEXT[],
    "misconceptionCodes" TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AttemptItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ObjectiveMastery" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "masteryScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "confidenceScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "stabilityScore" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "trend" "MasteryTrend" NOT NULL DEFAULT 'FLAT',
    "commonErrorTags" TEXT[],
    "lastSeenAt" TIMESTAMP(3),
    "attemptsCount" INTEGER NOT NULL DEFAULT 0,
    "correctCount" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ObjectiveMastery_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentVector" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "type" "StudentVectorType" NOT NULL,
    "embeddingId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentVector_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RagTrace" (
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

-- CreateTable
CREATE TABLE "AuditEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditEvent_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Organisation_slug_key" ON "Organisation"("slug");

-- CreateIndex
CREATE INDEX "Organisation_isActive_idx" ON "Organisation"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_organisationId_idx" ON "User"("organisationId");

-- CreateIndex
CREATE INDEX "User_role_idx" ON "User"("role");

-- CreateIndex
CREATE INDEX "User_isActive_idx" ON "User"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Session_expiresAt_idx" ON "Session"("expiresAt");

-- CreateIndex
CREATE INDEX "Session_revokedAt_idx" ON "Session"("revokedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Student_userId_key" ON "Student"("userId");

-- CreateIndex
CREATE INDEX "Student_organisationId_idx" ON "Student"("organisationId");

-- CreateIndex
CREATE INDEX "Student_keyStage_idx" ON "Student"("keyStage");

-- CreateIndex
CREATE UNIQUE INDEX "StudentPreference_studentId_key" ON "StudentPreference"("studentId");

-- CreateIndex
CREATE INDEX "CurriculumSource_organisationId_idx" ON "CurriculumSource"("organisationId");

-- CreateIndex
CREATE INDEX "CurriculumSource_visibility_idx" ON "CurriculumSource"("visibility");

-- CreateIndex
CREATE INDEX "CurriculumSource_isActive_idx" ON "CurriculumSource"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumSource_organisationId_slug_key" ON "CurriculumSource"("organisationId", "slug");

-- CreateIndex
CREATE INDEX "CurriculumObjective_organisationId_idx" ON "CurriculumObjective"("organisationId");

-- CreateIndex
CREATE INDEX "CurriculumObjective_subject_keyStage_idx" ON "CurriculumObjective"("subject", "keyStage");

-- CreateIndex
CREATE INDEX "CurriculumObjective_keyStage_yearGroup_idx" ON "CurriculumObjective"("keyStage", "yearGroup");

-- CreateIndex
CREATE INDEX "CurriculumObjective_strand_idx" ON "CurriculumObjective"("strand");

-- CreateIndex
CREATE INDEX "CurriculumObjective_visibility_idx" ON "CurriculumObjective"("visibility");

-- CreateIndex
CREATE INDEX "CurriculumObjective_sourceId_idx" ON "CurriculumObjective"("sourceId");

-- CreateIndex
CREATE INDEX "CurriculumObjective_isActive_idx" ON "CurriculumObjective"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumObjective_organisationId_code_key" ON "CurriculumObjective"("organisationId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "ContentChunk_contentSha256_key" ON "ContentChunk"("contentSha256");

-- CreateIndex
CREATE INDEX "ContentChunk_organisationId_idx" ON "ContentChunk"("organisationId");

-- CreateIndex
CREATE INDEX "ContentChunk_sourceId_idx" ON "ContentChunk"("sourceId");

-- CreateIndex
CREATE INDEX "ContentChunk_objectiveId_idx" ON "ContentChunk"("objectiveId");

-- CreateIndex
CREATE INDEX "ContentChunk_subject_keyStage_yearGroup_idx" ON "ContentChunk"("subject", "keyStage", "yearGroup");

-- CreateIndex
CREATE INDEX "ContentChunk_type_idx" ON "ContentChunk"("type");

-- CreateIndex
CREATE INDEX "ContentChunk_difficulty_idx" ON "ContentChunk"("difficulty");

-- CreateIndex
CREATE INDEX "ContentChunk_visibility_idx" ON "ContentChunk"("visibility");

-- CreateIndex
CREATE INDEX "ContentChunk_isActive_idx" ON "ContentChunk"("isActive");

-- CreateIndex
CREATE INDEX "ContentChunk_scienceDomain_idx" ON "ContentChunk"("scienceDomain");

-- CreateIndex
CREATE INDEX "ContentChunk_scienceDomainConfidence_idx" ON "ContentChunk"("scienceDomainConfidence");

-- CreateIndex
CREATE INDEX "ContentChunk_embeddingId_idx" ON "ContentChunk"("embeddingId");

-- CreateIndex
CREATE INDEX "CommandWord_word_idx" ON "CommandWord"("word");

-- CreateIndex
CREATE UNIQUE INDEX "CommandWord_subject_word_key" ON "CommandWord"("subject", "word");

-- CreateIndex
CREATE UNIQUE INDEX "Embedding_inputSha256_key" ON "Embedding"("inputSha256");

-- CreateIndex
CREATE INDEX "Embedding_organisationId_idx" ON "Embedding"("organisationId");

-- CreateIndex
CREATE INDEX "Embedding_status_idx" ON "Embedding"("status");

-- CreateIndex
CREATE INDEX "Embedding_model_idx" ON "Embedding"("model");

-- CreateIndex
CREATE INDEX "Embedding_dims_idx" ON "Embedding"("dims");

-- CreateIndex
CREATE INDEX "Upload_organisationId_idx" ON "Upload"("organisationId");

-- CreateIndex
CREATE INDEX "Upload_studentId_idx" ON "Upload"("studentId");

-- CreateIndex
CREATE INDEX "Upload_attemptId_idx" ON "Upload"("attemptId");

-- CreateIndex
CREATE INDEX "Upload_threadId_idx" ON "Upload"("threadId");

-- CreateIndex
CREATE INDEX "Upload_type_idx" ON "Upload"("type");

-- CreateIndex
CREATE INDEX "Upload_createdAt_idx" ON "Upload"("createdAt");

-- CreateIndex
CREATE INDEX "UploadChunk_organisationId_idx" ON "UploadChunk"("organisationId");

-- CreateIndex
CREATE INDEX "UploadChunk_uploadId_idx" ON "UploadChunk"("uploadId");

-- CreateIndex
CREATE INDEX "UploadChunk_embeddingId_idx" ON "UploadChunk"("embeddingId");

-- CreateIndex
CREATE UNIQUE INDEX "UploadChunk_uploadId_chunkIndex_key" ON "UploadChunk"("uploadId", "chunkIndex");

-- CreateIndex
CREATE INDEX "HomeworkLink_organisationId_idx" ON "HomeworkLink"("organisationId");

-- CreateIndex
CREATE INDEX "HomeworkLink_uploadId_idx" ON "HomeworkLink"("uploadId");

-- CreateIndex
CREATE INDEX "HomeworkLink_objectiveId_idx" ON "HomeworkLink"("objectiveId");

-- CreateIndex
CREATE INDEX "HomeworkLink_contentChunkId_idx" ON "HomeworkLink"("contentChunkId");

-- CreateIndex
CREATE INDEX "HomeworkLink_linkType_idx" ON "HomeworkLink"("linkType");

-- CreateIndex
CREATE INDEX "TutorThread_organisationId_idx" ON "TutorThread"("organisationId");

-- CreateIndex
CREATE INDEX "TutorThread_studentId_idx" ON "TutorThread"("studentId");

-- CreateIndex
CREATE INDEX "TutorThread_subject_idx" ON "TutorThread"("subject");

-- CreateIndex
CREATE INDEX "TutorThread_taskType_idx" ON "TutorThread"("taskType");

-- CreateIndex
CREATE INDEX "TutorMessage_threadId_createdAt_idx" ON "TutorMessage"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "Attempt_organisationId_idx" ON "Attempt"("organisationId");

-- CreateIndex
CREATE INDEX "Attempt_studentId_createdAt_idx" ON "Attempt"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "Attempt_subject_idx" ON "Attempt"("subject");

-- CreateIndex
CREATE INDEX "Attempt_taskType_idx" ON "Attempt"("taskType");

-- CreateIndex
CREATE INDEX "Attempt_primaryObjectiveId_idx" ON "Attempt"("primaryObjectiveId");

-- CreateIndex
CREATE INDEX "Attempt_threadId_idx" ON "Attempt"("threadId");

-- CreateIndex
CREATE INDEX "Attempt_status_idx" ON "Attempt"("status");

-- CreateIndex
CREATE INDEX "AttemptItem_organisationId_idx" ON "AttemptItem"("organisationId");

-- CreateIndex
CREATE INDEX "AttemptItem_attemptId_idx" ON "AttemptItem"("attemptId");

-- CreateIndex
CREATE INDEX "AttemptItem_objectiveId_idx" ON "AttemptItem"("objectiveId");

-- CreateIndex
CREATE INDEX "ObjectiveMastery_organisationId_idx" ON "ObjectiveMastery"("organisationId");

-- CreateIndex
CREATE INDEX "ObjectiveMastery_studentId_idx" ON "ObjectiveMastery"("studentId");

-- CreateIndex
CREATE INDEX "ObjectiveMastery_objectiveId_idx" ON "ObjectiveMastery"("objectiveId");

-- CreateIndex
CREATE INDEX "ObjectiveMastery_masteryScore_idx" ON "ObjectiveMastery"("masteryScore");

-- CreateIndex
CREATE UNIQUE INDEX "ObjectiveMastery_studentId_objectiveId_key" ON "ObjectiveMastery"("studentId", "objectiveId");

-- CreateIndex
CREATE INDEX "StudentVector_organisationId_idx" ON "StudentVector"("organisationId");

-- CreateIndex
CREATE INDEX "StudentVector_studentId_idx" ON "StudentVector"("studentId");

-- CreateIndex
CREATE INDEX "StudentVector_type_idx" ON "StudentVector"("type");

-- CreateIndex
CREATE UNIQUE INDEX "StudentVector_studentId_type_key" ON "StudentVector"("studentId", "type");

-- CreateIndex
CREATE INDEX "RagTrace_organisationId_createdAt_idx" ON "RagTrace"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "RagTrace_studentId_createdAt_idx" ON "RagTrace"("studentId", "createdAt");

-- CreateIndex
CREATE INDEX "RagTrace_threadId_createdAt_idx" ON "RagTrace"("threadId", "createdAt");

-- CreateIndex
CREATE INDEX "RagTrace_lane_idx" ON "RagTrace"("lane");

-- CreateIndex
CREATE INDEX "AuditEvent_organisationId_createdAt_idx" ON "AuditEvent"("organisationId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_userId_createdAt_idx" ON "AuditEvent"("userId", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_action_createdAt_idx" ON "AuditEvent"("action", "createdAt");

-- CreateIndex
CREATE INDEX "AuditEvent_entityType_entityId_idx" ON "AuditEvent"("entityType", "entityId");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPreference" ADD CONSTRAINT "StudentPreference_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumSource" ADD CONSTRAINT "CurriculumSource_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumObjective" ADD CONSTRAINT "CurriculumObjective_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumObjective" ADD CONSTRAINT "CurriculumObjective_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CurriculumSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentChunk" ADD CONSTRAINT "ContentChunk_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentChunk" ADD CONSTRAINT "ContentChunk_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CurriculumSource"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentChunk" ADD CONSTRAINT "ContentChunk_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "CurriculumObjective"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentChunk" ADD CONSTRAINT "ContentChunk_embeddingId_fkey" FOREIGN KEY ("embeddingId") REFERENCES "Embedding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Embedding" ADD CONSTRAINT "Embedding_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Upload" ADD CONSTRAINT "Upload_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "TutorThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadChunk" ADD CONSTRAINT "UploadChunk_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadChunk" ADD CONSTRAINT "UploadChunk_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UploadChunk" ADD CONSTRAINT "UploadChunk_embeddingId_fkey" FOREIGN KEY ("embeddingId") REFERENCES "Embedding"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkLink" ADD CONSTRAINT "HomeworkLink_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkLink" ADD CONSTRAINT "HomeworkLink_uploadId_fkey" FOREIGN KEY ("uploadId") REFERENCES "Upload"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkLink" ADD CONSTRAINT "HomeworkLink_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "CurriculumObjective"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HomeworkLink" ADD CONSTRAINT "HomeworkLink_contentChunkId_fkey" FOREIGN KEY ("contentChunkId") REFERENCES "ContentChunk"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorThread" ADD CONSTRAINT "TutorThread_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorThread" ADD CONSTRAINT "TutorThread_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TutorMessage" ADD CONSTRAINT "TutorMessage_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "TutorThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_primaryObjectiveId_fkey" FOREIGN KEY ("primaryObjectiveId") REFERENCES "CurriculumObjective"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "TutorThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptItem" ADD CONSTRAINT "AttemptItem_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptItem" ADD CONSTRAINT "AttemptItem_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptItem" ADD CONSTRAINT "AttemptItem_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "CurriculumObjective"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveMastery" ADD CONSTRAINT "ObjectiveMastery_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveMastery" ADD CONSTRAINT "ObjectiveMastery_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ObjectiveMastery" ADD CONSTRAINT "ObjectiveMastery_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "CurriculumObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentVector" ADD CONSTRAINT "StudentVector_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentVector" ADD CONSTRAINT "StudentVector_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentVector" ADD CONSTRAINT "StudentVector_embeddingId_fkey" FOREIGN KEY ("embeddingId") REFERENCES "Embedding"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagTrace" ADD CONSTRAINT "RagTrace_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagTrace" ADD CONSTRAINT "RagTrace_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RagTrace" ADD CONSTRAINT "RagTrace_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "TutorThread"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditEvent" ADD CONSTRAINT "AuditEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

