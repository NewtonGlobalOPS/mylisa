import test from "node:test";
import assert from "node:assert/strict";
import { DifficultyBand } from "@prisma/client";

import { reviewAndWrapAssessmentQuestion } from "./assessmentQuestionWrapper.service.js";
import { ensureMultipleChoiceQuestion } from "./assessmentEngine.js";
import type { RuntimeQuestion } from "./assessmentEngine.js";

function makeQuestion(promptText: string, answerText: string): RuntimeQuestion {
  return ensureMultipleChoiceQuestion({
    id: "q1",
    objectiveId: "obj1",
    code: "oak:test",
    title: "Test objective",
    statement: "Test statement",
    yearGroup: 4,
    strand: "NUMBER",
    promptText,
    answerText,
    difficulty: DifficultyBand.EASY,
    answerMode: "numeric",
    calculatorAllowed: false,
    contentJson: null,
  });
}

test("wrapper falls back to canonical prompt when llm config is unavailable", async () => {
  const result = await reviewAndWrapAssessmentQuestion({
    child: {
      age: 8,
      schoolYear: 4,
      keyStage: "KS2",
    },
    question: makeQuestion("Calculate 7 + 5.", "12"),
    canonical: {
      promptText: "Calculate 7 + 5.",
      answerText: "12",
    },
  });

  assert.equal(result.decision, "ask");
  assert.equal(result.displayPromptText, "Calculate 7 + 5.");
  assert.equal(result.source, "fallback");
});

test("wrapper skips canonical questions with missing prompt text", async () => {
  const result = await reviewAndWrapAssessmentQuestion({
    child: {
      age: 8,
      schoolYear: 4,
      keyStage: "KS2",
    },
    question: makeQuestion("", "12"),
    canonical: {
      promptText: "",
      answerText: "12",
    },
  });

  assert.equal(result.decision, "skip");
  assert.match(result.skipReason ?? "", /missing prompt or answer/i);
});
