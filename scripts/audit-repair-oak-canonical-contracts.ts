import "dotenv/config";
import crypto from "node:crypto";
import { Prisma, type CanonicalItemType } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";

type RawAnswer = {
  type?: string;
  content?: unknown;
  distractor?: boolean;
  isCorrect?: boolean;
  matchOption?: { content?: unknown };
  correctChoice?: { content?: unknown };
  order?: number;
};

type CanonicalRow = {
  id: string;
  organisationId: string;
  objectiveId: string;
  itemType: CanonicalItemType;
  promptText: string;
  answerText: string;
  contentJson: Prisma.JsonValue | null;
  generatorMeta: Prisma.JsonValue | null;
  objective: {
    subject: string;
  };
};

type AnswerOption = {
  label: string;
  isCorrect: boolean;
  image?: {
    url: string;
    width?: number;
    height?: number;
    alt: string;
  };
};

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function optionLetter(index: number) {
  return String.fromCharCode(65 + index);
}

function cleanOakPromptText(value: string) {
  return value
    .replace(/\{\{\s*\}\}/g, "____")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function formatOakText(value: string) {
  return cleanOakPromptText(value)
    .replace(/\$\$/g, "")
    .replace(/\\text\{([^{}]+)\}/g, "$1")
    .replace(/\\(?:dfrac|frac)\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2")
    .replace(/(\d+)\{([^{}]+)\s*\\?over\s*\{([^{}]+)\}\}/g, "$1 $2/$3")
    .replace(/\{([^{}]+)\}\s*\\?over\s*\{([^{}]+)\}/g, "$1/$2")
    .replace(/(\d+)\{(\d+\/\d+)\}/g, "$1 $2")
    .replace(/\\times/g, "x")
    .replace(/\\div/g, "/")
    .replace(/\\le/g, "<=")
    .replace(/\\ge/g, ">=")
    .replace(/\\not=/g, "!=")
    .replace(/\s+/g, " ")
    .trim();
}

function labelFromContent(value: unknown, index: number) {
  if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    const url = String(raw.url ?? "").trim();
    if (url) {
      return formatOakText(String(raw.text ?? raw.label ?? "").trim()) || `Option ${optionLetter(index)}`;
    }
    return formatOakText(String(raw.text ?? raw.label ?? raw.alt ?? JSON.stringify(value)).trim());
  }

  return formatOakText(String(value ?? "").trim());
}

function imageFromContent(value: unknown): AnswerOption["image"] | undefined {
  if (!value || typeof value !== "object") return undefined;
  const raw = value as Record<string, unknown>;
  const url = String(raw.url ?? "").trim();
  if (!url) return undefined;
  const width = Number(raw.width);
  const height = Number(raw.height);
  const alt = String(raw.alt ?? raw.text ?? raw.label ?? "").trim();
  return {
    url,
    ...(Number.isFinite(width) ? { width } : {}),
    ...(Number.isFinite(height) ? { height } : {}),
    alt: alt || "Answer option image",
  };
}

function answerContractForItemType(itemType: CanonicalItemType) {
  if (itemType === "OAK_MULTIPLE_CHOICE") return "single_choice";
  if (itemType === "OAK_MULTI_BLANK_CHOICE") return "multi_blank_choice";
  if (itemType === "OAK_SHORT_ANSWER") return "short_answer_alias";
  if (itemType === "OAK_MATCH") return "match_pairs";
  if (itemType === "OAK_ORDER") return "ordered_sequence";
  return "unknown";
}

function buildCanonicalTruth(input: {
  itemType: CanonicalItemType;
  originalQuestion: string;
  correctAnswers: string[];
  distractors: string[];
  optionBank: string[];
  matchPairs?: Array<{ left: string; right: string }>;
  orderedAnswers?: string[];
}) {
  const contract = answerContractForItemType(input.itemType);
  return {
    answerContract: contract,
    nonFungible: true,
    originalQuestion: input.originalQuestion,
    immutableAnswers: input.correctAnswers,
    immutableDistractors: input.distractors,
    optionBank: input.optionBank,
    requiredAnswerCount: input.correctAnswers.length,
    answerSetSha256: sha256(JSON.stringify(input.correctAnswers)),
    ...(contract === "multi_blank_choice"
      ? {
          slots: input.correctAnswers.map((answer, index) => ({
            slotIndex: index + 1,
            correctAnswer: answer,
            choices: input.optionBank,
          })),
        }
      : {}),
    ...(input.matchPairs ? { matchPairs: input.matchPairs } : {}),
    ...(input.orderedAnswers ? { orderedAnswers: input.orderedAnswers } : {}),
  };
}

function buildRubric(input: {
  contract: string;
  correctAnswers: string[];
  distractors: string[];
}): Prisma.InputJsonObject {
  return {
    scoringPolicy:
      input.contract === "multi_blank_choice"
        ? "all_immutable_answers_required_no_distractors"
        : "canonical_answer_contract",
    fullCredit:
      input.contract === "multi_blank_choice"
        ? "Learner selects every immutable answer and no distractor."
        : "Learner response satisfies the immutable answer contract.",
    partialCredit:
      input.contract === "multi_blank_choice"
        ? "Award diagnostic partial evidence for each correct immutable answer selected without accepting the attempt as mastered."
        : "Partial-credit policy is renderer-specific and must not mutate the canonical answer.",
    misconceptionSignals: input.distractors.map((distractor) => ({
      distractor,
      signal:
        "Selected distractor indicates the learner may be overgeneralising or classifying from a non-target feature.",
    })),
  };
}

function buildRenderPolicy(input: {
  contract: string;
  correctAnswers: string[];
}): Prisma.InputJsonObject {
  return {
    canRecontextualise: true,
    immutableFields: [
      "canonicalTruth.answerContract",
      "canonicalTruth.immutableAnswers",
      "canonicalTruth.immutableDistractors",
      "canonicalTruth.optionBank",
    ],
    preserveAnswerSet: true,
    preserveRequiredAnswerCount: true,
    ...(input.contract === "multi_blank_choice"
      ? { maxBlanks: input.correctAnswers.length }
      : {}),
    neurodiverseSupports: [
      "clear visual grouping",
      "predictable answer format",
      "low working-memory burden",
      "no trick wording",
      "allow concrete or interest-based reframing without changing the answer set",
    ],
    forbiddenTransforms: [
      "change correct answers",
      "change distractor truth values",
      "increase reading demand unnecessarily",
      "introduce extra domain vocabulary not present in the lesson truth layer",
    ],
  };
}

function buildVectorText(input: {
  originalQuestion: string;
  lessonTitle: string;
  unitTitle: string;
  correctAnswers: string[];
  distractors: string[];
}) {
  return [
    `Question source: ${input.originalQuestion}`,
    `Lesson: ${input.lessonTitle}`,
    `Unit: ${input.unitTitle}`,
    `Immutable correct answer set: ${input.correctAnswers.join(", ")}`,
    input.distractors.length
      ? `Distractor set: ${input.distractors.join(", ")}`
      : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function contentHash(row: {
  id: string;
  organisationId: string;
  objectiveId: string;
  itemType: string;
  promptText: string;
  answerText: string;
  contentJson: unknown;
}) {
  return sha256(
    JSON.stringify({
      id: row.id,
      organisationId: row.organisationId,
      objectiveId: row.objectiveId,
      itemType: row.itemType,
      promptText: row.promptText,
      answerText: row.answerText,
      contentJson: row.contentJson,
    }),
  );
}

function isObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (isObject(value)) {
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

function rawAnswersFrom(contentJson: Prisma.JsonValue | null): RawAnswer[] {
  if (!isObject(contentJson)) return [];
  const oak = contentJson.oak;
  if (!isObject(oak) || !Array.isArray(oak.rawAnswers)) return [];
  return oak.rawAnswers as RawAnswer[];
}

function oakMeta(contentJson: Prisma.JsonValue | null) {
  if (!isObject(contentJson) || !isObject(contentJson.oak)) {
    return { lessonTitle: "", unitTitle: "" };
  }

  return {
    lessonTitle: String(contentJson.oak.lessonTitle ?? ""),
    unitTitle: String(contentJson.oak.unitTitle ?? ""),
  };
}

function repairRow(row: CanonicalRow) {
  const rawAnswers = rawAnswersFrom(row.contentJson);
  if (!rawAnswers.length) return null;
  const promptText = row.objective.subject === "MATHS"
    ? formatOakText(row.promptText)
    : cleanOakPromptText(row.promptText);

  let itemType = row.itemType;
  let answerText = row.answerText;
  let correctAnswers: string[] = [];
  let distractors: string[] = [];
  let optionBank: string[] = [];
  let choices: AnswerOption[] | undefined;
  let matchPairs: Array<{ left: string; right: string }> | undefined;
  let orderedAnswers: string[] | undefined;

  if (row.itemType === "OAK_MULTIPLE_CHOICE" || row.itemType === "OAK_MULTI_BLANK_CHOICE") {
    choices = rawAnswers
      .map((answer, index) => {
        const label = labelFromContent(answer.content, index);
        if (!label) return null;
        return {
          label,
          isCorrect: answer.distractor === false || answer.isCorrect === true,
          ...(imageFromContent(answer.content) ? { image: imageFromContent(answer.content) } : {}),
        };
      })
      .filter((choice): choice is AnswerOption => choice !== null);

    correctAnswers = choices.filter((choice) => choice.isCorrect).map((choice) => choice.label);
    distractors = choices.filter((choice) => !choice.isCorrect).map((choice) => choice.label);
    optionBank = choices.map((choice) => choice.label);
    itemType = correctAnswers.length > 1 ? "OAK_MULTI_BLANK_CHOICE" : "OAK_MULTIPLE_CHOICE";
    answerText = itemType === "OAK_MULTI_BLANK_CHOICE"
      ? correctAnswers.join(" | ")
      : correctAnswers[0] ?? "";
  } else if (row.itemType === "OAK_SHORT_ANSWER") {
    correctAnswers = rawAnswers.map((answer, index) => labelFromContent(answer.content, index)).filter(Boolean);
    optionBank = correctAnswers;
    answerText = correctAnswers.join(" / ");
  } else if (row.itemType === "OAK_MATCH") {
    matchPairs = rawAnswers
      .map((answer, index) => {
        const left = labelFromContent(answer.matchOption?.content, index);
        const right = labelFromContent(answer.correctChoice?.content, index);
        return left && right ? { left, right } : null;
      })
      .filter((pair): pair is { left: string; right: string } => pair !== null);
    correctAnswers = matchPairs.map((pair) => `${pair.left} -> ${pair.right}`);
    optionBank = matchPairs.flatMap((pair) => [pair.left, pair.right]);
    answerText = correctAnswers.join("; ");
  } else if (row.itemType === "OAK_ORDER") {
    orderedAnswers = rawAnswers
      .filter((answer) => typeof answer.order === "number")
      .sort((a, b) => Number(a.order) - Number(b.order))
      .map((answer, index) => labelFromContent(answer.content, index))
      .filter(Boolean);
    correctAnswers = orderedAnswers;
    optionBank = rawAnswers.map((answer, index) => labelFromContent(answer.content, index)).filter(Boolean);
    answerText = orderedAnswers.join(" -> ");
  } else {
    return null;
  }

  if (!answerText || !correctAnswers.length) return null;

  const contentJson = isObject(row.contentJson) ? { ...row.contentJson } : {};
  const oak = isObject(contentJson.oak) ? { ...contentJson.oak } : {};
  const contract = answerContractForItemType(itemType);
  const meta = oakMeta(row.contentJson);
  const canonicalTruth = buildCanonicalTruth({
    itemType,
    originalQuestion: promptText,
    correctAnswers,
    distractors,
    optionBank,
    matchPairs,
    orderedAnswers,
  });

  const nextContentJson = {
    ...contentJson,
    answerContract: contract,
    canonicalTruth,
    rubric: buildRubric({ contract, correctAnswers, distractors }),
    renderPolicy: buildRenderPolicy({ contract, correctAnswers }),
    vectorText: buildVectorText({
      originalQuestion: promptText,
      lessonTitle: meta.lessonTitle,
      unitTitle: meta.unitTitle,
      correctAnswers,
      distractors,
    }),
    oak: {
      ...oak,
      derivedQuestionType: contract,
      ...(choices ? { choices } : {}),
    },
  } satisfies Prisma.InputJsonObject;

  return {
    itemType,
    promptText,
    answerText,
    contentJson: nextContentJson,
    contentSha256: contentHash({
      id: row.id,
      organisationId: row.organisationId,
      objectiveId: row.objectiveId,
      itemType,
      promptText,
      answerText,
      contentJson: nextContentJson,
    }),
  };
}

function needsRepair(row: CanonicalRow, repaired: ReturnType<typeof repairRow>) {
  if (!repaired) return false;
  const currentContent = isObject(row.contentJson) ? row.contentJson : {};
  const currentOak = isObject(currentContent.oak) ? currentContent.oak : {};
  const repairedContent = repaired.contentJson;
  const repairedOak = isObject(repairedContent.oak) ? repairedContent.oak : {};

  const before = stableJson({
    itemType: row.itemType,
    promptText: row.promptText,
    answerText: row.answerText,
    answerContract: currentContent.answerContract,
    canonicalTruth: currentContent.canonicalTruth,
    rubric: currentContent.rubric,
    renderPolicy: currentContent.renderPolicy,
    vectorText: currentContent.vectorText,
    oakChoices: currentOak.choices,
    oakDerivedQuestionType: currentOak.derivedQuestionType,
  });
  const after = stableJson({
    itemType: repaired.itemType,
    promptText: repaired.promptText,
    answerText: repaired.answerText,
    answerContract: repairedContent.answerContract,
    canonicalTruth: repairedContent.canonicalTruth,
    rubric: repairedContent.rubric,
    renderPolicy: repairedContent.renderPolicy,
    vectorText: repairedContent.vectorText,
    oakChoices: repairedOak.choices,
    oakDerivedQuestionType: repairedOak.derivedQuestionType,
  });
  return before !== after;
}

async function main() {
  const apply = process.argv.includes("--apply");
  const rows = (await prisma.canonicalQuestion.findMany({
    where: {
      itemType: {
        in: [
          "OAK_MULTIPLE_CHOICE",
          "OAK_MULTI_BLANK_CHOICE",
          "OAK_SHORT_ANSWER",
          "OAK_MATCH",
          "OAK_ORDER",
        ],
      },
    },
    select: {
      id: true,
      organisationId: true,
      objectiveId: true,
      itemType: true,
      promptText: true,
      answerText: true,
      contentJson: true,
      generatorMeta: true,
      objective: { select: { subject: true } },
    },
    orderBy: [{ objectiveId: "asc" }, { sequence: "asc" }],
  })) as CanonicalRow[];

  const repairs = rows
    .map((row) => ({ row, repaired: repairRow(row) }))
    .filter((item) => needsRepair(item.row, item.repaired));

  const summary = repairs.reduce<Record<string, number>>((acc, item) => {
    const key = `${item.row.itemType}->${item.repaired!.itemType}`;
    acc[key] = (acc[key] ?? 0) + 1;
    return acc;
  }, {});

  if (apply) {
    for (const item of repairs) {
      await prisma.canonicalQuestion.update({
        where: { id: item.row.id },
        data: {
          itemType: item.repaired!.itemType,
          promptText: item.repaired!.promptText,
          answerText: item.repaired!.answerText,
          contentJson: item.repaired!.contentJson,
          contentSha256: item.repaired!.contentSha256,
          generatorMeta: {
            ...(isObject(item.row.generatorMeta) ? item.row.generatorMeta : {}),
            oakContractRepair: {
              repairedBy: "audit-repair-oak-canonical-contracts",
              repairedAt: new Date().toISOString(),
            },
          },
        },
      });
    }
  }

  console.log(
    JSON.stringify(
      {
        apply,
        audited: rows.length,
        plannedRepairs: repairs.length,
        summary,
        sample: repairs.slice(0, 20).map((item) => ({
          id: item.row.id,
          itemTypeBefore: item.row.itemType,
          itemTypeAfter: item.repaired!.itemType,
          promptText: item.row.promptText,
          promptAfter: item.repaired!.promptText,
          answerBefore: item.row.answerText,
          answerAfter: item.repaired!.answerText,
        })),
      },
      null,
      2,
    ),
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
