import "dotenv/config";
import { Subject, type CanonicalItemType, type DifficultyBand } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { buildRuntimeQuestion, type AssessmentPoolRow } from "../src/assessment/assessmentEngine.js";

type SmokeFinding = {
  questionId: string;
  objectiveCode: string;
  objectiveTitle: string;
  subject: string;
  yearGroup: number | null;
  itemType: string;
  difficulty: DifficultyBand;
  promptText: string;
  answerText: string;
  answerMode: string;
  issue: string;
  details: string;
  choices: string[];
};

type CanonicalRow = AssessmentPoolRow & {
  difficulty: DifficultyBand;
  objective: {
    code: string;
    subject: Subject;
    yearGroup: number | null;
    title: string;
  };
};

const SHAPE_FAMILY = new Set([
  "triangle",
  "square",
  "rectangle",
  "circle",
  "pentagon",
  "hexagon",
  "octagon",
  "cube",
  "cone",
]);

const DIRECTION_FAMILY = new Set([
  "left",
  "right",
  "clockwise",
  "anticlockwise",
  "half turn",
  "quarter turn",
  "three-quarter turn",
  "full turn",
]);

const COMPARISON_FAMILY = new Set(["<", ">", "=", "!=", "≤", "≥"]);
const LINE_FAMILY = new Set([
  "parallel",
  "perpendicular",
  "horizontal",
  "vertical",
  "diagonal",
]);

function normalize(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function containsPlaceholder(value: string): boolean {
  const text = normalize(value);
  return (
    text.includes("option ") ||
    text.includes("choice ") ||
    text === "a" ||
    text === "b" ||
    text === "c" ||
    text === "d"
  );
}

function isPureNumber(value: string): boolean {
  return /^-?\d+(?:\.\d+)?$/.test(value.trim());
}

function looksLikeTime(value: string): boolean {
  const text = normalize(value);
  return (
    /^\d{1,2}:\d{2}(?:\s?(?:am|pm))?$/.test(text) ||
    text.includes("past") ||
    text.includes("to") ||
    text.includes("o'clock")
  );
}

function collectFindings(question: ReturnType<typeof buildRuntimeQuestion>, row: CanonicalRow): SmokeFinding[] {
  const findings: SmokeFinding[] = [];
  const labels = question.choices.map((choice) => String(choice.label).trim());
  const uniqueLabels = new Set(labels.map((label) => label.toLowerCase()));
  const promptLower = normalize(question.promptText);
  const answerLower = normalize(question.answerText);
  const itemType = String(row.itemType ?? "").toUpperCase() as CanonicalItemType | string;
  const isYesNoPrompt = promptLower.includes("yes or no");
  const isLineVocabulary =
    promptLower.includes("what do we call lines") ||
    promptLower.includes("parallel lines") ||
    promptLower.includes("perpendicular lines") ||
    ["parallel", "perpendicular", "horizontal", "vertical"].includes(answerLower);
  const isNumericTextAnswer = !Number.isNaN(Number(row.answerText.trim())) && row.answerText.trim() !== "";

  const base = {
    questionId: row.id,
    objectiveCode: row.objective.code,
    objectiveTitle: row.objective.title,
    subject: row.objective.subject,
    yearGroup: row.objective.yearGroup,
    itemType,
    difficulty: row.difficulty,
    promptText: row.promptText,
    answerText: row.answerText,
    answerMode: question.answerMode,
    choices: labels,
  };

  if (!row.promptText.trim()) {
    findings.push({
      ...base,
      issue: "BLANK_PROMPT",
      details: "Prompt text is empty.",
    });
  }

  if (!row.answerText.trim()) {
    findings.push({
      ...base,
      issue: "BLANK_ANSWER",
      details: "Answer text is empty.",
    });
  }

  if (question.choices.length !== 4) {
    findings.push({
      ...base,
      issue: "CHOICE_COUNT",
      details: `Expected 4 choices, found ${question.choices.length}.`,
    });
  }

  if (uniqueLabels.size !== 4) {
    findings.push({
      ...base,
      issue: "DUPLICATE_CHOICES",
      details: "Choices are not unique.",
    });
  }

  if (!labels.some((label) => normalize(label) === answerLower)) {
    findings.push({
      ...base,
      issue: "MISSING_CORRECT_ANSWER",
      details: "Generated choices do not include the canonical answer.",
    });
  }

  if (labels.some((label) => containsPlaceholder(label))) {
    findings.push({
      ...base,
      issue: "PLACEHOLDER_CHOICE",
      details: "A choice contains placeholder language.",
    });
  }

  if (
    question.answerMode === "text" &&
    labels.some((label) => isPureNumber(label)) &&
    !isPureNumber(row.answerText)
  ) {
    findings.push({
      ...base,
      issue: "TEXT_NUMERIC_DISTRACTOR",
      details: "Text-style question includes pure numeric distractors.",
    });
  }

  if (
    (itemType === "COMPARISON" || COMPARISON_FAMILY.has(row.answerText.trim())) &&
    !labels.every((label) => COMPARISON_FAMILY.has(label))
  ) {
    findings.push({
      ...base,
      issue: "NON_CONTEXTUAL_COMPARISON_CHOICES",
      details: "Comparison item includes non-comparison choices.",
    });
  }

  if (
    itemType === "SHAPE_NAME" &&
    !isYesNoPrompt &&
    !isLineVocabulary &&
    !isNumericTextAnswer &&
    !labels.every((label) => SHAPE_FAMILY.has(normalize(label)))
  ) {
    findings.push({
      ...base,
      issue: "NON_CONTEXTUAL_SHAPE_CHOICES",
      details: "Shape-name item includes non-shape choices.",
    });
  }

  if (
    itemType === "TURN_DIRECTION" &&
    !isYesNoPrompt &&
    !isNumericTextAnswer &&
    !labels.every((label) => DIRECTION_FAMILY.has(normalize(label)))
  ) {
    findings.push({
      ...base,
      issue: "NON_CONTEXTUAL_DIRECTION_CHOICES",
      details: "Turn-direction item includes non-direction choices.",
    });
  }

  if (
    isLineVocabulary &&
    !labels.every((label) => LINE_FAMILY.has(normalize(label)))
  ) {
    findings.push({
      ...base,
      issue: "NON_CONTEXTUAL_LINE_CHOICES",
      details: "Line-vocabulary item includes non-line choices.",
    });
  }

  if (
    itemType === "TIME_MATCH" &&
    question.answerMode === "text" &&
    !labels.every((label) => looksLikeTime(label))
  ) {
    findings.push({
      ...base,
      issue: "NON_CONTEXTUAL_TIME_CHOICES",
      details: "Time item includes choices that do not look like time answers.",
    });
  }

  if (
    promptLower.includes("yes or no") &&
    !labels.every((label) =>
      ["yes", "no", "both", "neither"].includes(normalize(label))
    )
  ) {
    findings.push({
      ...base,
      issue: "NON_CONTEXTUAL_YES_NO_CHOICES",
      details: "Yes/no item includes unrelated distractors.",
    });
  }

  return findings;
}

async function main() {
  const rows = (await prisma.canonicalQuestion.findMany({
    where: {
      status: "ACTIVE",
      objective: {
        isActive: true,
      },
    },
    select: {
      id: true,
      objectiveId: true,
      itemType: true,
      promptText: true,
      answerText: true,
      difficulty: true,
      contentJson: true,
      objective: {
        select: {
          code: true,
          subject: true,
          yearGroup: true,
          title: true,
        },
      },
    },
    orderBy: [
      { objective: { subject: "asc" } },
      { objective: { yearGroup: "asc" } },
      { objective: { code: "asc" } },
      { sequence: "asc" },
    ],
  })) as unknown as CanonicalRow[];

  const findings = rows.flatMap((row) =>
    collectFindings(buildRuntimeQuestion(row), row)
  );

  const summary = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.issue] = (acc[finding.issue] ?? 0) + 1;
    return acc;
  }, {});

  const bySubject = rows.reduce<Record<string, number>>((acc, row) => {
    acc[row.objective.subject] = (acc[row.objective.subject] ?? 0) + 1;
    return acc;
  }, {});

  console.log(
    JSON.stringify(
      {
        auditedCanonicalQuestions: rows.length,
        bySubject,
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
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
