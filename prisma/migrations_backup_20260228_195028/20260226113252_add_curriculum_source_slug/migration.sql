/*
  Warnings:

  - A unique constraint covering the columns `[slug]` on the table `CurriculumSource` will be added. If there are existing duplicate values, this will fail.
  - Added the required column `slug` to the `CurriculumSource` table without a default value. This is not possible if the table is not empty.

*/
-- AlterTable
ALTER TABLE "CurriculumSource" ADD COLUMN     "slug" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "CurriculumSource_slug_key" ON "CurriculumSource"("slug");
