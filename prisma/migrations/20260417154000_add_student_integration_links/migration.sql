DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_type
    WHERE typname = 'IntegrationSource'
  ) THEN
    CREATE TYPE "IntegrationSource" AS ENUM ('NEWTONCENTRE');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "StudentIntegrationLink" (
  "id" TEXT NOT NULL,
  "studentId" TEXT NOT NULL,
  "source" "IntegrationSource" NOT NULL,
  "externalId" TEXT NOT NULL,
  "externalType" TEXT,
  "parentEmail" TEXT,
  "ndscreenSessionId" TEXT,
  "assessmentSessionId" TEXT,
  "syncedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "StudentIntegrationLink_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "StudentIntegrationLink_source_externalId_key"
  ON "StudentIntegrationLink"("source", "externalId");

CREATE INDEX IF NOT EXISTS "StudentIntegrationLink_studentId_idx"
  ON "StudentIntegrationLink"("studentId");

CREATE INDEX IF NOT EXISTS "StudentIntegrationLink_ndscreenSessionId_idx"
  ON "StudentIntegrationLink"("ndscreenSessionId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'StudentIntegrationLink_studentId_fkey'
  ) THEN
    ALTER TABLE "StudentIntegrationLink"
      ADD CONSTRAINT "StudentIntegrationLink_studentId_fkey"
      FOREIGN KEY ("studentId") REFERENCES "Student"("id")
      ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
