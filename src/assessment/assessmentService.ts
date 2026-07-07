import {
  AssessmentContext,
  AttemptStatus,
  HelpLevel,
  Subject,
  TaskType,
  type DifficultyBand,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import {
  AssessmentNarrativeReport,
  AssessmentResult,
  AssessmentSession,
  AssessmentMatchPair,
  RuntimeQuestion,
  buildRuntimeQuestionPool,
  createAssessmentSession,
  ensureMultipleChoiceQuestion,
  getNextQuestion,
  recalculateAssessmentSession,
  submitAnswer,
  buildAssessmentResult,
} from "./assessmentEngine.js";
import { buildAssessmentNarrativeReport } from "./assessmentReport.service.js";
import { reviewAndWrapAssessmentQuestion } from "./assessmentQuestionWrapper.service.js";

type PersistedQuestionMeta = {
  canonicalQuestionId: string;
  objectiveId: string;
  strandId: string | null;
  strandLabel: string | null;
  canonicalEquation: string | null;
  canonicalOperator: string | null;
  lhsA: number | null;
  lhsB: number | null;
  rhs: number | null;
  prompt: string;
  type: string;
  difficulty: DifficultyBand;
  signature: string;
};

type PresentedAssessmentQuestion = RuntimeQuestion & {
  canonicalPromptText: string;
  displayPromptText: string;
  wrapperSource: "llm" | "fallback";
};

type PersistedAssessmentState = {
  version: 3;
  session: AssessmentSession;
  questionMetaById: Record<string, PersistedQuestionMeta>;
  report?: AssessmentNarrativeReport | null;
};

const sessionStore = new Map<string, AssessmentSession>();

function determineNormalizedEntryYear(childCurrentYear: number): number {
  return Math.max(1, childCurrentYear - 1);
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

function cloneSession(session: AssessmentSession): AssessmentSession {
  return {
    ...session,
    questions: session.questions.map((q) =>
      ensureMultipleChoiceQuestion({
        ...q,
        contentJson: q.contentJson ? { ...q.contentJson } : q.contentJson,
      })
    ),
    askedQuestionIds: [...session.askedQuestionIds],
    responses: session.responses.map((r) => ({ ...r })),
    skippedQuestions: (session.skippedQuestions ?? []).map((q) => ({ ...q })),
    strands: JSON.parse(JSON.stringify(session.strands)),
    initialQueue: [...session.initialQueue],
  };
}

function serializeState(
  session: AssessmentSession,
  questionMetaById: Record<string, PersistedQuestionMeta>,
  report?: AssessmentNarrativeReport | null
): PersistedAssessmentState {
  return {
    version: 3,
    session: cloneSession(session),
    questionMetaById,
    report: report ?? null,
  };
}

function deserializeState(notes: Prisma.JsonValue): PersistedAssessmentState {
  const raw = notes as PersistedAssessmentState | null;

  if (!raw || typeof raw !== "object" || !("session" in raw)) {
    throw new Error("Persisted assessment state is missing or invalid.");
  }

  const questions = (raw.session.questions ?? []).map((question) =>
    ensureMultipleChoiceQuestion(question)
  );
  const entryYear = determineNormalizedEntryYear(raw.session.childCurrentYear);
  const minimumBandYear = Math.max(1, entryYear - 1);
  const maximumBandYear = Math.min(
    raw.session.childCurrentYear,
    raw.session.maximumYear ?? raw.session.childCurrentYear
  );
  const currentBandYear = Math.max(
    minimumBandYear,
    Math.min(raw.session.currentBandYear ?? entryYear, maximumBandYear)
  );

  return {
    version: 3,
    session: {
      ...raw.session,
      subject: raw.session.subject ?? Subject.MATHS,
      questions,
      entryYear,
      currentBandYear,
      minimumBandYear,
      maximumBandYear,
      bandStartedAtResponseCount: raw.session.bandStartedAtResponseCount ?? 0,
      skippedQuestions: raw.session.skippedQuestions ?? [],
      initialQueue: raw.session.initialQueue ?? [],
    },
    questionMetaById: raw.questionMetaById ?? {},
    report:
      raw && typeof raw === "object" && "report" in raw
        ? ((raw.report as AssessmentNarrativeReport | null | undefined) ?? null)
        : null,
  };
}

async function getDefaultOrganisationId(): Promise<string> {
  const organisation = await prisma.organisation.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!organisation) {
    throw new Error("No organisation found.");
  }

  return organisation.id;
}

function normalizeText(value: string | null | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/£/g, "gbp")
    .replace(/\s+/g, " ")
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function normalizeJsonForSignature(
  value: Record<string, unknown> | null | undefined
): string {
  if (!value) return "";

  const ignoredKeys = new Set([
    "domain",
    "subtype",
    "template",
    "answerMode",
    "canonicalOperator",
    "objectiveCode",
    "objectiveTitle",
    "objectiveYearGroup",
    "profileName",
    "directGenerator",
  ]);

  const sorted = Object.keys(value)
    .filter((key) => !ignoredKeys.has(key))
    .sort()
    .map((key) => `${key}:${String(value[key])}`)
    .join("|");

  return normalizeText(sorted);
}

function createQuestionSignature(input: {
  promptText: string;
  answerText: string;
  itemType?: string | null;
  answerMode?: string | null;
  contentJson?: Record<string, unknown> | null;
  lhsA?: number | null;
  lhsB?: number | null;
  rhs?: number | null;
  operator?: string | null;
}): string {
  const numericShape =
    input.lhsA != null ||
    input.lhsB != null ||
    input.rhs != null ||
    input.operator != null
      ? `shape:${input.operator ?? ""}:${input.lhsA ?? ""}:${input.lhsB ?? ""}:${
          input.rhs ?? ""
        }`
      : "";

  return [
    `type:${normalizeText(input.itemType ?? "")}`,
    `mode:${normalizeText(input.answerMode ?? "")}`,
    `prompt:${normalizeText(input.promptText)}`,
    `answer:${normalizeText(input.answerText)}`,
    `json:${normalizeJsonForSignature(input.contentJson ?? null)}`,
    numericShape,
  ]
    .filter(Boolean)
    .join("|");
}

type CanonicalAssessmentRow = {
  id: string;
  objectiveId: string;
  strandId: string | null;
  strandLabel: string | null;
  itemType: string;
  operator: string | null;
  lhsA: number | null;
  lhsB: number | null;
  rhs: number | null;
  equation: string | null;
  promptText: string;
  answerText: string;
  difficulty: DifficultyBand;
  contentJson: Prisma.JsonValue | null;
  objective: {
    subject: Subject;
    code: string;
    title: string;
    statement: string;
    yearGroup: number | null;
    strand: string;
  };
};

function difficultyRank(difficulty: DifficultyBand): number {
  switch (difficulty) {
    case "EASY":
      return 1;
    case "MEDIUM":
      return 2;
    case "HARD":
      return 3;
    default:
      return 999;
  }
}

function dedupeCanonicalRows(rows: CanonicalAssessmentRow[]): CanonicalAssessmentRow[] {
  const bySignature = new Map<string, CanonicalAssessmentRow>();

  for (const row of rows) {
    const contentJson =
      row.contentJson && typeof row.contentJson === "object"
        ? (row.contentJson as Record<string, unknown>)
        : null;

    const signature = createQuestionSignature({
      promptText: row.promptText,
      answerText: row.answerText,
      itemType: row.itemType,
      answerMode:
        contentJson && typeof contentJson.answerMode === "string"
          ? String(contentJson.answerMode)
          : null,
      contentJson,
      lhsA: row.lhsA,
      lhsB: row.lhsB,
      rhs: row.rhs,
      operator: row.operator,
    });

    const existing = bySignature.get(signature);

    if (!existing) {
      bySignature.set(signature, row);
      continue;
    }

    const existingRank = difficultyRank(existing.difficulty);
    const incomingRank = difficultyRank(row.difficulty);

    const shouldReplace =
      incomingRank < existingRank ||
      (incomingRank === existingRank &&
        (row.objective.yearGroup ?? -1) > (existing.objective.yearGroup ?? -1)) ||
      (incomingRank === existingRank &&
        (row.objective.yearGroup ?? -1) === (existing.objective.yearGroup ?? -1) &&
        row.id < existing.id);

    if (shouldReplace) {
      bySignature.set(signature, row);
    }
  }

  return Array.from(bySignature.values());
}

async function buildSubjectAssessmentPool(
  organisationId: string,
  childCurrentYear: number,
  subject: Subject
) {
  const minYear = 1;
  const maxYear = childCurrentYear;

  const rawRows = await prisma.canonicalQuestion.findMany({
    where: {
      organisationId,
      status: "ACTIVE",
      objective: {
        subject,
        yearGroup: { gte: minYear, lte: maxYear },
        isActive: true,
      },
    },
    select: {
      id: true,
      objectiveId: true,
      strandId: true,
      strandLabel: true,
      itemType: true,
      operator: true,
      lhsA: true,
      lhsB: true,
      rhs: true,
      equation: true,
      promptText: true,
      answerText: true,
      difficulty: true,
      contentJson: true,
      objective: {
        select: {
          code: true,
          subject: true,
          title: true,
          statement: true,
          yearGroup: true,
          strand: true,
        },
      },
    },
    orderBy: [
      { objective: { yearGroup: "asc" } },
      { objectiveId: "asc" },
      { sequence: "asc" },
    ],
  });

  const rows = dedupeCanonicalRows(rawRows as CanonicalAssessmentRow[]);

  const pool = buildRuntimeQuestionPool(
    rows.map((row) => ({
      id: row.id,
      objectiveId: row.objectiveId,
      itemType: row.itemType,
      subject: row.objective.subject,
      code: row.objective.code,
      title: row.objective.title,
      statement: row.objective.statement,
      yearGroup: row.objective.yearGroup,
      strand: row.strandLabel ?? row.objective.strand,
      promptText: row.promptText,
      answerText: row.answerText,
      difficulty: row.difficulty,
      contentJson:
        row.contentJson && typeof row.contentJson === "object"
          ? (row.contentJson as Record<string, unknown>)
          : null,
    }))
  );

  const questionMetaById: Record<string, PersistedQuestionMeta> = {};

  for (const row of rows) {
    const contentJson =
      row.contentJson && typeof row.contentJson === "object"
        ? (row.contentJson as Record<string, unknown>)
        : null;

    const signature = createQuestionSignature({
      promptText: row.promptText,
      answerText: row.answerText,
      itemType: row.itemType,
      answerMode:
        contentJson && typeof contentJson.answerMode === "string"
          ? String(contentJson.answerMode)
          : null,
      contentJson,
      lhsA: row.lhsA,
      lhsB: row.lhsB,
      rhs: row.rhs,
      operator: row.operator,
    });

    questionMetaById[row.id] = {
      canonicalQuestionId: row.id,
      objectiveId: row.objectiveId,
      strandId: row.strandId ?? null,
      strandLabel: row.strandLabel ?? row.objective.strand ?? null,
      canonicalEquation: row.equation ?? null,
      canonicalOperator: row.operator ?? null,
      lhsA: row.lhsA ?? null,
      lhsB: row.lhsB ?? null,
      rhs: row.rhs ?? null,
      prompt: row.promptText,
      type: row.itemType,
      difficulty: row.difficulty,
      signature,
    };
  }

  return { pool, questionMetaById };
}

async function loadAttemptState(sessionId: string): Promise<{
  attemptId: string;
  organisationId: string;
  studentId: string;
  session: AssessmentSession;
  questionMetaById: Record<string, PersistedQuestionMeta>;
  report: AssessmentNarrativeReport | null;
}> {
  const cached = sessionStore.get(sessionId);

  if (cached) {
    const attempt = await prisma.attempt.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        organisationId: true,
        studentId: true,
        notes: true,
      },
    });

    if (!attempt || !attempt.notes) {
      throw new Error(`Assessment session not found: ${sessionId}`);
    }

    const persisted = deserializeState(attempt.notes);

    return {
      attemptId: attempt.id,
      organisationId: attempt.organisationId,
      studentId: attempt.studentId,
      session: cached,
      questionMetaById: persisted.questionMetaById,
      report: persisted.report ?? null,
    };
  }

  const attempt = await prisma.attempt.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      organisationId: true,
      studentId: true,
      notes: true,
    },
  });

  if (!attempt || !attempt.notes) {
    throw new Error(`Assessment session not found: ${sessionId}`);
  }

  const persisted = deserializeState(attempt.notes);
  sessionStore.set(sessionId, persisted.session);

  return {
    attemptId: attempt.id,
    organisationId: attempt.organisationId,
    studentId: attempt.studentId,
    session: persisted.session,
    questionMetaById: persisted.questionMetaById,
    report: persisted.report ?? null,
  };
}

async function persistAttemptState(params: {
  attemptId: string;
  session: AssessmentSession;
  questionMetaById: Record<string, PersistedQuestionMeta>;
  report?: AssessmentNarrativeReport | null;
}) {
  const asked = params.session.responses.length;
  const correct = params.session.responses.filter((r) => r.isCorrect).length;
  const score = asked > 0 ? correct / asked : null;

  await prisma.$executeRawUnsafe(
    `
      UPDATE "Attempt"
      SET
        "status" = $1::"AttemptStatus",
        "submittedAt" = $2,
        "score" = $3,
        "notes" = $4::jsonb
      WHERE "id" = $5
    `,
    params.session.isComplete ? AttemptStatus.SUBMITTED : AttemptStatus.STARTED,
    params.session.isComplete
      ? new Date(params.session.completedAt ?? new Date().toISOString())
      : null,
    score,
    JSON.stringify(
      asJson(serializeState(params.session, params.questionMetaById, params.report))
    ),
    params.attemptId
  );

  sessionStore.set(params.attemptId, params.session);
}

async function loadAssessmentChildContext(params: {
  studentId: string;
  childCurrentYear: number;
}) {
  const student = await prisma.student.findUnique({
    where: { id: params.studentId },
    select: {
      age: true,
      keyStage: true,
    },
  });

  return {
    age: student?.age ?? null,
    schoolYear: params.childCurrentYear,
    keyStage:
      student?.keyStage ??
      (params.childCurrentYear <= 2
        ? "KS1"
        : params.childCurrentYear <= 6
        ? "KS2"
        : params.childCurrentYear <= 9
        ? "KS3"
        : "KS4"),
  };
}

function markQuestionSkipped(
  session: AssessmentSession,
  questionId: string,
  reason: string,
  source: "llm" | "fallback"
) {
  if (!session.askedQuestionIds.includes(questionId)) {
    session.askedQuestionIds.push(questionId);
  }

  session.skippedQuestions = session.skippedQuestions ?? [];
  session.skippedQuestions.push({
    questionId,
    reason,
    source,
    skippedAt: new Date().toISOString(),
  });
}

async function presentQuestion(params: {
  studentId: string;
  session: AssessmentSession;
  questionMetaById: Record<string, PersistedQuestionMeta>;
}): Promise<PresentedAssessmentQuestion | null> {
  const child = await loadAssessmentChildContext({
    studentId: params.studentId,
    childCurrentYear: params.session.childCurrentYear,
  });

  while (true) {
    const question = getNextQuestion(params.session);

    if (!question) return null;

    const meta = params.questionMetaById[question.id];
    if (meta?.canonicalQuestionId) {
      const latest = await prisma.canonicalQuestion.findUnique({
        where: { id: meta.canonicalQuestionId },
        select: { contentJson: true },
      });

      if (latest?.contentJson && typeof latest.contentJson === "object") {
        question.contentJson = latest.contentJson as Record<string, unknown>;
      }
    }

    const wrapped = await reviewAndWrapAssessmentQuestion({
      child,
      question,
      canonical: {
        promptText: meta?.prompt ?? question.promptText,
        answerText: question.answerText,
        equation: meta?.canonicalEquation ?? null,
        operator: meta?.canonicalOperator ?? null,
        lhsA: meta?.lhsA ?? null,
        lhsB: meta?.lhsB ?? null,
        rhs: meta?.rhs ?? null,
      },
    });

    if (wrapped.decision === "skip") {
      markQuestionSkipped(
        params.session,
        question.id,
        wrapped.skipReason ?? "Wrapper review rejected the question.",
        wrapped.source
      );
      continue;
    }

    return {
      ...question,
      canonicalPromptText: meta?.prompt ?? question.promptText,
      displayPromptText: wrapped.displayPromptText,
      wrapperSource: wrapped.source,
    };
  }
}

function findQuestionOrThrow(
  session: AssessmentSession,
  questionId: string
): RuntimeQuestion {
  const question = session.questions.find((q) => q.id === questionId);

  if (!question) {
    throw new Error(`Question not found in session: ${questionId}`);
  }

  return question;
}

function assertQuestionHasNotAlreadyBeenAnswered(
  session: AssessmentSession,
  questionId: string
) {
  const alreadyAnswered =
    session.askedQuestionIds.includes(questionId) ||
    session.responses.some((r) => r.questionId === questionId);

  if (alreadyAnswered) {
    throw new Error(`Question already answered in this session: ${questionId}`);
  }
}

export async function startAssessment(params: {
  studentId: string;
  childCurrentYear: number;
  subject?: Subject;
}): Promise<{
  session: AssessmentSession;
  firstQuestion: PresentedAssessmentQuestion | null;
}> {
  const subject = params.subject ?? Subject.MATHS;
  const organisationId = await getDefaultOrganisationId();

  const student = await prisma.student.findFirst({
    where: {
      id: params.studentId,
      organisationId,
    },
    select: {
      id: true,
      organisationId: true,
      age: true,
      keyStage: true,
    },
  });

  if (!student) {
    throw new Error("Student not found for organisation.");
  }

  const { pool, questionMetaById } = await buildSubjectAssessmentPool(
    organisationId,
    params.childCurrentYear,
    subject
  );

  if (pool.length === 0) {
    throw new Error(`No ${subject.toLowerCase()} canonical questions available for assessment.`);
  }

  const session = createAssessmentSession({
    subject,
    childCurrentYear: params.childCurrentYear,
    questions: pool,
    maxQuestions: 25,
    extensionMaxQuestions: 30,
  });

  const attempt = await prisma.attempt.create({
    data: {
      organisationId,
      studentId: student.id,
      subject,
      taskType: TaskType.ASSESSMENT,
      assessmentContext: AssessmentContext.ASSESSED,
      status: AttemptStatus.STARTED,
      helpUsed: HelpLevel.NONE,
      notes: asJson({ initializing: true }),
    },
    select: { id: true },
  });

  session.sessionId = attempt.id;
  const firstQuestion = await presentQuestion({
    studentId: student.id,
    session,
    questionMetaById,
  });

  await persistAttemptState({
    attemptId: attempt.id,
    session,
    questionMetaById,
  });

  return {
    session,
    firstQuestion,
  };
}

export async function startMathsAssessment(params: {
  studentId: string;
  childCurrentYear: number;
}) {
  return startAssessment({ ...params, subject: Subject.MATHS });
}

export async function getAssessmentSession(
  sessionId: string
): Promise<{
  session: AssessmentSession;
  currentQuestion: PresentedAssessmentQuestion | null;
}> {
  const {
    attemptId,
    studentId,
    session,
    questionMetaById,
    report,
  } = await loadAttemptState(sessionId);

  const currentQuestion = session.isComplete
    ? null
    : await presentQuestion({
        studentId,
        session,
        questionMetaById,
      });

  if (currentQuestion) {
    await persistAttemptState({
      attemptId,
      session,
      questionMetaById,
      report,
    });
  }

  return { session, currentQuestion };
}

export async function reanalyzeMathsAssessmentAttempt(sessionId: string): Promise<{
  attemptId: string;
  studentId: string;
  before: {
    entryYear: number;
    overallWorkingBand: AssessmentSession["overallWorkingBand"];
    overallConfidence: number;
    completionReason?: AssessmentSession["completionReason"];
    score: number | null;
    responses: number;
    strands: AssessmentResult["strands"];
  };
  after: {
    entryYear: number;
    overallWorkingBand: AssessmentSession["overallWorkingBand"];
    overallConfidence: number;
    completionReason?: AssessmentSession["completionReason"];
    score: number | null;
    responses: number;
    strands: AssessmentResult["strands"];
  };
}> {
  const attempt = await prisma.attempt.findUnique({
    where: { id: sessionId },
    select: {
      id: true,
      studentId: true,
      score: true,
      notes: true,
    },
  });

  if (!attempt?.notes) {
    throw new Error(`Assessment session not found: ${sessionId}`);
  }

  const persisted = deserializeState(attempt.notes);
  const session = persisted.session;
  const beforeResult = buildAssessmentResult(session);

  recalculateAssessmentSession(session);

  await persistAttemptState({
    attemptId: attempt.id,
    session,
    questionMetaById: persisted.questionMetaById,
    report: persisted.report ?? null,
  });

  const afterResult = buildAssessmentResult(session);

  return {
    attemptId: attempt.id,
    studentId: attempt.studentId,
    before: {
      entryYear: session.entryYear,
      overallWorkingBand: beforeResult.overallWorkingBand,
      overallConfidence: beforeResult.overallConfidence,
      completionReason: beforeResult.completionReason,
      score: attempt.score ?? null,
      responses: session.responses.length,
      strands: beforeResult.strands,
    },
    after: {
      entryYear: session.entryYear,
      overallWorkingBand: afterResult.overallWorkingBand,
      overallConfidence: afterResult.overallConfidence,
      completionReason: afterResult.completionReason,
      score:
        session.responses.length > 0
          ? Number(
              (
                session.responses.filter((response) => response.isCorrect).length /
                session.responses.length
              ).toFixed(4)
            )
          : null,
      responses: session.responses.length,
      strands: afterResult.strands,
    },
  };
}

export async function answerAssessment(params: {
  sessionId: string;
  questionId: string;
  selectedChoiceKey?: string;
  selectedChoiceKeys?: string[];
  rawAnswer?: string;
  matchPairs?: AssessmentMatchPair[];
  orderedAnswers?: string[];
}): Promise<{
  isCorrect: boolean;
  correctAnswer: string;
  nextQuestion: PresentedAssessmentQuestion | null;
  isComplete: boolean;
  result?: AssessmentResult;
  session: AssessmentSession;
}> {
  const {
    attemptId,
    organisationId,
    studentId,
    session,
    questionMetaById,
    report: persistedReport,
  } = await loadAttemptState(params.sessionId);

  assertQuestionHasNotAlreadyBeenAnswered(session, params.questionId);

  const questionBeforeAnswer = findQuestionOrThrow(session, params.questionId);
  const meta = questionMetaById[params.questionId];
  const selectedChoice =
    params.selectedChoiceKey != null
      ? questionBeforeAnswer.choices.find(
          (choice) => choice.key === params.selectedChoiceKey
        ) ?? null
      : null;

  const outcome = submitAnswer(session, {
    questionId: params.questionId,
    selectedChoiceKey: params.selectedChoiceKey,
    selectedChoiceKeys: params.selectedChoiceKeys,
    rawAnswer: params.rawAnswer,
    matchPairs: params.matchPairs,
    orderedAnswers: params.orderedAnswers,
  });

  const nextQuestion = outcome.isComplete
    ? null
    : await presentQuestion({
        studentId,
        session,
        questionMetaById,
      });

  await prisma.attemptItem.create({
    data: {
      organisationId,
      attemptId,
      objectiveId: meta?.objectiveId ?? questionBeforeAnswer.objectiveId,
      strandId: meta?.strandId ?? null,
      strandLabel: meta?.strandLabel ?? questionBeforeAnswer.strand,
      canonicalQuestionId: meta?.canonicalQuestionId ?? questionBeforeAnswer.id,
      canonicalEquation: meta?.canonicalEquation ?? null,
      canonicalOperator:
        (meta?.canonicalOperator as
          | "ADD"
          | "SUBTRACT"
          | "MULTIPLY"
          | "DIVIDE"
          | "EQUALS"
          | null
          | undefined) ?? null,
      lhsA: meta?.lhsA ?? null,
      lhsB: meta?.lhsB ?? null,
      rhs: meta?.rhs ?? null,
      prompt: meta?.prompt ?? questionBeforeAnswer.promptText,
      type: meta?.type ?? "EQUATION",
      difficulty: meta?.difficulty ?? questionBeforeAnswer.difficulty,
      response: session.responses.at(-1)?.rawAnswer ?? selectedChoice?.label ?? "",
      isCorrect: outcome.isCorrect,
      score: outcome.isCorrect ? 1 : 0,
      errorTags: [],
      misconceptionCodes: [],
    },
  });

  let report = persistedReport ?? null;

  if (outcome.isComplete && outcome.result) {
    const student = await prisma.student.findUnique({
      where: { id: studentId },
      select: {
        firstName: true,
        lastName: true,
      },
    });

    const studentName =
      [student?.firstName, student?.lastName].filter(Boolean).join(" ") || "The learner";
    const questionMap = new Map(session.questions.map((question) => [question.id, question]));

    report = await buildAssessmentNarrativeReport({
      studentName,
      session,
      result: outcome.result,
      questions: session.responses.map((response) => {
        const question = questionMap.get(response.questionId);

        return {
          prompt: question?.promptText ?? response.questionId,
          response: response.rawAnswer,
          correctAnswer: question?.answerText ?? "",
          isCorrect: response.isCorrect,
          strand: response.strand,
          difficulty: response.difficulty,
          yearGroup: response.yearGroup,
        };
      }),
    });

    outcome.result.report = report;
  }

  await persistAttemptState({
    attemptId,
    session,
    questionMetaById,
    report,
  });

  return {
    ...outcome,
    nextQuestion,
    session,
  };
}

export async function answerMathsAssessment(params: {
  sessionId: string;
  questionId: string;
  selectedChoiceKey?: string;
  selectedChoiceKeys?: string[];
  rawAnswer?: string;
  matchPairs?: AssessmentMatchPair[];
  orderedAnswers?: string[];
}) {
  return answerAssessment(params);
}

export async function skipAssessmentQuestion(params: {
  sessionId: string;
  questionId: string;
}): Promise<{
  nextQuestion: PresentedAssessmentQuestion | null;
  isComplete: boolean;
  result?: AssessmentResult;
  session: AssessmentSession;
}> {
  const {
    attemptId,
    studentId,
    session,
    questionMetaById,
    report,
  } = await loadAttemptState(params.sessionId);

  assertQuestionHasNotAlreadyBeenAnswered(session, params.questionId);
  findQuestionOrThrow(session, params.questionId);

  markQuestionSkipped(
    session,
    params.questionId,
    "Learner skipped the question.",
    "fallback"
  );

  const nextQuestion = await presentQuestion({
    studentId,
    session,
    questionMetaById,
  });
  const result = session.isComplete ? buildAssessmentResult(session) : undefined;

  await persistAttemptState({
    attemptId,
    session,
    questionMetaById,
    report,
  });

  return {
    nextQuestion,
    isComplete: session.isComplete,
    result,
    session,
  };
}

export async function skipMathsAssessmentQuestion(params: {
  sessionId: string;
  questionId: string;
}) {
  return skipAssessmentQuestion(params);
}
