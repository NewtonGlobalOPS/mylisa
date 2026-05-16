-- CreateTable
CREATE TABLE "WrapperVector" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "objectiveId" TEXT,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "scope" TEXT NOT NULL DEFAULT 'GENERAL',
    "source" TEXT NOT NULL DEFAULT 'MANUAL',
    "strand" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WrapperVector_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "WrapperVector_organisationId_idx" ON "WrapperVector"("organisationId");

-- CreateIndex
CREATE INDEX "WrapperVector_studentId_idx" ON "WrapperVector"("studentId");

-- CreateIndex
CREATE INDEX "WrapperVector_objectiveId_idx" ON "WrapperVector"("objectiveId");

-- CreateIndex
CREATE INDEX "WrapperVector_scope_idx" ON "WrapperVector"("scope");

-- CreateIndex
CREATE INDEX "WrapperVector_strand_idx" ON "WrapperVector"("strand");

-- CreateIndex
CREATE INDEX "WrapperVector_isActive_idx" ON "WrapperVector"("isActive");

-- AddForeignKey
ALTER TABLE "WrapperVector" ADD CONSTRAINT "WrapperVector_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WrapperVector" ADD CONSTRAINT "WrapperVector_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WrapperVector" ADD CONSTRAINT "WrapperVector_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "CurriculumObjective"("id") ON DELETE SET NULL ON UPDATE CASCADE;
