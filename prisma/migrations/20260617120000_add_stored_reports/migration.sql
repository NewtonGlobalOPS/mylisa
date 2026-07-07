CREATE TABLE "StoredReport" (
  "id" TEXT NOT NULL,
  "organisationId" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "attemptId" TEXT,
  "subject" "Subject" NOT NULL,
  "title" TEXT NOT NULL,
  "storage" "StorageProvider" NOT NULL DEFAULT 'LOCAL',
  "storageKey" TEXT NOT NULL,
  "filename" TEXT NOT NULL,
  "mimeType" TEXT NOT NULL,
  "sizeBytes" BIGINT NOT NULL,
  "checksumSha256" TEXT,
  "publicToken" TEXT NOT NULL,
  "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "StoredReport_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StoredReport_organisationId_idx" ON "StoredReport"("organisationId");
CREATE INDEX "StoredReport_studentId_subject_generatedAt_idx" ON "StoredReport"("studentId", "subject", "generatedAt");
CREATE INDEX "StoredReport_attemptId_idx" ON "StoredReport"("attemptId");
CREATE UNIQUE INDEX "StoredReport_publicToken_key" ON "StoredReport"("publicToken");

ALTER TABLE "StoredReport" ADD CONSTRAINT "StoredReport_organisationId_fkey" FOREIGN KEY ("organisationId") REFERENCES "Organisation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoredReport" ADD CONSTRAINT "StoredReport_studentId_fkey" FOREIGN KEY ("studentId") REFERENCES "Student"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoredReport" ADD CONSTRAINT "StoredReport_attemptId_fkey" FOREIGN KEY ("attemptId") REFERENCES "Attempt"("id") ON DELETE SET NULL ON UPDATE CASCADE;
