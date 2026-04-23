import { KeyStage, Subject } from "@prisma/client";
import { prisma } from "../src/lib/prisma";

async function main() {
  const organisationSlug = process.argv[2];

  if (!organisationSlug) {
    throw new Error("Usage: npx tsx scripts/delete-generated-ks1-y1-maths-canonical.ts <organisation-slug>");
  }

  const organisation = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
    select: { id: true },
  });

  if (!organisation) {
    throw new Error(`Organisation not found for slug: ${organisationSlug}`);
  }

  const objectives = await prisma.curriculumObjective.findMany({
    where: {
      organisationId: organisation.id,
      subject: Subject.MATHS,
      keyStage: KeyStage.KS1,
      yearGroup: 1,
    },
    select: { id: true },
  });

  const objectiveIds = objectives.map((o) => o.id);

  const result = await prisma.canonicalQuestion.deleteMany({
    where: {
      organisationId: organisation.id,
      objectiveId: { in: objectiveIds },
      isGenerated: true,
    },
  });

  console.log(`Deleted ${result.count} generated canonical questions.`);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});