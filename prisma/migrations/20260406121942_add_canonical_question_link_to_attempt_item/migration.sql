-- CreateEnum
CREATE TYPE "CanonicalItemType" AS ENUM ('EQUATION');

-- CreateEnum
CREATE TYPE "CanonicalOperator" AS ENUM ('ADD', 'SUBTRACT', 'MULTIPLY', 'DIVIDE', 'EQUALS');

-- CreateEnum
CREATE TYPE "CanonicalItemStatus" AS ENUM ('DRAFT', 'ACTIVE', 'RETIRED');

-- AlterTable
ALTER TABLE "AttemptItem" ADD COLUMN     "canonicalEquation" TEXT,
ADD COLUMN     "canonicalOperator" TEXT,
ADD COLUMN     "canonicalQuestionId" TEXT,
ADD COLUMN     "lhsA" INTEGER,
ADD COLUMN     "lhsB" INTEGER,
ADD COLUMN     "rhs" INTEGER;

-- CreateTable
CREATE TABLE "CanonicalQuestion" (
    "id" TEXT NOT NULL,
    "organisationId" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "strandId" TEXT,
    "strandLabel" TEXT,
    "itemType" "CanonicalItemType" NOT NULL DEFAULT 'EQUATION',
    "operator" "CanonicalOperator" NOT NULL,
    "lhsA" INTEGER NOT NULL,
    "lhsB" INTEGER,
    "rhs" INTEGER NOT NULL,
    "equation" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "difficulty" "DifficultyBand" NOT NULL DEFAULT 'EASY',
    "isGenerated" BOOLEAN NOT NULL DEFAULT true,
    "generatorVersion" TEXT,
    "generatorMeta" JSONB,
    "status" "CanonicalItemStatus" NOT NULL DEFAULT 'ACTIVE',
    "contentSha256" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CanonicalQuestion_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalQuestion_contentSha256_key" ON "CanonicalQuestion"("contentSha256");

-- CreateIndex
CREATE INDEX "CanonicalQuestion_organisationId_idx" ON "CanonicalQuestion"("organisationId");

-- CreateIndex
CREATE INDEX "CanonicalQuestion_objectiveId_idx" ON "CanonicalQuestion"("objectiveId");

-- CreateIndex
CREATE INDEX "CanonicalQuestion_strandId_idx" ON "CanonicalQuestion"("strandId");

-- CreateIndex
CREATE INDEX "CanonicalQuestion_status_idx" ON "CanonicalQuestion"("status");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalQuestion_objectiveId_sequence_key" ON "CanonicalQuestion"("objectiveId", "sequence");

-- CreateIndex
CREATE UNIQUE INDEX "CanonicalQuestion_objectiveId_lhsA_operator_lhsB_rhs_key" ON "CanonicalQuestion"("objectiveId", "lhsA", "operator", "lhsB", "rhs");

-- CreateIndex
CREATE INDEX "AttemptItem_canonicalQuestionId_idx" ON "AttemptItem"("canonicalQuestionId");

-- AddForeignKey
ALTER TABLE "AttemptItem" ADD CONSTRAINT "AttemptItem_canonicalQuestionId_fkey" FOREIGN KEY ("canonicalQuestionId") REFERENCES "CanonicalQuestion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalQuestion" ADD CONSTRAINT "CanonicalQuestion_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalQuestion" ADD CONSTRAINT "CanonicalQuestion_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "CurriculumObjective"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CanonicalQuestion" ADD CONSTRAINT "CanonicalQuestion_strandId_fkey" FOREIGN KEY ("strandId") REFERENCES "CurriculumStrand"("id") ON DELETE SET NULL ON UPDATE CASCADE;
