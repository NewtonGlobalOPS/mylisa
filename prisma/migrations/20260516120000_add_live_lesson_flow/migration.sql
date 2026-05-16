CREATE TABLE "CoursePlan" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "subject" "Subject" NOT NULL DEFAULT 'MATHS',
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "assessmentSessionId" TEXT,
    "ndscreenSessionId" TEXT,
    "sourceSummary" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoursePlan_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "CoursePlanItem" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "coursePlanId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "strand" TEXT NOT NULL,
    "yearGroup" INTEGER,
    "priorityWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PLANNED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CoursePlanItem_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonSession" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "tutorUserId" TEXT NOT NULL,
    "coursePlanId" TEXT,
    "objectiveId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DRAFT',
    "currentBlockKey" TEXT,
    "blockStartedAt" TIMESTAMP(3),
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "flowJson" JSONB NOT NULL,
    "tutorRuntimeJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonSessionParticipant" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "lessonSessionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'INVITED',
    "currentBlockKey" TEXT,
    "currentQuestionId" TEXT,
    "questionsAnswered" INTEGER NOT NULL DEFAULT 0,
    "questionsCorrect" INTEGER NOT NULL DEFAULT 0,
    "lastActiveAt" TIMESTAMP(3),
    "runtimeJson" JSONB NOT NULL,
    "progressJson" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "LessonSessionParticipant_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "LessonSessionEvent" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "lessonSessionId" TEXT NOT NULL,
    "studentId" TEXT,
    "userId" TEXT,
    "type" TEXT NOT NULL,
    "blockKey" TEXT,
    "payload" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LessonSessionEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "CoursePlan_organisationId_idx" ON "CoursePlan"("organisationId");
CREATE INDEX "CoursePlan_studentId_idx" ON "CoursePlan"("studentId");
CREATE INDEX "CoursePlan_subject_idx" ON "CoursePlan"("subject");
CREATE INDEX "CoursePlan_status_idx" ON "CoursePlan"("status");
CREATE INDEX "CoursePlan_assessmentSessionId_idx" ON "CoursePlan"("assessmentSessionId");

CREATE UNIQUE INDEX "CoursePlanItem_coursePlanId_sequence_key" ON "CoursePlanItem"("coursePlanId", "sequence");
CREATE INDEX "CoursePlanItem_organisationId_idx" ON "CoursePlanItem"("organisationId");
CREATE INDEX "CoursePlanItem_studentId_idx" ON "CoursePlanItem"("studentId");
CREATE INDEX "CoursePlanItem_objectiveId_idx" ON "CoursePlanItem"("objectiveId");
CREATE INDEX "CoursePlanItem_strand_idx" ON "CoursePlanItem"("strand");
CREATE INDEX "CoursePlanItem_status_idx" ON "CoursePlanItem"("status");

CREATE INDEX "LessonSession_organisationId_idx" ON "LessonSession"("organisationId");
CREATE INDEX "LessonSession_tutorUserId_idx" ON "LessonSession"("tutorUserId");
CREATE INDEX "LessonSession_coursePlanId_idx" ON "LessonSession"("coursePlanId");
CREATE INDEX "LessonSession_objectiveId_idx" ON "LessonSession"("objectiveId");
CREATE INDEX "LessonSession_status_idx" ON "LessonSession"("status");
CREATE INDEX "LessonSession_currentBlockKey_idx" ON "LessonSession"("currentBlockKey");

CREATE UNIQUE INDEX "LessonSessionParticipant_lessonSessionId_studentId_key" ON "LessonSessionParticipant"("lessonSessionId", "studentId");
CREATE INDEX "LessonSessionParticipant_organisationId_idx" ON "LessonSessionParticipant"("organisationId");
CREATE INDEX "LessonSessionParticipant_lessonSessionId_idx" ON "LessonSessionParticipant"("lessonSessionId");
CREATE INDEX "LessonSessionParticipant_studentId_idx" ON "LessonSessionParticipant"("studentId");
CREATE INDEX "LessonSessionParticipant_status_idx" ON "LessonSessionParticipant"("status");
CREATE INDEX "LessonSessionParticipant_currentBlockKey_idx" ON "LessonSessionParticipant"("currentBlockKey");

CREATE INDEX "LessonSessionEvent_organisationId_idx" ON "LessonSessionEvent"("organisationId");
CREATE INDEX "LessonSessionEvent_lessonSessionId_createdAt_idx" ON "LessonSessionEvent"("lessonSessionId", "createdAt");
CREATE INDEX "LessonSessionEvent_studentId_createdAt_idx" ON "LessonSessionEvent"("studentId", "createdAt");
CREATE INDEX "LessonSessionEvent_userId_createdAt_idx" ON "LessonSessionEvent"("userId", "createdAt");
CREATE INDEX "LessonSessionEvent_type_idx" ON "LessonSessionEvent"("type");

ALTER TABLE "CoursePlan" ADD CONSTRAINT "CoursePlan_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoursePlan" ADD CONSTRAINT "CoursePlan_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "CoursePlanItem" ADD CONSTRAINT "CoursePlanItem_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoursePlanItem" ADD CONSTRAINT "CoursePlanItem_coursePlanId_fkey" FOREIGN KEY ("coursePlanId") REFERENCES "CoursePlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoursePlanItem" ADD CONSTRAINT "CoursePlanItem_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CoursePlanItem" ADD CONSTRAINT "CoursePlanItem_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "CurriculumObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_tutorUserId_fkey" FOREIGN KEY ("tutorUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_coursePlanId_fkey" FOREIGN KEY ("coursePlanId") REFERENCES "CoursePlan"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LessonSession" ADD CONSTRAINT "LessonSession_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "CurriculumObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonSessionParticipant" ADD CONSTRAINT "LessonSessionParticipant_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonSessionParticipant" ADD CONSTRAINT "LessonSessionParticipant_lessonSessionId_fkey" FOREIGN KEY ("lessonSessionId") REFERENCES "LessonSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonSessionParticipant" ADD CONSTRAINT "LessonSessionParticipant_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "LessonSessionEvent" ADD CONSTRAINT "LessonSessionEvent_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonSessionEvent" ADD CONSTRAINT "LessonSessionEvent_lessonSessionId_fkey" FOREIGN KEY ("lessonSessionId") REFERENCES "LessonSession"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LessonSessionEvent" ADD CONSTRAINT "LessonSessionEvent_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "LessonSessionEvent" ADD CONSTRAINT "LessonSessionEvent_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
