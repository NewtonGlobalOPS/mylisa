/*
  Warnings:

  - Added the required column `answerText` to the `CanonicalQuestion` table without a default value. This is not possible if the table is not empty.
  - Added the required column `promptText` to the `CanonicalQuestion` table without a default value. This is not possible if the table is not empty.

*/
-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "CanonicalItemType" ADD VALUE 'MISSING_NUMBER';
ALTER TYPE "CanonicalItemType" ADD VALUE 'COMPARISON';
ALTER TYPE "CanonicalItemType" ADD VALUE 'ONE_MORE_ONE_LESS';
ALTER TYPE "CanonicalItemType" ADD VALUE 'NUMBER_SEQUENCE';
ALTER TYPE "CanonicalItemType" ADD VALUE 'NUMBER_LINE';
ALTER TYPE "CanonicalItemType" ADD VALUE 'MEASUREMENT_COMPARE';
ALTER TYPE "CanonicalItemType" ADD VALUE 'FRACTION_OF_QUANTITY';
ALTER TYPE "CanonicalItemType" ADD VALUE 'TURN_DIRECTION';
ALTER TYPE "CanonicalItemType" ADD VALUE 'TIME_MATCH';
ALTER TYPE "CanonicalItemType" ADD VALUE 'DATE_SEQUENCE';
ALTER TYPE "CanonicalItemType" ADD VALUE 'COIN_VALUE';
ALTER TYPE "CanonicalItemType" ADD VALUE 'SHAPE_NAME';

-- DropIndex
DROP INDEX "CanonicalQuestion_objectiveId_lhsA_operator_lhsB_rhs_key";

-- AlterTable
ALTER TABLE "CanonicalQuestion" ADD COLUMN     "answerText" TEXT NOT NULL,
ADD COLUMN     "contentJson" JSONB,
ADD COLUMN     "promptText" TEXT NOT NULL,
ALTER COLUMN "operator" DROP NOT NULL,
ALTER COLUMN "lhsA" DROP NOT NULL,
ALTER COLUMN "lhsB" DROP NOT NULL,
ALTER COLUMN "rhs" DROP NOT NULL,
ALTER COLUMN "equation" DROP NOT NULL;

-- CreateIndex
CREATE INDEX "CanonicalQuestion_itemType_idx" ON "CanonicalQuestion"("itemType");
