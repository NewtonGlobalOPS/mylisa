import { prisma } from "../src/lib/prisma";
import { Subject } from "@prisma/client";

type AuditHit = {
  promptText: string;
  yearGroup: number | null;
  objectiveCode: string;
  objectiveTitle: string;
  generatorVersion: string | null;
};

function isSymbolicComparison(prompt: string): boolean {
  return /\b\d+(?:\/\d+)?\s*\?\s*\d+(?:\/\d+)?\b/i.test(prompt);
}

function isPlaceholderPrompt(prompt: string): boolean {
  return /(?:=\s*\?\/)|(?:\bcomplete:\b.*\?)/i.test(prompt);
}

function isSyntheticChartStory(prompt: string): boolean {
  return (
    /a pictogram shows dogs .* cats .* birds/i.test(prompt) ||
    /a bar chart shows red .* blue .* green/i.test(prompt)
  );
}

function isColourCardProbabilityPrompt(prompt: string): boolean {
  return (
    /(red and .*blue.*counters|blue.*red.*counters)/i.test(prompt) ||
    /card numbered 1 to 10 is picked at random/i.test(prompt) ||
    /spinner has .* sections\. .* are red/i.test(prompt)
  );
}

function printSection(title: string, hits: AuditHit[]) {
  console.log(`\n${title}: ${hits.length}`);
  for (const hit of hits.slice(0, 12)) {
    console.log(
      `- Y${hit.yearGroup ?? "?"} | ${hit.promptText} | ${hit.objectiveCode} | ${hit.objectiveTitle}`
    );
  }
}

async function main() {
  const rows = await prisma.canonicalQuestion.findMany({
    where: {
      status: "ACTIVE",
      objective: {
        subject: Subject.MATHS,
        isActive: true,
      },
    },
    select: {
      promptText: true,
      generatorVersion: true,
      objective: {
        select: {
          yearGroup: true,
          code: true,
          title: true,
        },
      },
    },
    orderBy: [{ objective: { yearGroup: "asc" } }, { promptText: "asc" }],
  });

  const hits: AuditHit[] = rows.map((row) => ({
    promptText: row.promptText,
    yearGroup: row.objective.yearGroup,
    objectiveCode: row.objective.code,
    objectiveTitle: row.objective.title,
    generatorVersion: row.generatorVersion ?? null,
  }));

  const symbolicComparison = hits.filter((hit) => isSymbolicComparison(hit.promptText));
  const placeholderPrompts = hits.filter((hit) => isPlaceholderPrompt(hit.promptText));
  const syntheticChartStories = hits.filter((hit) => isSyntheticChartStory(hit.promptText));
  const colourCardProbabilityPrompts = hits.filter((hit) =>
    isColourCardProbabilityPrompt(hit.promptText)
  );

  console.log(`Audited ${hits.length} active maths canonical questions.`);
  printSection("Symbolic comparison prompts", symbolicComparison);
  printSection("Placeholder prompts", placeholderPrompts);
  printSection("Synthetic repeated chart-story prompts", syntheticChartStories);
  printSection("Colour/card probability prompts", colourCardProbabilityPrompts);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
