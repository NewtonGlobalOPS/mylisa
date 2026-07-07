import "dotenv/config";
import { KeyStage, Role, Subject } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import {
  answerMathsAssessment,
  startMathsAssessment,
} from "../src/assessment/assessmentService.js";
import { getProfileForObjective } from "../src/canonical/getProfileForObjective.js";

type Scenario = {
  label: string;
  schoolYear: number;
  strategy: "all_correct" | "mostly_correct" | "alternating";
};

type ServedAudit = {
  index: number;
  questionId: string;
  yearGroup: number;
  strand: string;
  code: string;
  promptText: string;
  answeredCorrectly: boolean;
  bandAfterAnswer: number;
  outsideExpectedWindow: boolean;
  expectedGenerator: string | null;
  actualGenerator: string | null;
  generatorMismatch: boolean;
};

function schoolYearToKeyStage(schoolYear: number): KeyStage {
  if (schoolYear <= 2) return KeyStage.KS1;
  if (schoolYear <= 6) return KeyStage.KS2;
  if (schoolYear <= 9) return KeyStage.KS3;
  return KeyStage.KS4;
}

function schoolYearToAge(schoolYear: number): number {
  return Math.max(4, Math.min(25, schoolYear + 4));
}

function shouldAnswerCorrectly(
  strategy: Scenario["strategy"],
  index: number
): boolean {
  switch (strategy) {
    case "all_correct":
      return true;
    case "mostly_correct":
      return index % 6 !== 3;
    case "alternating":
      return index % 2 === 1;
    default:
      return true;
  }
}

async function createTempStudent(schoolYear: number, label: string) {
  const organisation = await prisma.organisation.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!organisation) {
    throw new Error("No active organisation found.");
  }

  const stamp = `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const email = `smoke.${label}.${schoolYear}.${stamp}@example.test`;

  const user = await prisma.user.create({
    data: {
      organisationId: organisation.id,
      email,
      passwordHash: "smoke-test",
      role: Role.STUDENT,
      isActive: true,
      student: {
        create: {
          organisationId: organisation.id,
          firstName: "Smoke",
          lastName: `${label}-Y${schoolYear}`,
          age: schoolYearToAge(schoolYear),
          keyStage: schoolYearToKeyStage(schoolYear),
          subjects: [Subject.MATHS],
        },
      },
    },
    select: {
      id: true,
      student: { select: { id: true } },
    },
  });

  if (!user.student?.id) {
    throw new Error("Failed to create temp smoke-test student.");
  }

  return {
    userId: user.id,
    studentId: user.student.id,
  };
}

async function loadGeneratorAudit(questionIds: string[]) {
  const rows = await prisma.canonicalQuestion.findMany({
    where: { id: { in: questionIds } },
    select: {
      id: true,
      generatorMeta: true,
      objective: {
        select: {
          code: true,
          yearGroup: true,
          title: true,
          statement: true,
          strand: true,
          keywords: true,
        },
      },
    },
  });

  const map = new Map<
    string,
    {
      expectedGenerator: string | null;
      actualGenerator: string | null;
    }
  >();

  for (const row of rows) {
    const profile = getProfileForObjective({
      code: row.objective.code,
      subject: "MATHS",
      yearGroup: row.objective.yearGroup,
      title: row.objective.title,
      statement: row.objective.statement,
      strand: row.objective.strand,
      keywords: row.objective.keywords,
    });

    map.set(row.id, {
      expectedGenerator:
        profile
          ? "directGenerator" in profile
            ? profile.directGenerator ?? "__POOL__"
            : "__POOL__"
          : null,
      actualGenerator:
        typeof (row.generatorMeta as Record<string, unknown> | null)?.directGenerator ===
        "string"
          ? String((row.generatorMeta as Record<string, unknown>).directGenerator)
          : null,
    });
  }

  return map;
}

async function runScenario(scenario: Scenario) {
  const temp = await createTempStudent(scenario.schoolYear, scenario.label);
  const expectedEntryYear = Math.max(1, scenario.schoolYear - 1);
  const expectedMinYear = Math.max(1, expectedEntryYear - 1);
  const expectedMaxYear = scenario.schoolYear;
  const served: Array<{
    index: number;
    questionId: string;
    yearGroup: number;
    strand: string;
    code: string;
    promptText: string;
    answeredCorrectly: boolean;
    bandAfterAnswer: number;
  }> = [];

  try {
    const started = await startMathsAssessment({
      studentId: temp.studentId,
      childCurrentYear: scenario.schoolYear,
    });

    let question = started.firstQuestion;
    let index = 0;
    let finalResult:
      | {
          questionCount: number;
          overallWorkingBand: string;
          overallConfidence: number;
          completionReason?: string;
        }
      | undefined;

    while (question) {
      index += 1;
      const answerCorrectly = shouldAnswerCorrectly(scenario.strategy, index);
      const wrongChoice = question.choices.find(
        (choice) => choice.key !== question.correctChoiceKey
      );

      const outcome = await answerMathsAssessment({
        sessionId: started.session.sessionId,
        questionId: question.id,
        selectedChoiceKey: answerCorrectly
          ? question.correctChoiceKey
          : wrongChoice?.key ?? question.correctChoiceKey,
      });

      served.push({
        index,
        questionId: question.id,
        yearGroup: question.yearGroup,
        strand: question.strand,
        code: question.code,
        promptText: question.promptText,
        answeredCorrectly: outcome.isCorrect,
        bandAfterAnswer: outcome.session.currentBandYear,
      });

      if (outcome.result) {
        finalResult = {
          questionCount: outcome.result.questionCount,
          overallWorkingBand: outcome.result.overallWorkingBand,
          overallConfidence: outcome.result.overallConfidence,
          completionReason: outcome.result.completionReason,
        };
      }

      question = outcome.nextQuestion;
    }

    const generatorAudit = await loadGeneratorAudit(served.map((item) => item.questionId));
    const servedAudit: ServedAudit[] = served.map((item) => {
      const generator = generatorAudit.get(item.questionId) ?? {
        expectedGenerator: null,
        actualGenerator: null,
      };

      return {
        ...item,
        outsideExpectedWindow:
          item.yearGroup < expectedMinYear || item.yearGroup > expectedMaxYear,
        expectedGenerator: generator.expectedGenerator,
        actualGenerator: generator.actualGenerator,
        generatorMismatch:
          generator.expectedGenerator !== null &&
          generator.actualGenerator !== null &&
          generator.expectedGenerator !== generator.actualGenerator,
      };
    });

    return {
      scenario,
      sessionId: started.session.sessionId,
      entryYear: started.session.entryYear,
      expectedEntryYear,
      expectedWindow: [expectedMinYear, expectedMaxYear] as [number, number],
      servedYears: Array.from(new Set(servedAudit.map((item) => item.yearGroup))).sort(
        (a, b) => a - b
      ),
      bandHistory: Array.from(new Set(servedAudit.map((item) => item.bandAfterAnswer))),
      outOfWindowCount: servedAudit.filter((item) => item.outsideExpectedWindow).length,
      generatorMismatchCount: servedAudit.filter((item) => item.generatorMismatch).length,
      unsupportedGeneratorCount: servedAudit.filter(
        (item) => item.expectedGenerator === null
      ).length,
      finalResult,
      servedAudit,
    };
  } finally {
    await prisma.user.deleteMany({
      where: { id: temp.userId },
    });
  }
}

async function main() {
  await prisma.user.deleteMany({
    where: {
      email: {
        startsWith: "smoke.",
      },
    },
  });

  const scenarios: Scenario[] = [
    { label: "ks1", schoolYear: 2, strategy: "all_correct" },
    { label: "ks2", schoolYear: 4, strategy: "mostly_correct" },
    { label: "ks3a", schoolYear: 7, strategy: "all_correct" },
    { label: "ks3b", schoolYear: 9, strategy: "mostly_correct" },
    { label: "ks4", schoolYear: 11, strategy: "all_correct" },
  ];

  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScenario(scenario));
  }

  console.log(JSON.stringify(results, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
