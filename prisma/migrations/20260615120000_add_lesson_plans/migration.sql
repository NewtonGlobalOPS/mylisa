-- Add first-class lesson planning without changing the existing objective-led runtime path.

CREATE TABLE "LessonPlan" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "studentId" TEXT,
  "subject" "Subject" NOT NULL DEFAULT 'MATHS',
  "keyStage" "KeyStage",
  "yearGroup" INTEGER,
  "title" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "source" TEXT NOT NULL DEFAULT 'OAK_ALIGNED_LLM',
  "assessmentAuthority" TEXT NOT NULL DEFAULT 'OAK_OBJECTIVES',
  "assessmentCadenceWeeks" INTEGER NOT NULL DEFAULT 4,
  "teachingContextJson" JSONB,
  "oakAuthorityJson" JSONB,
  "assessmentPolicyJson" JSONB,
  "planJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LessonPlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonPlanObjective" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "lessonPlanId" TEXT NOT NULL,
  "objectiveId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'ANCHOR',
  "strand" TEXT NOT NULL,
  "yearGroup" INTEGER,
  "alignmentConfidence" DOUBLE PRECISION NOT NULL DEFAULT 0.75,
  "alignmentRationale" TEXT NOT NULL,
  "taughtContentSummary" TEXT,
  "generatedContentNotes" TEXT,
  "assessmentEligible" BOOLEAN NOT NULL DEFAULT true,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LessonPlanObjective_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonPlanSection" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "lessonPlanId" TEXT NOT NULL,
  "sequence" INTEGER NOT NULL,
  "phase" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "durationMinutes" INTEGER NOT NULL,
  "source" TEXT NOT NULL DEFAULT 'LLM_GENERATED',
  "teacherActions" TEXT[],
  "studentActions" TEXT[],
  "workedExampleJson" JSONB,
  "boardSpecJson" JSONB,
  "practiceSpecJson" JSONB,
  "assessmentLinksJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LessonPlanSection_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonPlanAssessmentBlueprint" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "lessonPlanId" TEXT NOT NULL,
  "cadenceWeeks" INTEGER NOT NULL DEFAULT 4,
  "status" TEXT NOT NULL DEFAULT 'DRAFT',
  "authorityJson" JSONB NOT NULL,
  "objectiveMixJson" JSONB NOT NULL,
  "generatedQuestionPolicyJson" JSONB NOT NULL,
  "quizDraftJson" JSONB,
  "reportingJson" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,

  CONSTRAINT "LessonPlanAssessmentBlueprint_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "LessonSession" ADD COLUMN "lessonPlanId" TEXT;

CREATE UNIQUE INDEX "LessonPlanObjective_lessonPlanId_objectiveId_key" ON "LessonPlanObjective"("lessonPlanId", "objectiveId");
CREATE UNIQUE INDEX "LessonPlanObjective_lessonPlanId_sequence_key" ON "LessonPlanObjective"("lessonPlanId", "sequence");
CREATE UNIQUE INDEX "LessonPlanSection_lessonPlanId_sequence_key" ON "LessonPlanSection"("lessonPlanId", "sequence");

CREATE INDEX "LessonPlan_organisationId_idx" ON "LessonPlan"("organisationId");
CREATE INDEX "LessonPlan_studentId_idx" ON "LessonPlan"("studentId");
CREATE INDEX "LessonPlan_subject_idx" ON "LessonPlan"("subject");
CREATE INDEX "LessonPlan_keyStage_yearGroup_idx" ON "LessonPlan"("keyStage", "yearGroup");
CREATE INDEX "LessonPlan_status_idx" ON "LessonPlan"("status");
CREATE INDEX "LessonPlan_createdAt_idx" ON "LessonPlan"("createdAt");

CREATE INDEX "LessonPlanObjective_organisationId_idx" ON "LessonPlanObjective"("organisationId");
CREATE INDEX "LessonPlanObjective_lessonPlanId_idx" ON "LessonPlanObjective"("lessonPlanId");
CREATE INDEX "LessonPlanObjective_objectiveId_idx" ON "LessonPlanObjective"("objectiveId");
CREATE INDEX "LessonPlanObjective_strand_idx" ON "LessonPlanObjective"("strand");
CREATE INDEX "LessonPlanObjective_assessmentEligible_idx" ON "LessonPlanObjective"("assessmentEligible");

CREATE INDEX "LessonPlanSection_organisationId_idx" ON "LessonPlanSection"("organisationId");
CREATE INDEX "LessonPlanSection_lessonPlanId_idx" ON "LessonPlanSection"("lessonPlanId");
CREATE INDEX "LessonPlanSection_phase_idx" ON "LessonPlanSection"("phase");
CREATE INDEX "LessonPlanSection_source_idx" ON "LessonPlanSection"("source");

CREATE INDEX "LessonPlanAssessmentBlueprint_organisationId_idx" ON "LessonPlanAssessmentBlueprint"("organisationId");
CREATE INDEX "LessonPlanAssessmentBlueprint_lessonPlanId_idx" ON "LessonPlanAssessmentBlueprint"("lessonPlanId");
CREATE INDEX "LessonPlanAssessmentBlueprint_cadenceWeeks_idx" ON "LessonPlanAssessmentBlueprint"("cadenceWeeks");
CREATE INDEX "LessonPlanAssessmentBlueprint_status_idx" ON "LessonPlanAssessmentBlueprint"("status");

CREATE INDEX "LessonSession_lessonPlanId_idx" ON "LessonSession"("lessonPlanId");

ALTER TABLE "LessonPlan" ADD CONSTRAINT "LessonPlan_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonPlan" ADD CONSTRAINT "LessonPlan_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "LessonPlanObjective" ADD CONSTRAINT "LessonPlanObjective_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonPlanObjective" ADD CONSTRAINT "LessonPlanObjective_lessonPlanId_fkey" FOREIGN KEY ("lessonPlanId") REFERENCES "LessonPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonPlanObjective" ADD CONSTRAINT "LessonPlanObjective_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "CurriculumObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonPlanSection" ADD CONSTRAINT "LessonPlanSection_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonPlanSection" ADD CONSTRAINT "LessonPlanSection_lessonPlanId_fkey" FOREIGN KEY ("lessonPlanId") REFERENCES "LessonPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonPlanAssessmentBlueprint" ADD CONSTRAINT "LessonPlanAssessmentBlueprint_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonPlanAssessmentBlueprint" ADD CONSTRAINT "LessonPlanAssessmentBlueprint_lessonPlanId_fkey" FOREIGN KEY ("lessonPlanId") REFERENCES "LessonPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_lessonPlanId_fkey" FOREIGN KEY ("lessonPlanId") REFERENCES "LessonPlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
