import "dotenv/config";
import { Subject } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";

function repairPrompt(promptText: string): string {
  return promptText
    .replace(/\ba equilateral\b/gi, "an equilateral")
    .replace(/\ba isosceles\b/gi, "an isosceles")
    .replace(/\ba octagon\b/gi, "an octagon");
}

async function main() {
  const rows = await prisma.canonicalQuestion.findMany({
    where: {
      status: "ACTIVE",
      objective: {
        subject: Subject.MATHS,
        isActive: true,
      },
      OR: [
        { promptText: { contains: "a equilateral" } },
        { promptText: { contains: "a isosceles" } },
        { promptText: { contains: "a octagon" } },
      ],
    },
    select: {
      id: true,
      promptText: true,
      objective: {
        select: {
          code: true,
          yearGroup: true,
          title: true,
        },
      },
    },
    orderBy: [{ objective: { yearGroup: "asc" } }, { promptText: "asc" }],
  });

  const updates = rows
    .map((row) => ({
      id: row.id,
      before: row.promptText,
      after: repairPrompt(row.promptText),
      objectiveCode: row.objective.code,
      yearGroup: row.objective.yearGroup,
      title: row.objective.title,
    }))
    .filter((row) => row.before !== row.after);

  for (const row of updates) {
    await prisma.canonicalQuestion.update({
      where: { id: row.id },
      data: { promptText: row.after },
    });
  }

  console.log(
    JSON.stringify(
      {
        updated: updates.length,
        updates,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
