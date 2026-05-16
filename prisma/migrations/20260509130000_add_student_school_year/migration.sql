ALTER TABLE "Student"
ADD COLUMN "schoolYear" INTEGER;

CREATE INDEX "Student_schoolYear_idx" ON "Student"("schoolYear");
