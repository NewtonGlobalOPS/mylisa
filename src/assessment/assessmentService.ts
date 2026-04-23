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
  AssessmentResult,
  AssessmentSession,
  RuntimeQuestion,
  buildRuntimeQuestionPool,
  createAssessmentSession,
  ensureMultipleChoiceQuestion,
  getNextQuestion,
  recalculateAssessmentSession,
  submitAnswer,
  buildAssessmentResult,
} from "./assessmentEngine.js";
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
  version: 2;
  session: AssessmentSession;
  questionMetaById: Record<string, PersistedQuestionMeta>;
};

const sessionStore = new Map<string, AssessmentSession>();

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
  questionMetaById: Record<string, PersistedQuestionMeta>
): PersistedAssessmentState {
  return {
    version: 2,
    session: cloneSession(session),
    questionMetaById,
  };
}

function deserializeState(notes: Prisma.JsonValue): PersistedAssessmentState {
  const raw = notes as PersistedAssessmentState | null;

  if (!raw || typeof raw !== "object" || !("session" in raw)) {
    throw new Error("Persisted assessment state is missing or invalid.");
  }

  return {
    version: 2,
    session: {
      ...raw.session,
      questions: (raw.session.questions ?? []).map((question) =>
        ensureMultipleChoiceQuestion(question)
      ),
      currentBandYear: raw.session.currentBandYear ?? raw.session.entryYear,
      minimumBandYear:
        raw.session.minimumBandYear ?? Math.max(1, raw.session.entryYear - 2),
      bandStartedAtResponseCount: raw.session.bandStartedAtResponseCount ?? 0,
      skippedQuestions: raw.session.skippedQuestions ?? [],
    },
    questionMetaById: raw.questionMetaById ?? {},
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
        (row.objective.yearGroup ?? 999) < (existing.objective.yearGroup ?? 999)) ||
      (incomingRank === existingRank &&
        (row.objective.yearGroup ?? 999) === (existing.objective.yearGroup ?? 999) &&
        row.id < existing.id);

    if (shouldReplace) {
      bySignature.set(signature, row);
    }
  }

  return Array.from(bySignature.values());
}

async function buildMathsAssessmentPool(
  organisationId: string,
  childCurrentYear: number
) {
  const minYear = 1;
  const maxYear = childCurrentYear + 1;

  const rawRows = await prisma.canonicalQuestion.findMany({
    where: {
      organisationId,
      status: "ACTIVE",
      objective: {
        subject: Subject.MATHS,
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
  };
}

async function persistAttemptState(params: {
  attemptId: string;
  session: AssessmentSession;
  questionMetaById: Record<string, PersistedQuestionMeta>;
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
    JSON.stringify(asJson(serializeState(params.session, params.questionMetaById))),
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

export async function startMathsAssessment(params: {
  studentId: string;
  childCurrentYear: number;
}): Promise<{
  session: AssessmentSession;
  firstQuestion: PresentedAssessmentQuestion | null;
}> {
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

  const { pool, questionMetaById } = await buildMathsAssessmentPool(
    organisationId,
    params.childCurrentYear
  );

  if (pool.length === 0) {
    throw new Error("No maths canonical questions available for assessment.");
  }

  const session = createAssessmentSession({
    childCurrentYear: params.childCurrentYear,
    questions: pool,
    maxQuestions: 25,
    extensionMaxQuestions: 30,
  });

  const attempt = await prisma.attempt.create({
    data: {
      organisationId,
      studentId: student.id,
      subject: Subject.MATHS,
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

export async function getAssessmentSession(
  sessionId: string
): Promise<AssessmentSession> {
  const { session } = await loadAttemptState(sessionId);
  return session;
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

export async function answerMathsAssessment(params: {
  sessionId: string;
  questionId: string;
  selectedChoiceKey: "A" | "B" | "C" | "D";
}): Promise<{
  isCorrect: boolean;
  correctAnswer: string;
  nextQuestion: PresentedAssessmentQuestion | null;
  isComplete: boolean;
  result?: AssessmentResult;
  session: AssessmentSession;
}> {
  const { attemptId, organisationId, studentId, session, questionMetaById } =
    await loadAttemptState(params.sessionId);

  assertQuestionHasNotAlreadyBeenAnswered(session, params.questionId);

  const questionBeforeAnswer = findQuestionOrThrow(session, params.questionId);
  const meta = questionMetaById[params.questionId];
  const selectedChoice =
    questionBeforeAnswer.choices.find(
      (choice) => choice.key === params.selectedChoiceKey
    ) ?? null;

  const outcome = submitAnswer(session, {
    questionId: params.questionId,
    selectedChoiceKey: params.selectedChoiceKey,
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
      response: selectedChoice?.label ?? params.selectedChoiceKey,
      isCorrect: outcome.isCorrect,
      score: outcome.isCorrect ? 1 : 0,
      errorTags: [],
      misconceptionCodes: [],
    },
  });

  await persistAttemptState({
    attemptId,
    session,
    questionMetaById,
  });

  return {
    ...outcome,
    nextQuestion,
    session,
  };
}
