/*
  Warnings:

  - The `canonicalOperator` column on the `AttemptItem` table would be dropped and recreated. This will lead to data loss if there is data in the column.
  - Made the column `lhsB` on table `CanonicalQuestion` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable
ALTER TABLE "AttemptItem" DROP COLUMN "canonicalOperator",
ADD COLUMN     "canonicalOperator" "CanonicalOperator";

-- AlterTable
ALTER TABLE "CanonicalQuestion" ALTER COLUMN "lhsB" SET NOT NULL;
