import "dotenv/config";
import { Subject } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { getProfileForObjective } from "../src/canonical/getProfileForObjective.js";

type ObjectiveAudit = {
  objectiveId: string;
  objectiveCode: string;
  yearGroup: number | null;
  title: string;
  strand: string;
  activeQuestionCount: number;
  expectedGenerator: string | null;
  actualGenerators: string[];
  issue: "UNSUPPORTED_ACTIVE" | "GENERATOR_MISMATCH" | "PROMPT_MISMATCH";
  reasons: string[];
  sampleQuestionIds: string[];
  samplePrompts: string[];
};

type ActiveRow = {
  id: string;
  promptText: string;
  answerText: string;
  itemType: string;
  generatorMeta: Record<string, unknown> | null;
  objective: {
    id: string;
    code: string;
    yearGroup: number | null;
    title: string;
    statement: string | null;
    strand: string;
    keywords: string[];
  };
};

function textIncludesAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function textIncludesWholeWord(text: string, terms: string[]): boolean {
  return terms.some((term) => new RegExp(`\\b${term.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`).test(text));
}

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function actualGeneratorFromMeta(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null;
  return typeof meta.directGenerator === "string" ? meta.directGenerator : null;
}

function promptLooksMismatched(row: ActiveRow): string[] {
  const reasons: string[] = [];
  const objectiveText = normalize(
    [
      row.objective.code,
      row.objective.title,
      row.objective.statement,
      row.objective.strand,
      ...row.objective.keywords,
    ].join(" ")
  );
  const prompt = normalize(row.promptText);

  const objectiveIsData =
    textIncludesAny(objectiveText, [
      "graphical representations of data",
      "numerical summaries of data",
      "comparisons of numerical summaries of data",
      "scatter graphs",
      "time series",
      "cumulative frequency",
      "histograms",
      "sampling",
      "statistics",
      "probability",
      "interpret and present data",
      "frequency tables",
      "bar charts",
      "pie charts",
      "pictograms",
    ]) ||
    textIncludesWholeWord(objectiveText, [
      "mean",
      "median",
      "mode",
      "range",
      "probability",
      "statistics",
    ]);
  const promptIsAlgebra = textIncludesAny(prompt, [
    "solve:",
    "expand:",
    "substitute ",
    " x ",
    " x^",
    " y ÷ ",
  ]);
  const promptIsRatioShare = prompt.startsWith("split ") && prompt.includes(" ratio ");
  const promptIsNumberSequence =
    row.itemType === "NUMBER_SEQUENCE" ||
    /(?:^|\s)\[\],|,\s*\[\],|^\d+,\s*\d+,\s*\d+/.test(row.promptText);
  const objectiveIsMoney = textIncludesAny(objectiveText, ["money", "coin", "coins", "pence", "pounds"]);

  if (objectiveIsData && promptIsAlgebra) {
    reasons.push("Data objective has algebra-style prompt.");
  }
  if (objectiveIsData && promptIsRatioShare) {
    reasons.push("Data objective has ratio-share prompt.");
  }
  if (objectiveIsMoney && promptIsNumberSequence) {
    reasons.push("Money objective has number-sequence prompt.");
  }

  return reasons;
}

async function main() {
  const rows = await prisma.canonicalQuestion.findMany({
    where: {
      status: "ACTIVE",
      isGenerated: true,
      objective: {
        subject: Subject.MATHS,
        isActive: true,
      },
    },
    select: {
      id: true,
      promptText: true,
      answerText: true,
      itemType: true,
      generatorMeta: true,
      objective: {
        select: {
          id: true,
          code: true,
          yearGroup: true,
          title: true,
          statement: true,
          strand: true,
          keywords: true,
        },
      },
    },
    orderBy: [{ objective: { yearGroup: "asc" } }, { objective: { code: "asc" } }],
  });

  const grouped = new Map<string, ActiveRow[]>();
  for (const row of rows as ActiveRow[]) {
    const bucket = grouped.get(row.objective.id) ?? [];
    bucket.push(row);
    grouped.set(row.objective.id, bucket);
  }

  const findings: ObjectiveAudit[] = [];

  for (const objectiveRows of grouped.values()) {
    const first = objectiveRows[0];
    if (!first) continue;

    const expectedProfile = getProfileForObjective({
      code: first.objective.code,
      subject: "MATHS",
      yearGroup: first.objective.yearGroup,
      title: first.objective.title,
      statement: first.objective.statement,
      strand: first.objective.strand,
      keywords: first.objective.keywords,
    });
    const expectedGenerator =
      expectedProfile && "directGenerator" in expectedProfile
        ? expectedProfile.directGenerator ?? null
        : null;

    const actualGenerators = Array.from(
      new Set(
        objectiveRows
          .map((row) => actualGeneratorFromMeta(row.generatorMeta))
          .filter((value): value is string => Boolean(value))
      )
    ).sort();

    const mismatchReasons = Array.from(
      new Set(objectiveRows.flatMap((row) => promptLooksMismatched(row)))
    );

    let issue: ObjectiveAudit["issue"] | null = null;
    const reasons: string[] = [];

    if (!expectedGenerator && actualGenerators.length > 0) {
      issue = "UNSUPPORTED_ACTIVE";
      reasons.push("Active generated canonical exists for an objective with no supported profile.");
    } else if (
      actualGenerators.length > 0 &&
      actualGenerators.some((generator) => generator !== expectedGenerator)
    ) {
      issue = "GENERATOR_MISMATCH";
      reasons.push(
        `Expected generator ${expectedGenerator}, found ${actualGenerators.join(", ") || "none"}.`
      );
    }

    if (mismatchReasons.length > 0) {
      issue = issue ?? "PROMPT_MISMATCH";
      reasons.push(...mismatchReasons);
    }

    if (!issue) continue;

    findings.push({
      objectiveId: first.objective.id,
      objectiveCode: first.objective.code,
      yearGroup: first.objective.yearGroup,
      title: first.objective.title,
      strand: first.objective.strand,
      activeQuestionCount: objectiveRows.length,
      expectedGenerator,
      actualGenerators,
      issue,
      reasons,
      sampleQuestionIds: objectiveRows.slice(0, 5).map((row) => row.id),
      samplePrompts: objectiveRows.slice(0, 3).map((row) => row.promptText),
    });
  }

  const summary = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.issue] = (acc[finding.issue] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    JSON.stringify(
      {
        auditedActiveGeneratedQuestions: rows.length,
        flaggedObjectives: findings.length,
        summary,
        findings,
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
