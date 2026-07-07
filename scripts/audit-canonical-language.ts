import { prisma } from "../src/lib/prisma.js";
import { Subject } from "@prisma/client";

type AuditHit = {
  questionId: string;
  promptText: string;
  yearGroup: number | null;
  objectiveCode: string;
  objectiveTitle: string;
  generatorVersion: string | null;
  issue: string;
  details: string;
};

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
      id: true,
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
    questionId: row.id,
    promptText: row.promptText,
    yearGroup: row.objective.yearGroup,
    objectiveCode: row.objective.code,
    objectiveTitle: row.objective.title,
    generatorVersion: row.generatorVersion ?? null,
    issue: "",
    details: "",
  }));

  const findings = hits.flatMap((hit) => {
    const prompt = hit.promptText.trim();
    const out: AuditHit[] = [];

    if (/\ba (equilateral|isosceles|octagon)\b/i.test(prompt)) {
      out.push({
        ...hit,
        issue: "ARTICLE_MISMATCH",
        details: "Indefinite article should be 'an' before this shape name.",
      });
    }

    if (/(?:=\s*\?\/)|(?:\bcomplete:\b.*\?)/i.test(prompt)) {
      out.push({
        ...hit,
        issue: "PLACEHOLDER_PROMPT",
        details: "Prompt still contains placeholder-style wording.",
      });
    }

    if (
      /a pictogram shows dogs .* cats .* birds/i.test(prompt) ||
      /a bar chart shows red .* blue .* green/i.test(prompt)
    ) {
      out.push({
        ...hit,
        issue: "SYNTHETIC_STORY",
        details: "Prompt uses an overly synthetic repeated story shell.",
      });
    }

    if (
      /(red and .*blue.*counters|blue.*red.*counters)/i.test(prompt) ||
      /card numbered 1 to 10 is picked at random/i.test(prompt) ||
      /spinner has .* sections\. .* are red/i.test(prompt)
    ) {
      out.push({
        ...hit,
        issue: "STALE_PROBABILITY_WORDING",
        details: "Prompt uses a legacy probability wording shell flagged for review.",
      });
    }

    return out;
  });

  const summary = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.issue] = (acc[finding.issue] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    JSON.stringify(
      {
        auditedActiveQuestions: hits.length,
        flaggedFindings: findings.length,
        summary,
        findings,
      },
      null,
      2
    )
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
