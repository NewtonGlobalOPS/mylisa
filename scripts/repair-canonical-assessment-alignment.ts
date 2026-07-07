import "dotenv/config";
import crypto from "node:crypto";
import { Subject } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { getProfileForObjective } from "../src/canonical/getProfileForObjective.js";
import { generateDirectCanonicalQuestions } from "../src/canonical/directGenerators.js";

type ActiveObjectiveRow = {
  id: string;
  organisationId: string;
  status: "ACTIVE" | "RETIRED" | "DRAFT";
  sequence: number;
  generatorMeta: Record<string, unknown> | null;
  objective: {
    id: string;
    code: string;
    yearGroup: number | null;
    title: string;
    statement: string | null;
    strand: string;
    strandId: string | null;
    keywords: string[];
  };
};

function sha256(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function actualGeneratorFromMeta(meta: Record<string, unknown> | null): string | null {
  if (!meta) return null;
  return typeof meta.directGenerator === "string" ? meta.directGenerator : null;
}

const KNOWN_BAD_MONEY_OBJECTIVE_CODE =
  "oak:maths:ks1:unitising-and-coin-recognition-solving-problems-involving-money:42142d29a383d33a0d896b08e122a9291d5d6819";
const KS1_MONEY_SCOPE_CODES = new Set([
  "oak:maths:ks1:unitising-and-coin-recognition-solving-problems-involving-money:490635989035e0cfa0e901929677334ce9c62e73",
  "oak:maths:ks1:unitising-and-coin-recognitions-counting-in-2s-5s-and-10s:42142d29a383d33a0d896b08e122a9291d5d6819",
  "oak:maths:ks1:unitising-and-coin-recognition-value-of-a-set-of-coins:42142d29a383d33a0d896b08e122a9291d5d6819",
]);
const ORANGE_SCOPE_CODES = new Set([
  "oak:maths:ks3:geometrical-properties-polygons:e23f6b0249fd85bb211822d53c026091fc03e24d",
  "oak:maths:ks3:sequences:032d60bb5f2e31b63e5745f31838a9fb526e7106",
  "oak:maths:ks3:expressions-and-equations:10564bd0f94bb64de5f9f59be425433a47cea65e",
]);

function normalize(value: string | null | undefined): string {
  return (value ?? "").toLowerCase();
}

function isInRepairScope(input: {
  objectiveCode: string;
  yearGroup: number | null;
  title: string;
  strand: string;
  currentGenerators: string[];
}): boolean {
  if (input.objectiveCode === KNOWN_BAD_MONEY_OBJECTIVE_CODE) {
    return true;
  }

  if (KS1_MONEY_SCOPE_CODES.has(input.objectiveCode)) {
    return true;
  }

  if (ORANGE_SCOPE_CODES.has(input.objectiveCode)) {
    return true;
  }

  if ((input.yearGroup ?? 0) >= 7) {
    return true;
  }

  const text = normalize([input.objectiveCode, input.title, input.strand].join(" "));
  const isDataFamily =
    text.includes("graphical representations of data") ||
    text.includes("numerical summaries of data") ||
    text.includes("comparisons of numerical summaries of data") ||
    text.includes("scatter graphs") ||
    text.includes("time series") ||
    text.includes("sampling");

  return (
    (input.yearGroup ?? 0) >= 7 &&
    isDataFamily &&
    input.currentGenerators.some((generator) =>
      ["SOLVE_LINEAR_ONE_STEP", "RATIO_SHARE"].includes(generator)
    )
  );
}

async function main() {
  const apply = process.argv.includes("--apply");

  const objectives = await prisma.curriculumObjective.findMany({
    where: {
      subject: Subject.MATHS,
      isActive: true,
    },
    select: {
      id: true,
      organisationId: true,
      code: true,
      yearGroup: true,
      title: true,
      statement: true,
      strand: true,
      strandId: true,
      keywords: true,
    },
    orderBy: [{ yearGroup: "asc" }, { code: "asc" }],
  });

  const rows = (await prisma.canonicalQuestion.findMany({
    where: {
      isGenerated: true,
      objective: {
        subject: Subject.MATHS,
        isActive: true,
      },
    },
    select: {
      id: true,
      organisationId: true,
      status: true,
      sequence: true,
      generatorMeta: true,
      objective: {
        select: {
          id: true,
          code: true,
          yearGroup: true,
          title: true,
          statement: true,
          strand: true,
          strandId: true,
          keywords: true,
        },
      },
    },
  })) as ActiveObjectiveRow[];

  const byObjective = new Map<string, ActiveObjectiveRow[]>();
  for (const row of rows) {
    const bucket = byObjective.get(row.objective.id) ?? [];
    bucket.push(row);
    byObjective.set(row.objective.id, bucket);
  }

  const plan: Array<{
    objectiveId: string;
    objectiveCode: string;
    yearGroup: number | null;
    action: "retire" | "regenerate";
    reason: string;
    currentGenerators: string[];
    expectedGenerator: string | null;
    activeQuestionIds: string[];
  }> = [];

  for (const objective of objectives) {
    const objectiveRows = byObjective.get(objective.id) ?? [];
    const first = objectiveRows[0] ?? {
      id: "",
      organisationId: objective.organisationId,
      status: "ACTIVE" as const,
      sequence: 0,
      generatorMeta: null,
      objective,
    };

    const expectedProfile = getProfileForObjective({
      code: objective.code,
      subject: "MATHS",
      yearGroup: objective.yearGroup,
      title: objective.title,
      statement: objective.statement,
      strand: objective.strand,
      keywords: objective.keywords,
    });
    const expectedGenerator =
      expectedProfile && "directGenerator" in expectedProfile
        ? expectedProfile.directGenerator ?? null
        : null;
    const activeRows = objectiveRows.filter((row) => row.status === "ACTIVE");
    const currentGenerators = Array.from(
      new Set(
        activeRows
          .map((row) => actualGeneratorFromMeta(row.generatorMeta))
          .filter((value): value is string => Boolean(value))
      )
    ).sort();

    if (
      !isInRepairScope({
        objectiveCode: objective.code,
        yearGroup: objective.yearGroup,
        title: objective.title,
        strand: objective.strand,
        currentGenerators,
      })
    ) {
      continue;
    }

    if (!expectedGenerator && activeRows.length > 0 && currentGenerators.length > 0) {
      plan.push({
        objectiveId: objective.id,
        objectiveCode: objective.code,
        yearGroup: objective.yearGroup,
        action: "retire",
        reason: "No supported canonical profile exists for this objective anymore.",
        currentGenerators,
        expectedGenerator,
        activeQuestionIds: activeRows.map((row) => row.id),
      });
      continue;
    }

    if (
      currentGenerators.length > 0 &&
      currentGenerators.some((generator) => generator !== expectedGenerator)
    ) {
      plan.push({
        objectiveId: objective.id,
        objectiveCode: objective.code,
        yearGroup: objective.yearGroup,
        action: "regenerate",
        reason: `Expected ${expectedGenerator} but found ${currentGenerators.join(", ") || "none"}.`,
        currentGenerators,
        expectedGenerator,
        activeQuestionIds: activeRows.map((row) => row.id),
      });
      continue;
    }

    if (expectedGenerator && activeRows.length === 0) {
      plan.push({
        objectiveId: objective.id,
        objectiveCode: objective.code,
        yearGroup: objective.yearGroup,
        action: "regenerate",
        reason: `No active canonical questions remain; regenerate ${expectedGenerator}.`,
        currentGenerators,
        expectedGenerator,
        activeQuestionIds: [],
      });
    }
  }

  if (!apply) {
    console.log(
      JSON.stringify(
        {
          apply: false,
          plannedObjectives: plan.length,
          retireObjectives: plan.filter((item) => item.action === "retire").length,
          regenerateObjectives: plan.filter((item) => item.action === "regenerate").length,
          plan,
        },
        null,
        2
      )
    );
    return;
  }

  const result = {
    retiredObjectives: 0,
    regeneratedObjectives: 0,
    retiredQuestions: 0,
    createdQuestions: 0,
    details: [] as Array<Record<string, unknown>>,
  };

  for (const item of plan) {
    const objectiveRows = rows.filter((row) => row.objective.id === item.objectiveId);
    const objectiveFromCatalog = objectives.find((objective) => objective.id === item.objectiveId);
    const objective =
      objectiveRows[0]?.objective ??
      (objectiveFromCatalog
        ? {
            id: objectiveFromCatalog.id,
            code: objectiveFromCatalog.code,
            yearGroup: objectiveFromCatalog.yearGroup,
            title: objectiveFromCatalog.title,
            statement: objectiveFromCatalog.statement,
            strand: objectiveFromCatalog.strand,
            strandId: objectiveFromCatalog.strandId,
            keywords: objectiveFromCatalog.keywords,
          }
        : null);
    if (!objective) continue;

    if (item.action === "retire") {
      const retired = await prisma.canonicalQuestion.updateMany({
        where: { id: { in: item.activeQuestionIds } },
        data: { status: "RETIRED" },
      });
      result.retiredObjectives += 1;
      result.retiredQuestions += retired.count;
      result.details.push({
        objectiveCode: item.objectiveCode,
        action: item.action,
        retiredQuestions: retired.count,
      });
      continue;
    }

    const profile = getProfileForObjective({
      code: objective.code,
      subject: "MATHS",
      yearGroup: objective.yearGroup,
      title: objective.title,
      statement: objective.statement,
      strand: objective.strand,
      keywords: objective.keywords,
    });

    if (!profile || !("directGenerator" in profile) || !profile.directGenerator) {
      throw new Error(`Expected direct profile for ${objective.code} during regeneration.`);
    }

    const generated = generateDirectCanonicalQuestions(profile.directGenerator, {
      targetCount: profile.targetCount,
      profileName: profile.name,
    });

    const retired = await prisma.canonicalQuestion.updateMany({
      where: { id: { in: item.activeQuestionIds } },
      data: { status: "RETIRED" },
    });

    const nextSequenceBase =
      objectiveRows.reduce((max, row) => Math.max(max, row.sequence), 0) + 1;

    for (const [index, question] of generated.entries()) {
      await prisma.canonicalQuestion.create({
        data: {
          organisationId:
            objectiveRows[0]?.organisationId ?? objectiveFromCatalog?.organisationId ?? "",
          objectiveId: objective.id,
          strandId: objective.strandId ?? null,
          strandLabel: objective.strand ?? null,
          itemType: question.itemType,
          operator: question.operator ?? null,
          lhsA: question.lhsA ?? null,
          lhsB: question.lhsB ?? null,
          rhs: question.rhs ?? null,
          equation: question.equation ?? null,
          promptText: question.promptText,
          answerText: question.answerText,
          contentJson: question.contentJson ?? undefined,
          sequence: nextSequenceBase + index,
          difficulty: question.difficulty,
          isGenerated: true,
          generatorVersion: question.generatorVersion ?? "canonical-repair-v1",
          generatorMeta: {
            ...(question.generatorMeta ?? {}),
            objectiveCode: objective.code,
            objectiveYearGroup: objective.yearGroup,
            objectiveTitle: objective.title,
            profileName: profile.name,
            directGenerator: profile.directGenerator,
            repairedAt: new Date().toISOString(),
          },
          status: "ACTIVE",
          contentSha256: sha256(
            JSON.stringify({
              objectiveId: objective.id,
              sequence: nextSequenceBase + index,
              itemType: question.itemType,
              promptText: question.promptText,
              answerText: question.answerText,
              equation: question.equation ?? null,
              difficulty: question.difficulty,
              contentJson: question.contentJson ?? null,
              repairGenerator: profile.directGenerator,
            })
          ),
        },
      });
    }

    result.regeneratedObjectives += 1;
    result.retiredQuestions += retired.count;
    result.createdQuestions += generated.length;
    result.details.push({
      objectiveCode: item.objectiveCode,
      action: item.action,
      retiredQuestions: retired.count,
      createdQuestions: generated.length,
      generator: profile.directGenerator,
    });
  }

  console.log(JSON.stringify(result, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
