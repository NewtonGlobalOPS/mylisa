-- CreateEnum
CREATE TYPE "ScienceDomain" AS ENUM ('BIOLOGY', 'CHEMISTRY', 'PHYSICS', 'GENERAL_SCIENCE');

-- AlterTable
ALTER TABLE "ContentChunk" ADD COLUMN     "scienceDomain" "ScienceDomain",
ADD COLUMN     "scienceDomainConfidence" DOUBLE PRECISION,
ADD COLUMN     "scienceDomainModel" TEXT,
ADD COLUMN     "scienceDomainTaggedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "ContentChunk_scienceDomain_idx" ON "ContentChunk"("scienceDomain");

-- CreateIndex
CREATE INDEX "ContentChunk_scienceDomainConfidence_idx" ON "ContentChunk"("scienceDomainConfidence");
