import crypto from "node:crypto";
import { Subject } from "@prisma/client";
import { prisma } from "../src/lib/prisma";
import { getProfileForObjective } from "../src/canonical/getProfileForObjective";
import { generateDirectCanonicalQuestions } from "../src/canonical/directGenerators";


function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

async function main() {
  const organisation =
    await prisma.organisation.findFirst({
      orderBy: { createdAt: "asc" },
      select: { id: true },
    });

  if (!organisation) {
    throw new Error("No organisation found. Create/load one first.");
  }

  const objectives = await prisma.curriculumObjective.findMany({
    where: {
      organisationId: organisation.id,
      subject: Subject.MATHS,
      yearGroup: { in: [7, 8, 9, 10, 11] },
      isActive: true,
    },
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
    orderBy: [{ yearGroup: "asc" }, { code: "asc" }],
  });

  console.log(`Found ${objectives.length} Year 7–11 maths objectives.`);

  let created = 0;
  let replaced = 0;
  let skipped = 0;

  for (const objective of objectives) {
    const profile = getProfileForObjective(objective);

    if (!profile?.directGenerator) {
      skipped += 1;
      console.log(`SKIP ${objective.code} | no profile`);
      continue;
    }

    const generated = generateDirectCanonicalQuestions(profile.directGenerator, {
      targetCount: profile.targetCount,
      profileName: profile.name,
    });

    await prisma.$transaction(async (tx) => {
      const existing = await tx.canonicalQuestion.count({
        where: { objectiveId: objective.id },
      });

      if (existing > 0) {
        await tx.canonicalQuestion.deleteMany({
          where: { objectiveId: objective.id },
        });
        replaced += 1;
      } else {
        created += 1;
      }

      for (const item of generated) {
        const contentSha = sha256(
          JSON.stringify({
            objectiveId: objective.id,
            sequence: item.sequence,
            itemType: item.itemType,
            promptText: item.promptText,
            answerText: item.answerText,
            equation: item.equation ?? null,
            difficulty: item.difficulty,
            contentJson: item.contentJson ?? null,
          })
        );

        await tx.canonicalQuestion.create({
          data: {
            organisationId: organisation.id,
            objectiveId: objective.id,
            strandId: objective.strandId ?? null,
            strandLabel: objective.strand ?? null,

            itemType: item.itemType,
            operator: item.operator ?? null,
            lhsA: item.lhsA ?? null,
            lhsB: item.lhsB ?? null,
            rhs: item.rhs ?? null,
            equation: item.equation ?? null,

            promptText: item.promptText,
            answerText: item.answerText,
            contentJson: item.contentJson ?? undefined,

            sequence: item.sequence,
            difficulty: item.difficulty,

            isGenerated: true,
            generatorVersion: item.generatorVersion ?? "canonical-secondary-maths-v1",
            generatorMeta: {
              ...(item.generatorMeta ?? {}),
              objectiveCode: objective.code,
              objectiveYearGroup: objective.yearGroup,
              objectiveTitle: objective.title,
              profileName: profile.name,
              directGenerator: profile.directGenerator,
            },

            status: "ACTIVE",
            contentSha256: contentSha,
          },
        });
      }
    });

    console.log(
      `OK ${objective.code} | Y${objective.yearGroup} | ${objective.title} | generator=${profile.directGenerator} | questions=${generated.length}`
    );
  }

  console.log("");
  console.log(`Created objective sets: ${created}`);
  console.log(`Replaced objective sets: ${replaced}`);
  console.log(`Skipped objectives: ${skipped}`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
