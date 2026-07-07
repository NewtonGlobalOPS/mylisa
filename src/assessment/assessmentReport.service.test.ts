import test from "node:test";
import assert from "node:assert/strict";
import { DifficultyBand } from "@prisma/client";
import {
  buildAssessmentResult,
  buildRuntimeQuestionPool,
  createAssessmentSession,
  submitAnswer,
  type AssessmentPoolRow,
} from "./assessmentEngine.js";
import { buildAssessmentNarrativeReport } from "./assessmentReport.service.js";

function makeRow(
  input: Partial<AssessmentPoolRow> & Pick<AssessmentPoolRow, "id" | "objectiveId">
): AssessmentPoolRow {
  return {
    id: input.id,
    objectiveId: input.objectiveId,
    code: input.code ?? `${input.objectiveId}-code`,
    title: input.title ?? "Test objective",
    statement: input.statement ?? "Test objective statement",
    yearGroup: input.yearGroup ?? 4,
    strand: input.strand ?? "Number",
    promptText: input.promptText ?? `${input.id}?`,
    answerText: input.answerText ?? "1",
    difficulty: input.difficulty ?? DifficultyBand.EASY,
    contentJson: input.contentJson ?? { domain: "number" },
  };
}

test("narrative report replaces insufficient evidence with a substantive display label", async () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "n1",
      objectiveId: "obj-n1",
      strand: "Number",
      promptText: "20 + 20 =",
      answerText: "40",
    }),
    makeRow({
      id: "n2",
      objectiveId: "obj-n2",
      strand: "Number",
      promptText: "90 - 30 =",
      answerText: "60",
      difficulty: DifficultyBand.MEDIUM,
    }),
    makeRow({
      id: "d1",
      objectiveId: "obj-d1",
      strand: "Data",
      promptText: "How many more chose red than blue?",
      answerText: "3",
    }),
    makeRow({
      id: "d2",
      objectiveId: "obj-d2",
      strand: "Data",
      promptText: "Read the chart value for Tuesday.",
      answerText: "8",
      difficulty: DifficultyBand.MEDIUM,
    }),
    makeRow({
      id: "g1",
      objectiveId: "obj-g1",
      strand: "Geometry",
      promptText: "A rectangle has length 5 cm and width 3 cm. What is its perimeter?",
      answerText: "16",
    }),
    makeRow({
      id: "g2",
      objectiveId: "obj-g2",
      strand: "Geometry",
      promptText: "A rectangle has length 7 cm and width 5 cm. What is its perimeter?",
      answerText: "24",
      difficulty: DifficultyBand.MEDIUM,
    }),
    makeRow({
      id: "r1",
      objectiveId: "obj-r1",
      strand: "Ratio",
      promptText: "What number is missing? 3/4 = __/8.",
      answerText: "6",
    }),
    makeRow({
      id: "r2",
      objectiveId: "obj-r2",
      strand: "Ratio",
      promptText: "What number is missing? 2/3 = __/6.",
      answerText: "4",
      difficulty: DifficultyBand.MEDIUM,
    }),
  ]);

  const session = createAssessmentSession({
    childCurrentYear: 5,
    questions: pool,
    maxQuestions: 20,
    extensionMaxQuestions: 20,
  });

  const answers = new Map<string, string>([
    ["n1", "40"],
    ["n2", "60"],
    ["d1", "3"],
    ["d2", "8"],
    ["g1", "__wrong__"],
    ["g2", "__wrong__"],
    ["r1", "6"],
    ["r2", "__wrong__"],
  ]);

  for (const question of pool) {
    submitAnswer(session, {
      questionId: question.id,
      rawAnswer: answers.get(question.id) ?? "__wrong__",
    });
  }

  const result = buildAssessmentResult(session);
  assert.equal(result.overallWorkingBand, "INSUFFICIENT_EVIDENCE");

  const report = await buildAssessmentNarrativeReport({
    studentName: "Aria Casey",
    session,
    result,
    questions: session.responses.map((response) => {
      const question = session.questions.find((entry) => entry.id === response.questionId)!;
      return {
        prompt: question.promptText,
        response: response.rawAnswer,
        correctAnswer: question.answerText,
        isCorrect: response.isCorrect,
        strand: response.strand,
        difficulty: response.difficulty,
        yearGroup: response.yearGroup,
      };
    }),
  });

  assert.notEqual(report.displayBandLabel.toUpperCase(), "INSUFFICIENT_EVIDENCE");
  assert.ok(report.displayBandLabel.includes("Year 4"));
  assert.ok(report.nextSteps.length >= 3);
  assert.ok(report.focusAreas.some((item) => item.toLowerCase().includes("geometry")));
});
