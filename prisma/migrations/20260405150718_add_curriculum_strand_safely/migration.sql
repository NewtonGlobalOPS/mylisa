-- AlterTable
ALTER TABLE "Attempt" ADD COLUMN     "strandId" TEXT,
ADD COLUMN     "strandLabel" TEXT;

-- AlterTable
ALTER TABLE "AttemptItem" ADD COLUMN     "strandId" TEXT,
ADD COLUMN     "strandLabel" TEXT;

-- AlterTable
ALTER TABLE "ContentChunk" ADD COLUMN     "strandId" TEXT;

-- AlterTable
ALTER TABLE "CurriculumObjective" ADD COLUMN     "strandId" TEXT;

-- CreateTable
CREATE TABLE "CurriculumStrand" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "sourceId" TEXT,
    "subject" "Subject" NOT NULL,
    "keyStage" "KeyStage" NOT NULL,
    "yearGroup" INTEGER,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CurriculumStrand_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CurriculumStrand_organisationId_idx" ON "CurriculumStrand"("organisationId");

-- CreateIndex
CREATE INDEX "CurriculumStrand_sourceId_idx" ON "CurriculumStrand"("sourceId");

-- CreateIndex
CREATE INDEX "CurriculumStrand_subject_keyStage_yearGroup_idx" ON "CurriculumStrand"("subject", "keyStage", "yearGroup");

-- CreateIndex
CREATE INDEX "CurriculumStrand_slug_idx" ON "CurriculumStrand"("slug");

-- CreateIndex
CREATE INDEX "CurriculumStrand_isActive_idx" ON "CurriculumStrand"("isActive");

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumStrand_organisationId_subject_keyStage_yearGroup__key" ON "CurriculumStrand"("organisationId", "subject", "keyStage", "yearGroup", "slug");

-- CreateIndex
CREATE INDEX "Attempt_strandId_idx" ON "Attempt"("strandId");

-- CreateIndex
CREATE INDEX "AttemptItem_strandId_idx" ON "AttemptItem"("strandId");

-- CreateIndex
CREATE INDEX "ContentChunk_strand_idx" ON "ContentChunk"("strand");

-- CreateIndex
CREATE INDEX "ContentChunk_strandId_idx" ON "ContentChunk"("strandId");

-- CreateIndex
CREATE INDEX "CurriculumObjective_strandId_idx" ON "CurriculumObjective"("strandId");

-- AddForeignKey
ALTER TABLE "CurriculumStrand" ADD CONSTRAINT "CurriculumStrand_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumStrand" ADD CONSTRAINT "CurriculumStrand_sourceId_fkey" FOREIGN KEY ("sourceId") REFERENCES "CurriculumSource"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CurriculumObjective" ADD CONSTRAINT "CurriculumObjective_strandId_fkey" FOREIGN KEY ("strandId") REFERENCES "CurriculumStrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ContentChunk" ADD CONSTRAINT "ContentChunk_strandId_fkey" FOREIGN KEY ("strandId") REFERENCES "CurriculumStrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Attempt" ADD CONSTRAINT "Attempt_strandId_fkey" FOREIGN KEY ("strandId") REFERENCES "CurriculumStrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AttemptItem" ADD CONSTRAINT "AttemptItem_strandId_fkey" FOREIGN KEY ("strandId") REFERENCES "CurriculumStrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
