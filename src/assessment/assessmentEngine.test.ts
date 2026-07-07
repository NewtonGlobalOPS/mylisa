import test from "node:test";
import assert from "node:assert/strict";
import { DifficultyBand } from "@prisma/client";
import {
  buildRuntimeQuestion,
  buildRuntimeQuestionPool,
  buildAssessmentResult,
  createAssessmentSession,
  getNextQuestion,
  submitAnswer,
  type AssessmentPoolRow,
} from "./assessmentEngine.js";

function withDeterministicRandom<T>(fn: () => T): T {
  const originalRandom = Math.random;
  Math.random = () => 0;

  try {
    return fn();
  } finally {
    Math.random = originalRandom;
  }
}

function makeRow(input: Partial<AssessmentPoolRow> & Pick<AssessmentPoolRow, "id" | "objectiveId">): AssessmentPoolRow {
  return {
    id: input.id,
    objectiveId: input.objectiveId,
    code: input.code ?? `${input.objectiveId}-code`,
    title: input.title ?? "Test objective",
    statement: input.statement ?? "Test objective statement",
    yearGroup: input.yearGroup ?? 3,
    strand: input.strand ?? "Number",
    promptText: input.promptText ?? `${input.id}?`,
    answerText: input.answerText ?? "1",
    difficulty: input.difficulty ?? DifficultyBand.EASY,
    contentJson: input.contentJson ?? { domain: "number" },
  };
}

test("runtime question construction requires canonical year metadata", () => {
  assert.throws(
    () =>
      buildRuntimeQuestion({
        ...makeRow({
          id: "missing-year",
          objectiveId: "obj-missing-year",
          strand: "Number",
        }),
        yearGroup: null,
      }),
    /valid year group/i
  );
});

test("runtime question uses supplied canonical strand before inferred geometry", () => {
  const question = buildRuntimeQuestion(
    makeRow({
      id: "canonical-strand",
      objectiveId: "obj-canonical-strand",
      yearGroup: 5,
      strand: "Number",
      title: "Geometry-looking title about angles",
      statement: "Use multiplication facts in a shape context.",
      promptText: "A rectangle array has 4 rows of 6. How many counters are there?",
      answerText: "24",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "geometry" },
    })
  );

  assert.equal(question.yearGroup, 5);
  assert.equal(question.strand, "NUMBER");
});

test("initial queue samples across different strands before repeating", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "n-e",
      objectiveId: "obj-n-e",
      yearGroup: 3,
      strand: "Number",
      promptText: "1 + 1 =",
      answerText: "2",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "addition" },
    }),
    makeRow({
      id: "g-e",
      objectiveId: "obj-g-e",
      yearGroup: 3,
      strand: "Geometry",
      promptText: "How many sides on a triangle?",
      answerText: "3",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "geometry" },
    }),
    makeRow({
      id: "d-e",
      objectiveId: "obj-d-e",
      yearGroup: 3,
      strand: "Data",
      promptText: "Read the chart value.",
      answerText: "4",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "data" },
    }),
  ]);

  const strandsSeen = withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 4,
      questions: pool,
      maxQuestions: 10,
      extensionMaxQuestions: 10,
    });

    const seen: string[] = [];

    for (let i = 0; i < 3; i += 1) {
      const next = getNextQuestion(session);
      assert.ok(next);
      seen.push(next.strand);
      submitAnswer(session, {
        questionId: next.id,
        rawAnswer: next.answerText,
      });
    }

    return seen;
  });

  assert.equal(new Set(strandsSeen).size, 3);
});

test("strand target year drops below entry when entry-year evidence is weak", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "y1-e",
      objectiveId: "obj-y1-e",
      yearGroup: 1,
      strand: "Number",
      promptText: "1 + 0 =",
      answerText: "1",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "addition_y1" },
    }),
    makeRow({
      id: "y1-m",
      objectiveId: "obj-y1-m",
      yearGroup: 1,
      strand: "Number",
      promptText: "2 + 1 =",
      answerText: "3",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "addition_y1" },
    }),
    makeRow({
      id: "y2-e",
      objectiveId: "obj-y2-e",
      yearGroup: 2,
      strand: "Number",
      promptText: "10 + 2 =",
      answerText: "12",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "addition_y2" },
    }),
    makeRow({
      id: "y2-m",
      objectiveId: "obj-y2-m",
      yearGroup: 2,
      strand: "Number",
      promptText: "14 + 3 =",
      answerText: "17",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "addition_y2" },
    }),
    makeRow({
      id: "y2-h",
      objectiveId: "obj-y2-h",
      yearGroup: 2,
      strand: "Number",
      promptText: "18 + 2 =",
      answerText: "20",
      difficulty: DifficultyBand.HARD,
      contentJson: { domain: "addition_y2" },
    }),
    makeRow({
      id: "y3-e",
      objectiveId: "obj-y3-e",
      yearGroup: 3,
      strand: "Number",
      promptText: "20 + 5 =",
      answerText: "25",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "addition_y3" },
    }),
  ]);

  withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 3,
      questions: pool,
      maxQuestions: 10,
      extensionMaxQuestions: 10,
    });

    assert.equal(session.entryYear, 2);

    const first = getNextQuestion(session);
    assert.ok(first);
    assert.equal(first.yearGroup, 2);
    submitAnswer(session, {
      questionId: first.id,
      rawAnswer: "wrong",
    });

    const second = getNextQuestion(session);
    assert.ok(second);
    assert.equal(second.yearGroup, 2);
    submitAnswer(session, {
      questionId: second.id,
      rawAnswer: "wrong",
    });

    const third = getNextQuestion(session);
    assert.ok(third);
    assert.equal(third.yearGroup, 2);
    submitAnswer(session, {
      questionId: third.id,
      rawAnswer: "wrong",
    });

    assert.equal(session.strands.NUMBER.currentTargetYear, 1);

    const fourth = getNextQuestion(session);
    assert.ok(fourth);
    assert.equal(fourth.yearGroup, 1);
  });
});

test("year 4 learners start at year 3 when that year is available", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "start-y1",
      objectiveId: "obj-start-y1",
      yearGroup: 1,
      strand: "Number",
      promptText: "1 + 1 =",
      answerText: "2",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y1" },
    }),
    makeRow({
      id: "start-y3",
      objectiveId: "obj-start-y3",
      yearGroup: 3,
      strand: "Number",
      promptText: "20 + 5 =",
      answerText: "25",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y3" },
    }),
    makeRow({
      id: "start-y4",
      objectiveId: "obj-start-y4",
      yearGroup: 4,
      strand: "Number",
      promptText: "40 + 5 =",
      answerText: "45",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y4" },
    }),
  ]);

  withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 4,
      questions: pool,
      maxQuestions: 10,
      extensionMaxQuestions: 10,
    });

    assert.equal(session.entryYear, 3);
    const first = getNextQuestion(session);
    assert.ok(first);
    assert.equal(first.yearGroup, 3);
  });
});

test("entry year starts one below the learner year across phases when available", () => {
  const cases = [
    { childCurrentYear: 3, expectedEntryYear: 2, availableYears: [1, 2, 3, 4] },
    { childCurrentYear: 4, expectedEntryYear: 3, availableYears: [1, 3, 4, 5] },
    { childCurrentYear: 6, expectedEntryYear: 5, availableYears: [1, 3, 5, 6, 7] },
    { childCurrentYear: 10, expectedEntryYear: 9, availableYears: [7, 8, 9, 10] },
  ];

  for (const testCase of cases) {
    const pool = buildRuntimeQuestionPool(
      testCase.availableYears.map((yearGroup, index) =>
        makeRow({
          id: `generic-start-${testCase.childCurrentYear}-${yearGroup}`,
          objectiveId: `obj-generic-start-${testCase.childCurrentYear}-${index}`,
          yearGroup,
          strand: "Number",
          promptText: `${yearGroup} + 1 =`,
          answerText: String(yearGroup + 1),
          difficulty: DifficultyBand.EASY,
          contentJson: { domain: `number_y${yearGroup}` },
        })
      )
    );

    withDeterministicRandom(() => {
      const session = createAssessmentSession({
        childCurrentYear: testCase.childCurrentYear,
        questions: pool,
        maxQuestions: 10,
        extensionMaxQuestions: 10,
      });

      assert.equal(session.entryYear, testCase.expectedEntryYear);
    });
  }
});

test("entry year stays one below the learner year even when that exact year is missing", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "missing-y9",
      objectiveId: "obj-missing-y9",
      yearGroup: 9,
      strand: "Number",
      promptText: "90 + 1 =",
      answerText: "91",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y9" },
    }),
    makeRow({
      id: "missing-y11",
      objectiveId: "obj-missing-y11",
      yearGroup: 11,
      strand: "Number",
      promptText: "110 + 1 =",
      answerText: "111",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y11" },
    }),
  ]);

  withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 11,
      questions: pool,
      maxQuestions: 10,
      extensionMaxQuestions: 10,
    });

    assert.equal(session.entryYear, 10);
    assert.equal(session.minimumBandYear, 9);
    assert.equal(session.maximumBandYear, 11);
  });
});

test("weak year 3 performance stays within the one-year band window", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "desc-y1-e",
      objectiveId: "obj-desc-y1-e",
      yearGroup: 1,
      strand: "Number",
      promptText: "1 + 0 =",
      answerText: "1",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y1" },
    }),
    makeRow({
      id: "desc-y1-m",
      objectiveId: "obj-desc-y1-m",
      yearGroup: 1,
      strand: "Number",
      promptText: "2 + 1 =",
      answerText: "3",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "number_y1" },
    }),
    makeRow({
      id: "desc-y3-e",
      objectiveId: "obj-desc-y3-e",
      yearGroup: 3,
      strand: "Number",
      promptText: "20 + 5 =",
      answerText: "25",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y3" },
    }),
    makeRow({
      id: "desc-y3-m",
      objectiveId: "obj-desc-y3-m",
      yearGroup: 3,
      strand: "Number",
      promptText: "30 + 7 =",
      answerText: "37",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "number_y3" },
    }),
    makeRow({
      id: "desc-y3-h",
      objectiveId: "obj-desc-y3-h",
      yearGroup: 3,
      strand: "Number",
      promptText: "50 + 8 =",
      answerText: "58",
      difficulty: DifficultyBand.HARD,
      contentJson: { domain: "number_y3" },
    }),
    makeRow({
      id: "desc-y4-e",
      objectiveId: "obj-desc-y4-e",
      yearGroup: 4,
      strand: "Number",
      promptText: "40 + 5 =",
      answerText: "45",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y4" },
    }),
  ]);

  withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 4,
      questions: pool,
      maxQuestions: 10,
      extensionMaxQuestions: 10,
    });

    assert.equal(session.entryYear, 3);

    const first = getNextQuestion(session);
    assert.ok(first);
    assert.equal(first.yearGroup, 3);
    submitAnswer(session, {
      questionId: first.id,
      rawAnswer: "__wrong__",
    });

    const second = getNextQuestion(session);
    assert.ok(second);
    assert.equal(second.yearGroup, 3);
    submitAnswer(session, {
      questionId: second.id,
      rawAnswer: "__wrong__",
    });

    const third = getNextQuestion(session);
    assert.ok(third);
    assert.equal(third.yearGroup, 3);
    submitAnswer(session, {
      questionId: third.id,
      rawAnswer: "__wrong__",
    });

    assert.equal(session.strands.NUMBER.currentTargetYear, 2);

    const fourth = getNextQuestion(session);
    assert.ok(fourth);
    assert.ok([3, 4].includes(fourth.yearGroup));
    assert.notEqual(fourth.yearGroup, 1);
  });
});

test("strong year 3 performance promotes a year 4 learner to year 4 after enough evidence", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "promote-y3-e",
      objectiveId: "obj-promote-y3-e",
      yearGroup: 3,
      strand: "Number",
      promptText: "20 + 5 =",
      answerText: "25",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y3" },
    }),
    makeRow({
      id: "promote-y3-m",
      objectiveId: "obj-promote-y3-m",
      yearGroup: 3,
      strand: "Number",
      promptText: "30 + 7 =",
      answerText: "37",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "number_y3" },
    }),
    makeRow({
      id: "promote-y3-h",
      objectiveId: "obj-promote-y3-h",
      yearGroup: 3,
      strand: "Number",
      promptText: "50 + 8 =",
      answerText: "58",
      difficulty: DifficultyBand.HARD,
      contentJson: { domain: "number_y3" },
    }),
    makeRow({
      id: "promote-y4-e",
      objectiveId: "obj-promote-y4-e",
      yearGroup: 4,
      strand: "Number",
      promptText: "40 + 5 =",
      answerText: "45",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y4" },
    }),
    makeRow({
      id: "promote-y4-m",
      objectiveId: "obj-promote-y4-m",
      yearGroup: 4,
      strand: "Number",
      promptText: "60 + 6 =",
      answerText: "66",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "number_y4" },
    }),
  ]);

  withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 4,
      questions: pool,
      maxQuestions: 10,
      extensionMaxQuestions: 10,
    });

    for (let i = 0; i < 3; i += 1) {
      const next = getNextQuestion(session);
      assert.ok(next);
      assert.equal(next.yearGroup, 3);
      submitAnswer(session, {
        questionId: next.id,
        rawAnswer: next.answerText,
      });
    }

    assert.equal(session.strands.NUMBER.currentTargetYear, 4);

    const fourth = getNextQuestion(session);
    assert.ok(fourth);
    assert.equal(fourth.yearGroup, 4);
  });
});

test("target strand prefers nearby years before distant fallback questions", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "number-y9-a",
      objectiveId: "obj-number-y9-a",
      yearGroup: 9,
      strand: "Number",
      promptText: "3x + 1 when x = 4",
      answerText: "13",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y9" },
    }),
    makeRow({
      id: "ratio-y7-a",
      objectiveId: "obj-ratio-y7-a",
      yearGroup: 7,
      strand: "Ratio",
      promptText: "Write 50% as a fraction.",
      answerText: "1/2",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "ratio_y7" },
    }),
    makeRow({
      id: "ratio-y8-a",
      objectiveId: "obj-ratio-y8-a",
      yearGroup: 8,
      strand: "Ratio",
      promptText: "Simplify 8:12.",
      answerText: "2:3",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "ratio_y8" },
    }),
    makeRow({
      id: "ratio-y10-a",
      objectiveId: "obj-ratio-y10-a",
      yearGroup: 10,
      strand: "Ratio",
      promptText: "Increase 80 by 15%.",
      answerText: "92",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "ratio_y10" },
    }),
    makeRow({
      id: "ratio-y3-a",
      objectiveId: "obj-ratio-y3-a",
      yearGroup: 3,
      strand: "Ratio",
      promptText: "Find half of 12.",
      answerText: "6",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "ratio_y3" },
    }),
  ]);

  withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 10,
      questions: pool,
      maxQuestions: 10,
      extensionMaxQuestions: 10,
    });

    assert.equal(session.entryYear, 9);

    const first = getNextQuestion(session);
    assert.ok(first);
    submitAnswer(session, {
      questionId: first.id,
      rawAnswer: first.answerText,
    });

    const second = getNextQuestion(session);
    assert.ok(second);
    assert.equal(second.strand, "RATIO");
    assert.ok([8, 10].includes(second.yearGroup));
  });
});

test("assessment never serves questions outside the active one-year window", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "g-window-number-y7",
      objectiveId: "obj-g-window-number-y7",
      yearGroup: 7,
      strand: "Number",
      promptText: "Calculate: 1/2 + 1/4",
      answerText: "3/4",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y7" },
    }),
    makeRow({
      id: "g-window-algebra-y7",
      objectiveId: "obj-g-window-algebra-y7",
      yearGroup: 7,
      strand: "Algebra",
      promptText: "Solve: x + 7 = 15",
      answerText: "8",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "algebra_y7" },
    }),
    makeRow({
      id: "g-window-geometry-y7",
      objectiveId: "obj-g-window-geometry-y7",
      yearGroup: 7,
      strand: "Geometry",
      promptText: "Angles on a straight line add to?",
      answerText: "180",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "geometry_y7" },
    }),
    makeRow({
      id: "g-window-ratio-y8",
      objectiveId: "obj-g-window-ratio-y8",
      yearGroup: 8,
      strand: "Ratio",
      promptText: "A map uses scale 1cm : 5km. What distance is 4cm?",
      answerText: "20",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "ratio_y8" },
    }),
    makeRow({
      id: "g-window-data-y4",
      objectiveId: "obj-g-window-data-y4",
      yearGroup: 4,
      strand: "Data",
      promptText: "A bar chart shows after-school club choices: Art 26, Music 14, Sport 16. How many more pupils chose Art than Music?",
      answerText: "12",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "data_y4" },
    }),
    makeRow({
      id: "g-window-data-y3",
      objectiveId: "obj-g-window-data-y3",
      yearGroup: 3,
      strand: "Data",
      promptText: "A tally chart shows favourite school clubs: Chess 11, Drama 4, Art 6. How many more pupils chose Chess than Drama?",
      answerText: "7",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "data_y3" },
    }),
    makeRow({
      id: "g-window-data-y1",
      objectiveId: "obj-g-window-data-y1",
      yearGroup: 1,
      strand: "Data",
      promptText: "7, 9, 11, [], 15",
      answerText: "13",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "data_y1" },
    }),
  ]);

  withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 8,
      questions: pool,
      maxQuestions: 12,
      extensionMaxQuestions: 12,
    });

    assert.equal(session.entryYear, 7);
    assert.equal(session.minimumBandYear, 6);
    assert.equal(session.maximumBandYear, 8);

    for (let index = 0; index < 4; index += 1) {
      const next = getNextQuestion(session);
      assert.ok(next);
      assert.ok(next.yearGroup >= 6 && next.yearGroup <= 8);
      submitAnswer(session, {
        questionId: next.id,
        rawAnswer: next.answerText,
      });
    }
  });
});

test("text response questions do not add a generic wrapper instruction", () => {
  const question = buildRuntimeQuestion(
    makeRow({
      id: "shape-q",
      objectiveId: "obj-shape",
      yearGroup: 3,
      strand: "Geometry",
      itemType: "SHAPE_NAME",
      promptText: "Which 2D shape has 4 equal sides?",
      answerText: "square",
      contentJson: { domain: "lines_shapes_y3" },
    })
  );

  assert.equal(question.answerMode, "text");
  assert.equal(question.inputHelp, undefined);
});

test("range questions accept subtraction working as a correct response", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "range-q",
      objectiveId: "obj-range-q",
      yearGroup: 7,
      strand: "Data",
      promptText: "Find the range of 10, 4, 7",
      answerText: "6",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "data_range" },
    }),
  ]);

  const session = createAssessmentSession({
    childCurrentYear: 8,
    questions: pool,
    maxQuestions: 10,
    extensionMaxQuestions: 10,
  });

  const next = getNextQuestion(session);
  assert.ok(next);

  const result = submitAnswer(session, {
    questionId: next.id,
    rawAnswer: "4 - 10",
  });

  assert.equal(result.isCorrect, true);
});

test("typed numeric answers accept equivalent word aliases", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "word-alias-q",
      objectiveId: "obj-word-alias-q",
      yearGroup: 7,
      strand: "Geometry",
      promptText: "The perimeter of the regular hexagon is ____cm.",
      answerText: "54 / fifty four",
      difficulty: DifficultyBand.EASY,
      contentJson: {
        answerContract: "short_answer_alias",
        canonicalTruth: {
          answerContract: "short_answer_alias",
          immutableAnswers: ["54 / fifty four"],
        },
      },
    }),
  ]);

  const session = createAssessmentSession({
    childCurrentYear: 8,
    questions: pool,
    maxQuestions: 10,
    extensionMaxQuestions: 10,
  });

  const next = getNextQuestion(session);
  assert.ok(next);

  const digitResult = submitAnswer(session, {
    questionId: next.id,
    rawAnswer: "54",
  });
  assert.equal(digitResult.isCorrect, true);

  const wordSession = createAssessmentSession({
    childCurrentYear: 8,
    questions: pool,
    maxQuestions: 10,
    extensionMaxQuestions: 10,
  });
  const wordNext = getNextQuestion(wordSession);
  assert.ok(wordNext);

  const wordResult = submitAnswer(wordSession, {
    questionId: wordNext.id,
    rawAnswer: "fifty-four cm",
  });
  assert.equal(wordResult.isCorrect, true);
});

test("multiple choice marking uses the selected choice key", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "mcq-q",
      objectiveId: "obj-mcq-q",
      yearGroup: 7,
      strand: "Number",
      promptText: "Calculate 32 / 8.",
      answerText: "4",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_division" },
    }),
  ]);

  const session = createAssessmentSession({
    childCurrentYear: 8,
    questions: pool,
    maxQuestions: 10,
    extensionMaxQuestions: 10,
  });

  const next = getNextQuestion(session);
  assert.ok(next);
  assert.equal(next.choices.length, 4);

  const correct = submitAnswer(session, {
    questionId: next.id,
    selectedChoiceKey: next.correctChoiceKey,
  });
  assert.equal(correct.isCorrect, true);
});

test("substitution-style algebra multiple choice does not include placeholder options", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "sub-q",
      objectiveId: "obj-sub-q",
      yearGroup: 10,
      strand: "Algebra",
      promptText: "Have a go at this substitution question: evaluate the expression 2y - 4 when y = 5.",
      answerText: "6",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "algebra_substitution" },
    }),
  ]);

  const session = createAssessmentSession({
    childCurrentYear: 11,
    questions: pool,
    maxQuestions: 10,
    extensionMaxQuestions: 10,
  });

  const next = getNextQuestion(session);
  assert.ok(next);
  assert.equal(next.choices.length, 4);
  assert.equal(next.choices.some((choice) => choice.label.toLowerCase().includes("option")), false);
  assert.equal(next.choices.some((choice) => choice.label === "6"), true);
});

test("comparison symbol questions keep contextual answer options", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "cmp-1",
      objectiveId: "obj-cmp-1",
      yearGroup: 4,
      strand: "Number",
      promptText: "Put <, > or = between 4567 and 4567.",
      answerText: "=",
      difficulty: DifficultyBand.EASY,
      contentJson: { itemType: "COMPARISON", domain: "compare" },
    }),
  ]);

  withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 4,
      questions: pool,
      maxQuestions: 10,
      extensionMaxQuestions: 10,
    });

    const next = getNextQuestion(session);
    assert.ok(next);

    const labels = next.choices.map((choice) => choice.label);
    assert.equal(labels.includes("="), true);
    assert.equal(labels.includes("<"), true);
    assert.equal(labels.includes(">"), true);
    assert.equal(labels.some((label) => /^\d+$/.test(label)), false);
  });
});

test("shape-name questions keep shape-family distractors", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "shape-1",
      objectiveId: "obj-shape-1",
      yearGroup: 2,
      strand: "Geometry",
      promptText: "What shape is this?",
      answerText: "triangle",
      difficulty: DifficultyBand.EASY,
      itemType: "SHAPE_NAME",
      contentJson: { itemType: "SHAPE_NAME", domain: "shape" },
    }),
  ]);

  withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 2,
      questions: pool,
      maxQuestions: 10,
      extensionMaxQuestions: 10,
    });

    const next = getNextQuestion(session);
    assert.ok(next);

    const labels = next.choices.map((choice) => choice.label.toLowerCase());
    assert.equal(labels.includes("triangle"), true);
    assert.equal(labels.some((label) => /^\d+$/.test(label)), false);
    assert.equal(
      labels.every((label) =>
        ["triangle", "square", "rectangle", "circle", "pentagon", "hexagon", "cube", "cone"].includes(label)
      ),
      true
    );
  });
});

test("turn-direction questions keep directional distractors", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "turn-1",
      objectiveId: "obj-turn-1",
      yearGroup: 3,
      strand: "Geometry",
      promptText: "Which way should the arrow turn?",
      answerText: "clockwise",
      difficulty: DifficultyBand.EASY,
      itemType: "TURN_DIRECTION",
      contentJson: { itemType: "TURN_DIRECTION", domain: "turn_direction" },
    }),
  ]);

  withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 3,
      questions: pool,
      maxQuestions: 10,
      extensionMaxQuestions: 10,
    });

    const next = getNextQuestion(session);
    assert.ok(next);

    const labels = next.choices.map((choice) => choice.label.toLowerCase());
    assert.equal(labels.includes("clockwise"), true);
    assert.equal(labels.includes("anticlockwise"), true);
    assert.equal(labels.some((label) => /^\d+$/.test(label)), false);
  });
});

test("year 10 start band cannot drop below year 8", () => {
  const years = [7, 8, 9, 10];
  const pool = buildRuntimeQuestionPool(
    years.flatMap((yearGroup) =>
      [DifficultyBand.EASY, DifficultyBand.MEDIUM, DifficultyBand.HARD, DifficultyBand.HARD].map(
        (difficulty, index) =>
          makeRow({
            id: `floor-${yearGroup}-${index}`,
            objectiveId: `obj-floor-${yearGroup}-${index}`,
            yearGroup,
            strand: "Number",
            promptText: `${yearGroup * 10 + index} + 1 =`,
            answerText: String(yearGroup * 10 + index + 1),
            difficulty,
            contentJson: { domain: `number_y${yearGroup}` },
          })
      )
    )
  );

  withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 10,
      questions: pool,
      maxQuestions: 25,
      extensionMaxQuestions: 30,
    });

    assert.equal(session.entryYear, 9);
    assert.equal(session.minimumBandYear, 8);

    while (!session.isComplete) {
      const next = getNextQuestion(session);
      if (!next) break;
      submitAnswer(session, {
        questionId: next.id,
        selectedChoiceKey: "A" === next.correctChoiceKey ? "B" : "A",
      });
    }

    assert.equal(session.currentBandYear, 8);
  });
});

test("year 11 learners can promote to year 11 but not beyond it", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "y11-start-y10-a",
      objectiveId: "obj-y11-start-y10-a",
      yearGroup: 10,
      strand: "Number",
      promptText: "Expand: 3(x + 2)",
      answerText: "3x + 6",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y10" },
    }),
    makeRow({
      id: "y11-start-y10-b",
      objectiveId: "obj-y11-start-y10-b",
      yearGroup: 10,
      strand: "Algebra",
      promptText: "Solve: 2x + 1 = 11",
      answerText: "5",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "algebra_y10" },
    }),
    makeRow({
      id: "y11-start-y10-c",
      objectiveId: "obj-y11-start-y10-c",
      yearGroup: 10,
      strand: "Geometry",
      promptText: "Angle sum of a quadrilateral?",
      answerText: "360",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "geometry_y10" },
    }),
    makeRow({
      id: "y11-start-y10-d",
      objectiveId: "obj-y11-start-y10-d",
      yearGroup: 10,
      strand: "Ratio",
      promptText: "Write 35% as a decimal.",
      answerText: "0.35",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "ratio_y10" },
    }),
    makeRow({
      id: "y11-start-y10-e",
      objectiveId: "obj-y11-start-y10-e",
      yearGroup: 10,
      strand: "Data",
      promptText: "Find the mean of 4, 6, 8.",
      answerText: "6",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "data_y10" },
    }),
    makeRow({
      id: "y11-up-y11-a",
      objectiveId: "obj-y11-up-y11-a",
      yearGroup: 11,
      strand: "Number",
      promptText: "Simplify surd: 2√3 + 5√3",
      answerText: "7√3",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y11" },
    }),
    makeRow({
      id: "y11-up-y11-b",
      objectiveId: "obj-y11-up-y11-b",
      yearGroup: 11,
      strand: "Algebra",
      promptText: "Solve: x^2 = 49",
      answerText: "7",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "algebra_y11" },
    }),
    makeRow({
      id: "y11-up-y11-c",
      objectiveId: "obj-y11-up-y11-c",
      yearGroup: 11,
      strand: "Geometry",
      promptText: "Circumference formula uses?",
      answerText: "2πr",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "geometry_y11" },
    }),
  ]);

  withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 11,
      questions: pool,
      maxQuestions: 12,
      extensionMaxQuestions: 12,
    });

    assert.equal(session.entryYear, 10);
    assert.equal(session.maximumBandYear, 11);

    for (let index = 0; index < 8; index += 1) {
      const next = getNextQuestion(session);
      assert.ok(next);
      submitAnswer(session, {
        questionId: next.id,
        rawAnswer: next.answerText,
      });
    }

    assert.equal(session.currentBandYear, 11);

    const next = getNextQuestion(session);
    if (next) {
      assert.ok(next.yearGroup <= 11);
    }
  });
});

test("confidence does not end the assessment before a reasonable question count", () => {
  const pool = buildRuntimeQuestionPool(
    Array.from({ length: 15 }, (_, index) =>
      makeRow({
        id: `conf-q-${index}`,
        objectiveId: `conf-obj-${index}`,
        yearGroup: index < 8 ? 9 : 10,
        strand:
          index % 5 === 0
            ? "Number"
            : index % 5 === 1
            ? "Algebra"
            : index % 5 === 2
            ? "Ratio"
            : index % 5 === 3
            ? "Geometry"
            : "Data",
        promptText: `Question ${index}`,
        answerText: `${index + 1}`,
        difficulty: index % 2 === 0 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
        contentJson: { domain: `confidence_${index}` },
      })
    )
  );

  withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 10,
      questions: pool,
      maxQuestions: 25,
      extensionMaxQuestions: 30,
    });

    for (let index = 0; index < 11; index += 1) {
      const next = getNextQuestion(session);
      assert.ok(next);
      const outcome = submitAnswer(session, {
        questionId: next.id,
        rawAnswer: next.answerText,
      });
      assert.equal(outcome.isComplete, false);
    }

    let completionQuestionCount: number | null = null;

    for (let index = 11; index < 15; index += 1) {
      const next = getNextQuestion(session);
      assert.ok(next);
      const outcome = submitAnswer(session, {
        questionId: next.id,
        rawAnswer: next.answerText,
      });

      if (outcome.isComplete) {
        completionQuestionCount = session.responses.length;
        break;
      }
    }

    assert.ok(
      completionQuestionCount == null || completionQuestionCount >= 12
    );
  });
});

test("overall band does not drop below entry when strands are secure above entry year", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "n-y4-a",
      objectiveId: "obj-n-y4-a",
      yearGroup: 4,
      strand: "Number",
      promptText: "40 + 2 =",
      answerText: "42",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y4" },
    }),
    makeRow({
      id: "n-y4-b",
      objectiveId: "obj-n-y4-b",
      yearGroup: 4,
      strand: "Number",
      promptText: "36 + 4 =",
      answerText: "40",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "number_y4" },
    }),
    makeRow({
      id: "g-y4-a",
      objectiveId: "obj-g-y4-a",
      yearGroup: 4,
      strand: "Geometry",
      promptText: "How many sides does a square have?",
      answerText: "4",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "geometry_y4" },
    }),
    makeRow({
      id: "g-y4-b",
      objectiveId: "obj-g-y4-b",
      yearGroup: 4,
      strand: "Geometry",
      promptText: "How many right angles does a rectangle have?",
      answerText: "4",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "geometry_y4" },
    }),
    makeRow({
      id: "d-y4-a",
      objectiveId: "obj-d-y4-a",
      yearGroup: 4,
      strand: "Data",
      promptText: "Read the chart value for Monday.",
      answerText: "6",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "data_y4" },
    }),
    makeRow({
      id: "d-y4-b",
      objectiveId: "obj-d-y4-b",
      yearGroup: 4,
      strand: "Data",
      promptText: "How many more voted for red than blue?",
      answerText: "2",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "data_y4" },
    }),
  ]);

  const result = withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 5,
      questions: pool,
      maxQuestions: 10,
      extensionMaxQuestions: 10,
    });

    for (const question of pool) {
      submitAnswer(session, {
        questionId: question.id,
        rawAnswer: question.answerText,
      });
    }

    return buildAssessmentResult(session);
  });

  assert.notEqual(result.overallWorkingBand, "BELOW_ENTRY");
});

test("overall band treats strands secure at a higher year as also secure at entry", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "n-y4-a",
      objectiveId: "obj-n-y4-a2",
      yearGroup: 4,
      strand: "Number",
      promptText: "20 + 20 =",
      answerText: "40",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y4" },
    }),
    makeRow({
      id: "n-y4-b",
      objectiveId: "obj-n-y4-b2",
      yearGroup: 4,
      strand: "Number",
      promptText: "21 + 19 =",
      answerText: "40",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "number_y4" },
    }),
    makeRow({
      id: "n-y5-a",
      objectiveId: "obj-n-y5-a2",
      yearGroup: 5,
      strand: "Number",
      promptText: "30 + 15 =",
      answerText: "45",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y5" },
    }),
    makeRow({
      id: "n-y5-b",
      objectiveId: "obj-n-y5-b2",
      yearGroup: 5,
      strand: "Number",
      promptText: "48 - 3 =",
      answerText: "45",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "number_y5" },
    }),
    makeRow({
      id: "g-y4-a",
      objectiveId: "obj-g-y4-a2",
      yearGroup: 4,
      strand: "Geometry",
      promptText: "How many lines of symmetry does a square have?",
      answerText: "4",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "geometry_y4" },
    }),
    makeRow({
      id: "g-y4-b",
      objectiveId: "obj-g-y4-b2",
      yearGroup: 4,
      strand: "Geometry",
      promptText: "How many right angles does a square have?",
      answerText: "4",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "geometry_y4" },
    }),
    makeRow({
      id: "g-y5-a",
      objectiveId: "obj-g-y5-a2",
      yearGroup: 5,
      strand: "Geometry",
      promptText: "How many sides does a regular pentagon have?",
      answerText: "5",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "geometry_y5" },
    }),
    makeRow({
      id: "g-y5-b",
      objectiveId: "obj-g-y5-b2",
      yearGroup: 5,
      strand: "Geometry",
      promptText: "How many angles does a triangle have?",
      answerText: "3",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "geometry_y5" },
    }),
    makeRow({
      id: "d-y4-a",
      objectiveId: "obj-d-y4-a2",
      yearGroup: 4,
      strand: "Data",
      promptText: "Read the chart value for Tuesday.",
      answerText: "8",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "data_y4" },
    }),
    makeRow({
      id: "d-y4-b",
      objectiveId: "obj-d-y4-b2",
      yearGroup: 4,
      strand: "Data",
      promptText: "How many more chose red than green?",
      answerText: "3",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "data_y4" },
    }),
    makeRow({
      id: "d-y5-a",
      objectiveId: "obj-d-y5-a2",
      yearGroup: 5,
      strand: "Data",
      promptText: "Read the line graph value for Friday.",
      answerText: "10",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "data_y5" },
    }),
    makeRow({
      id: "d-y5-b",
      objectiveId: "obj-d-y5-b2",
      yearGroup: 5,
      strand: "Data",
      promptText: "How many fewer voted for blue than red?",
      answerText: "2",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "data_y5" },
    }),
  ]);

  const result = withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 5,
      questions: pool,
      maxQuestions: 20,
      extensionMaxQuestions: 20,
    });

    for (const question of pool) {
      submitAnswer(session, {
        questionId: question.id,
        rawAnswer: question.answerText,
      });
    }

    return buildAssessmentResult(session);
  });

  assert.equal(result.overallWorkingBand, "NEXT_SECURE");
});

test("high-year perfect evidence does not collapse to below entry because lower years were unasked", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "n-y7-a",
      objectiveId: "obj-n-y7-a",
      yearGroup: 7,
      strand: "Number",
      promptText: "7 + 5 =",
      answerText: "12",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y7" },
    }),
    makeRow({
      id: "n-y7-b",
      objectiveId: "obj-n-y7-b",
      yearGroup: 7,
      strand: "Number",
      promptText: "18 - 6 =",
      answerText: "12",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "number_y7" },
    }),
    makeRow({
      id: "a-y7-a",
      objectiveId: "obj-a-y7-a",
      yearGroup: 7,
      strand: "Algebra",
      promptText: "If x + 4 = 9, what is x?",
      answerText: "5",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "algebra_y7" },
    }),
    makeRow({
      id: "a-y7-b",
      objectiveId: "obj-a-y7-b",
      yearGroup: 7,
      strand: "Algebra",
      promptText: "If 2x = 14, what is x?",
      answerText: "7",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "algebra_y7" },
    }),
    makeRow({
      id: "r-y8-a",
      objectiveId: "obj-r-y8-a",
      yearGroup: 8,
      strand: "Ratio",
      promptText: "Simplify 12:18.",
      answerText: "2:3",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "ratio_y8" },
    }),
    makeRow({
      id: "r-y8-b",
      objectiveId: "obj-r-y8-b",
      yearGroup: 8,
      strand: "Ratio",
      promptText: "Write 0.25 as a fraction.",
      answerText: "1/4",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "ratio_y8" },
    }),
    makeRow({
      id: "g-y9-a",
      objectiveId: "obj-g-y9-a",
      yearGroup: 9,
      strand: "Geometry",
      promptText: "Angles on a straight line add to?",
      answerText: "180",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "geometry_y9" },
    }),
    makeRow({
      id: "g-y9-b",
      objectiveId: "obj-g-y9-b",
      yearGroup: 9,
      strand: "Geometry",
      promptText: "Angles in a triangle add to?",
      answerText: "180",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "geometry_y9" },
    }),
    makeRow({
      id: "d-y9-a",
      objectiveId: "obj-d-y9-a",
      yearGroup: 9,
      strand: "Data",
      promptText: "What is the mean of 3, 6, 9?",
      answerText: "6",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "data_y9" },
    }),
    makeRow({
      id: "d-y9-b",
      objectiveId: "obj-d-y9-b",
      yearGroup: 9,
      strand: "Data",
      promptText: "What is the range of 4, 9, 11?",
      answerText: "7",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "data_y9" },
    }),
  ]);

  const result = withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 10,
      questions: pool,
      maxQuestions: 20,
      extensionMaxQuestions: 20,
    });

    for (const question of pool) {
      submitAnswer(session, {
        questionId: question.id,
        rawAnswer: question.answerText,
      });
    }

    return buildAssessmentResult(session);
  });

  const number = result.strands.find((strand) => strand.strand === "NUMBER");
  const geometry = result.strands.find((strand) => strand.strand === "GEOMETRY");

  assert.equal(number?.secureYear, 7);
  assert.equal(geometry?.secureYear, 9);
  assert.notEqual(result.overallWorkingBand, "BELOW_ENTRY");
});

test("all-wrong sessions do not build high confidence", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "aw-n1",
      objectiveId: "aw-obj-n1",
      yearGroup: 3,
      strand: "Number",
      promptText: "10 + 2 =",
      answerText: "12",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number" },
    }),
    makeRow({
      id: "aw-n2",
      objectiveId: "aw-obj-n2",
      yearGroup: 3,
      strand: "Number",
      promptText: "13 + 4 =",
      answerText: "17",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "number" },
    }),
    makeRow({
      id: "aw-g1",
      objectiveId: "aw-obj-g1",
      yearGroup: 3,
      strand: "Geometry",
      promptText: "How many sides does a triangle have?",
      answerText: "3",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "geometry" },
    }),
    makeRow({
      id: "aw-g2",
      objectiveId: "aw-obj-g2",
      yearGroup: 3,
      strand: "Geometry",
      promptText: "How many right angles make a half turn?",
      answerText: "2",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "geometry" },
    }),
    makeRow({
      id: "aw-d1",
      objectiveId: "aw-obj-d1",
      yearGroup: 3,
      strand: "Data",
      promptText: "Read the chart value.",
      answerText: "4",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "data" },
    }),
    makeRow({
      id: "aw-d2",
      objectiveId: "aw-obj-d2",
      yearGroup: 3,
      strand: "Data",
      promptText: "How many more voted for red than blue?",
      answerText: "2",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "data" },
    }),
  ]);

  const result = withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 4,
      questions: pool,
      maxQuestions: 10,
      extensionMaxQuestions: 10,
    });

    for (const question of pool) {
      submitAnswer(session, {
        questionId: question.id,
        rawAnswer: "__wrong__",
      });
    }

    return buildAssessmentResult(session);
  });

  assert.equal(result.overallWorkingBand, "BELOW_ENTRY");
  assert.ok(result.overallConfidence < 0.3);
});

test("secure entry without next-year success stays entry secure", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "es-n3a",
      objectiveId: "es-obj-n3a",
      yearGroup: 3,
      strand: "Number",
      promptText: "8 + 4 =",
      answerText: "12",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y3" },
    }),
    makeRow({
      id: "es-n3b",
      objectiveId: "es-obj-n3b",
      yearGroup: 3,
      strand: "Number",
      promptText: "12 + 3 =",
      answerText: "15",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "number_y3" },
    }),
    makeRow({
      id: "es-g3a",
      objectiveId: "es-obj-g3a",
      yearGroup: 3,
      strand: "Geometry",
      promptText: "Is 90 degrees a right angle?",
      answerText: "yes",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "geometry_y3" },
    }),
    makeRow({
      id: "es-g3b",
      objectiveId: "es-obj-g3b",
      yearGroup: 3,
      strand: "Geometry",
      promptText: "How many right angles make a full turn?",
      answerText: "4",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "geometry_y3" },
    }),
    makeRow({
      id: "es-d3a",
      objectiveId: "es-obj-d3a",
      yearGroup: 3,
      strand: "Data",
      promptText: "Read the chart value for Monday.",
      answerText: "6",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "data_y3" },
    }),
    makeRow({
      id: "es-d3b",
      objectiveId: "es-obj-d3b",
      yearGroup: 3,
      strand: "Data",
      promptText: "How many more voted for red than green?",
      answerText: "3",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "data_y3" },
    }),
    makeRow({
      id: "es-r3a",
      objectiveId: "es-obj-r3a",
      yearGroup: 3,
      strand: "Ratio",
      promptText: "Find 1/2 of 12.",
      answerText: "6",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "ratio_y3" },
    }),
    makeRow({
      id: "es-r3b",
      objectiveId: "es-obj-r3b",
      yearGroup: 3,
      strand: "Ratio",
      promptText: "Compare 1/4 and 1/2. Use <, >, or =.",
      answerText: "<",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "ratio_y3" },
    }),
    makeRow({
      id: "es-n4a",
      objectiveId: "es-obj-n4a",
      yearGroup: 4,
      strand: "Number",
      promptText: "20 x 3 =",
      answerText: "60",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y4" },
    }),
    makeRow({
      id: "es-g4a",
      objectiveId: "es-obj-g4a",
      yearGroup: 4,
      strand: "Geometry",
      promptText: "How many lines of symmetry does a square have?",
      answerText: "4",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "geometry_y4" },
    }),
    makeRow({
      id: "es-d4a",
      objectiveId: "es-obj-d4a",
      yearGroup: 4,
      strand: "Data",
      promptText: "Read the line graph value for Friday.",
      answerText: "10",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "data_y4" },
    }),
    makeRow({
      id: "es-r4a",
      objectiveId: "es-obj-r4a",
      yearGroup: 4,
      strand: "Ratio",
      promptText: "Find 3/4 of 20.",
      answerText: "15",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "ratio_y4" },
    }),
  ]);

  const result = withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 4,
      questions: pool,
      maxQuestions: 20,
      extensionMaxQuestions: 20,
    });

    for (const question of pool) {
      submitAnswer(session, {
        questionId: question.id,
        rawAnswer: question.yearGroup === 3 ? question.answerText : "__wrong__",
      });
    }

    return buildAssessmentResult(session);
  });

  assert.equal(result.overallWorkingBand, "ENTRY_SECURE");
});

test("year 1 sustained struggle stops early for intervention", () => {
  const pool = buildRuntimeQuestionPool([
    makeRow({
      id: "int-y1-n1",
      objectiveId: "obj-int-y1-n1",
      yearGroup: 1,
      strand: "Number",
      promptText: "1 + 0 =",
      answerText: "1",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "number_y1" },
    }),
    makeRow({
      id: "int-y1-n2",
      objectiveId: "obj-int-y1-n2",
      yearGroup: 1,
      strand: "Number",
      promptText: "2 + 1 =",
      answerText: "3",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "number_y1" },
    }),
    makeRow({
      id: "int-y1-g1",
      objectiveId: "obj-int-y1-g1",
      yearGroup: 1,
      strand: "Geometry",
      promptText: "3 sides",
      answerText: "triangle",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "geometry_y1" },
    }),
    makeRow({
      id: "int-y1-g2",
      objectiveId: "obj-int-y1-g2",
      yearGroup: 1,
      strand: "Geometry",
      promptText: "1 curved side",
      answerText: "circle",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "geometry_y1" },
    }),
    makeRow({
      id: "int-y1-d1",
      objectiveId: "obj-int-y1-d1",
      yearGroup: 1,
      strand: "Data",
      promptText: "1, [], 5, 7, 9",
      answerText: "3",
      difficulty: DifficultyBand.EASY,
      contentJson: { domain: "data_y1" },
    }),
    makeRow({
      id: "int-y1-d2",
      objectiveId: "obj-int-y1-d2",
      yearGroup: 1,
      strand: "Data",
      promptText: "2, [], 6, 8, 10",
      answerText: "4",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { domain: "data_y1" },
    }),
    makeRow({
      id: "int-y1-n3",
      objectiveId: "obj-int-y1-n3",
      yearGroup: 1,
      strand: "Number",
      promptText: "3 + 1 =",
      answerText: "4",
      difficulty: DifficultyBand.HARD,
      contentJson: { domain: "number_y1" },
    }),
    makeRow({
      id: "int-y1-g3",
      objectiveId: "obj-int-y1-g3",
      yearGroup: 1,
      strand: "Geometry",
      promptText: "4 equal sides",
      answerText: "square",
      difficulty: DifficultyBand.HARD,
      contentJson: { domain: "geometry_y1" },
    }),
    makeRow({
      id: "int-y1-d3",
      objectiveId: "obj-int-y1-d3",
      yearGroup: 1,
      strand: "Data",
      promptText: "3, [], 7, 9, 11",
      answerText: "5",
      difficulty: DifficultyBand.HARD,
      contentJson: { domain: "data_y1" },
    }),
    makeRow({
      id: "int-y1-n4",
      objectiveId: "obj-int-y1-n4",
      yearGroup: 1,
      strand: "Number",
      promptText: "4 + 1 =",
      answerText: "5",
      difficulty: DifficultyBand.HARD,
      contentJson: { domain: "number_y1" },
    }),
  ]);

  withDeterministicRandom(() => {
    const session = createAssessmentSession({
      childCurrentYear: 1,
      questions: pool,
      maxQuestions: 25,
      extensionMaxQuestions: 30,
    });

    for (let i = 0; i < 10; i += 1) {
      const next = getNextQuestion(session);
      assert.ok(next);
      const outcome = submitAnswer(session, {
        questionId: next.id,
        rawAnswer: "__wrong__",
      });
      if (outcome.isComplete) break;
    }

    assert.equal(session.isComplete, true);
    assert.equal(session.completionReason, "INTERVENTION_NEEDED");
    assert.ok(session.responses.length <= 10);
  });
});
