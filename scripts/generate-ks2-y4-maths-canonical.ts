import { KeyStage, Subject } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { getProfileForObjective } from "../src/canonical/getProfileForObjective";
import { generateFromProfile } from "../src/canonical/generateFromProfile";
import { replaceCanonicalQuestions } from "../src/canonical/saveCanonicalQuestions";

const GENERATOR_VERSION = "canonical-ks2-y4-maths-v1";

async function main() {
  const organisationSlug = process.argv[2];

  if (!organisationSlug) {
    throw new Error(
      "Usage: npx tsx scripts/generate-ks2-y4-maths-canonical.ts <organisation-slug>"
    );
  }

  const organisation = await prisma.organisation.findUnique({
    where: { slug: organisationSlug },
    select: { id: true, slug: true, name: true },
  });

  if (!organisation) {
    throw new Error(`Organisation not found for slug: ${organisationSlug}`);
  }

  const objectives = await prisma.curriculumObjective.findMany({
    where: {
      organisationId: organisation.id,
      subject: Subject.MATHS,
      keyStage: KeyStage.KS2,
      yearGroup: 4,
      isActive: true,
    },
    orderBy: [{ strand: "asc" }, { code: "asc" }],
    select: {
      id: true,
      code: true,
      subject: true,
      keyStage: true,
      yearGroup: true,
      title: true,
      statement: true,
      keywords: true,
      strandId: true,
      strand: true,
    },
  });

  if (objectives.length === 0) {
    throw new Error("No KS2 Year 4 maths objectives found.");
  }

  let generatedCount = 0;
  let skippedCount = 0;

  for (const objective of objectives) {
    const profile = getProfileForObjective(objective);

    if (!profile) {
      skippedCount += 1;
      console.warn(`Skipping unmapped objective: ${objective.code} | ${objective.title}`);
      continue;
    }

    const questions = generateFromProfile(profile).map((question) => ({
      ...question,
      generatorVersion: GENERATOR_VERSION,
      generatorMeta: {
        ...(question.generatorMeta ?? {}),
        script: "generate-ks2-y4-maths-canonical",
        objectiveCode: objective.code,
        objectiveYearGroup: objective.yearGroup,
      },
    }));

    await replaceCanonicalQuestions(objective.id, questions, {
      organisationId: organisation.id,
      strandId: objective.strandId,
      strandLabel: objective.strand,
      prismaClient: prisma,
    });

    generatedCount += 1;

    console.log(
      `Generated ${questions.length} canonical questions for ${objective.code} | ${objective.title} using profile ${profile.name}`
    );
  }

  console.log(`Done. Generated: ${generatedCount}, Skipped: ${skippedCount}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
