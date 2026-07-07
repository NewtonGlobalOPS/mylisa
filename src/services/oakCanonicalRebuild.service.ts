import crypto from "node:crypto";
import type {
  CanonicalItemType,
  DifficultyBand,
  KeyStage,
  Prisma,
  CanonicalItemStatus,
  Subject,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { oakGet } from "../lib/oakClient.js";
import { ensureOakSource } from "./oakSync.service.js";
import type { OakSubjectListItem } from "./oak.types.js";

type OakQuizAnswer = {
  type?: string;
  content?: unknown;
  distractor?: boolean;
  matchOption?: { type?: string; content?: unknown };
  correctChoice?: { type?: string; content?: unknown };
  order?: number;
};

type OakQuizQuestion = {
  question?: string;
  questionType?: string;
  text?: string;
  questionImage?: {
    url?: string;
    width?: number;
    height?: number;
    alt?: string;
  };
  answers?: OakQuizAnswer[];
};

type OakSequenceQuestion = {
  lessonTitle: string;
  lessonSlug: string;
  starterQuiz?: OakQuizQuestion[];
  exitQuiz?: OakQuizQuestion[];
};

type OakLessonQuiz = {
  starterQuiz?: OakQuizQuestion[];
  exitQuiz?: OakQuizQuestion[];
};

type OakUnitSummaryForCanonicals = {
  unitSlug: string;
  unitTitle: string;
  year?: number | string;
  subjectSlug?: string;
  keyStageSlug?: string;
  nationalCurriculumContent?: Array<string | Record<string, unknown>>;
  unitLessons?: Array<{
    lessonSlug?: string;
    lessonTitle?: string;
    lessonOrder?: number;
    state?: string;
  }>;
  lessons?: Array<{ lessonSlug?: string; lessonTitle?: string; state?: string }>;
};

type OakLessonSummaryForCanonicals = {
  lessonTitle?: string;
  pupilLessonOutcome?: string;
  keyLearningPoints?: Array<{ keyLearningPoint?: string }>;
  units?: Array<{ unitSlug?: string; unitTitle?: string }>;
};

type ObjectiveRow = {
  id: string;
  code: string;
  title: string;
  statement: string;
  strand: string;
  yearGroup: number | null;
  strandId: string | null;
};

type PendingCanonical = {
  objectiveId: string;
  strandId: string | null;
  strandLabel: string | null;
  itemType: CanonicalItemType;
  promptText: string;
  answerText: string;
  difficulty: DifficultyBand;
  contentJson: Prisma.InputJsonObject;
  generatorVersion: string;
  generatorMeta: Prisma.InputJsonObject;
  status: CanonicalItemStatus;
};

export type RebuildOakCanonicalsOptions = {
  subjectSlugs?: string[];
  apply?: boolean;
  replaceExisting?: boolean;
  maxUnits?: number;
  maxLessons?: number;
};

export type RebuildOakCanonicalsStats = {
  apply: boolean;
  replaceExisting: boolean;
  subjects: number;
  sequences: number;
  units: number;
  lessons: number;
  oakQuestionsSeen: number;
  canonicalQuestionsPrepared: number;
  canonicalQuestionsCreated: number;
  skippedNoObjective: number;
  skippedUnsupportedQuestion: number;
  skippedMultiCorrect: number;
  multiBlankCanonicalsPrepared: number;
  skippedNoAnswer: number;
  weakObjectiveMatches: number;
  errors: number;
};

const DEFAULT_SUBJECTS = ["english", "science", "computing", "maths"];
const GENERATOR_VERSION = "oak-canonical-v1";
const QUESTION_PAGE_LIMIT = Number(process.env.OAK_CANONICAL_PAGE_LIMIT ?? "100");
const SKIP_LESSON_SUMMARIES =
  process.env.OAK_CANONICAL_SKIP_LESSON_SUMMARIES === "1";
const KNOWN_SEQUENCE_SLUGS: Record<string, string[]> = {
  maths: ["maths-primary", "maths-secondary"],
};

function sha1(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function objectiveCode(
  subjectSlug: string,
  keyStageSlug: string,
  unitSlug: string,
  statement: string,
) {
  return `oak:${subjectSlug}:${keyStageSlug}:${unitSlug}:${sha1(statement)}`;
}

function contentHash(row: {
  organisationId: string;
  objectiveId: string;
  itemType: string;
  promptText: string;
  answerText: string;
  contentJson: unknown;
}) {
  return sha256(
    JSON.stringify({
      organisationId: row.organisationId,
      objectiveId: row.objectiveId,
      itemType: row.itemType,
      promptText: row.promptText,
      answerText: row.answerText,
      contentJson: row.contentJson,
    }),
  );
}

function normalizeSubjectSlug(value: string) {
  return String(value ?? "").trim().toLowerCase();
}

function resolveSubjectSlugs(input?: string[]) {
  const raw = input?.length
    ? input
    : String(process.env.OAK_CANONICAL_SUBJECTS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);
  const normalized = (raw.length ? raw : DEFAULT_SUBJECTS)
    .map(normalizeSubjectSlug)
    .filter((value) => DEFAULT_SUBJECTS.includes(value));
  return normalized.length ? [...new Set(normalized)] : DEFAULT_SUBJECTS;
}

function mapOakSubjectToEnum(subjectSlug: string): Subject {
  const s = normalizeSubjectSlug(subjectSlug);
  if (s === "maths" || s === "math") return "MATHS";
  if (s === "science") return "SCIENCE";
  if (s === "computing") return "COMPUTING";
  if (s === "english") return "ENGLISH";
  return "ENGLISH";
}

function mapOakKsToEnumKeyStage(oakKs: string): KeyStage {
  const ks = String(oakKs ?? "").toLowerCase();
  if (ks === "ks1") return "KS1";
  if (ks === "ks2") return "KS2";
  if (ks === "ks3") return "KS3";
  if (ks === "ks4") return "KS4";
  return "KS2";
}

function safeYearGroup(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function normalizeUnitsResponse(raw: any): Array<{ units: any[] }> {
  const out: Array<{ units: any[] }> = [];
  const walk = (value: any) => {
    if (!value) return;
    if (Array.isArray(value)) {
      if (value.every((item) => item && Array.isArray(item.units))) {
        for (const item of value) walk(item);
      } else if (
        value.every(
          (item) =>
            item &&
            typeof item === "object" &&
            ("unitSlug" in item || "slug" in item),
        )
      ) {
        out.push({ units: value });
      } else {
        for (const item of value) walk(item);
      }
      return;
    }
    if (typeof value !== "object") return;
    if (Array.isArray(value.units)) out.push({ units: value.units });
    for (const key of ["tiers", "examSubjects", "years"]) {
      if (Array.isArray(value[key])) {
        for (const item of value[key]) walk(item);
      }
    }
  };
  walk(raw);
  return out;
}

function normalizeUnitItem(raw: any) {
  return {
    unitSlug:
      typeof raw?.unitSlug === "string"
        ? raw.unitSlug
        : typeof raw?.slug === "string"
          ? raw.slug
          : null,
    unitTitle:
      typeof raw?.unitTitle === "string"
        ? raw.unitTitle
        : typeof raw?.title === "string"
          ? raw.title
          : null,
  };
}

async function fetchAllSequenceQuestions(sequenceSlug: string) {
  const out: OakSequenceQuestion[] = [];
  const limit =
    Number.isFinite(QUESTION_PAGE_LIMIT) && QUESTION_PAGE_LIMIT > 0
      ? QUESTION_PAGE_LIMIT
      : 100;

  for (let offset = 0; ; offset += limit) {
    console.log(`[oak-canonical]   questions page sequence=${sequenceSlug} offset=${offset}`);
    const page = await oakGet<OakSequenceQuestion[]>(
      `/sequences/${sequenceSlug}/questions`,
      { query: { limit, offset } },
    );
    if (!Array.isArray(page) || page.length === 0) break;
    out.push(...page);
    if (page.length < limit) break;
  }

  return out;
}

async function fetchLessonQuiz(
  lessonSlug: string,
  lessonTitle?: string,
): Promise<OakSequenceQuestion | null> {
  try {
    const quiz = await oakGet<OakLessonQuiz>(`/lessons/${lessonSlug}/quiz`);
    const starterQuiz = Array.isArray(quiz.starterQuiz) ? quiz.starterQuiz : [];
    const exitQuiz = Array.isArray(quiz.exitQuiz) ? quiz.exitQuiz : [];
    if (starterQuiz.length === 0 && exitQuiz.length === 0) return null;

    return {
      lessonSlug,
      lessonTitle: lessonTitle ?? lessonSlug,
      starterQuiz,
      exitQuiz,
    };
  } catch (error: any) {
    console.warn(
      `[oak-canonical]   lesson quiz failed lesson=${lessonSlug} ${error?.message ?? error}`,
    );
    return null;
  }
}

function extractStatements(unit: OakUnitSummaryForCanonicals): string[] {
  const raw = Array.isArray(unit.nationalCurriculumContent)
    ? unit.nationalCurriculumContent
    : [];
  const seen = new Set<string>();
  const out: string[] = [];

  for (const item of raw) {
    const text =
      typeof item === "string"
        ? item
        : String(
            item.statement ??
              item.content ??
              item.description ??
              item.text ??
              item.title ??
              "",
          );
    const clean = text.trim();
    const key = clean.toLowerCase();
    if (!clean || seen.has(key)) continue;
    seen.add(key);
    out.push(clean);
  }

  return out;
}

function extractUnitLessons(unit: OakUnitSummaryForCanonicals) {
  const raw = Array.isArray(unit.unitLessons)
    ? unit.unitLessons
    : Array.isArray(unit.lessons)
      ? unit.lessons
      : [];
  return raw
    .filter((lesson) => lesson?.lessonSlug)
    .filter(
      (lesson) => !lesson.state || String(lesson.state).toLowerCase() === "published",
    )
    .map((lesson) => ({
      lessonSlug: String(lesson.lessonSlug),
      lessonTitle: String(lesson.lessonTitle ?? ""),
    }));
}

function answerContent(answer: OakQuizAnswer | undefined) {
  return contentLabel(answer?.content);
}

function contentLabel(content: unknown) {
  if (content && typeof content === "object") {
    const raw = content as Record<string, unknown>;
    return String(raw.text ?? raw.label ?? raw.alt ?? raw.url ?? JSON.stringify(content)).trim();
  }
  return String(content ?? "").trim();
}

function nestedContent(value: { content?: unknown } | undefined) {
  return contentLabel(value?.content);
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
    .replace(/(\d+)\s*\{\s*([^{}]+?)\s+\\?over\s+\{?([^{}]+?)\}?\s*\}/g, "$1 $2/$3")
    .replace(/\{\s*([^{}]+?)\s+\\?over\s+\{?([^{}]+?)\}?\s*\}/g, "$1/$2")
    .replace(/\{\s*([^{}]+?)\s*\}\s*\\?over\s*\{\s*([^{}]+?)\s*\}/g, "$1/$2")
    .replace(/((?=[^{}\s]*\d)[^{}\s]+)\s+\\?over\s+((?=[^{}\s]*\d)[^{}\s]+)/g, "$1/$2")
    .replace(/(\d+)\{(\d+\/\d+)\}/g, "$1 $2")
    .replace(/\\times/g, "x")
    .replace(/\\div/g, "/")
    .replace(/\\le/g, "<=")
    .replace(/\\ge/g, ">=")
    .replace(/\\not=/g, "!=")
    .replace(/\s+/g, " ")
    .trim();
}

function promptWithSupplement(question: OakQuizQuestion) {
  const prompt = String(question.question ?? "").trim();
  const supplement = String(question.text ?? "").trim();
  return formatOakText([prompt, supplement].filter(Boolean).join("\n\n").trim());
}

function oakItemType(questionType: string): CanonicalItemType | null {
  const type = questionType.trim().toLowerCase();
  if (type === "multiple-choice") return "OAK_MULTIPLE_CHOICE" as CanonicalItemType;
  if (type === "short-answer") return "OAK_SHORT_ANSWER" as CanonicalItemType;
  if (type === "match") return "OAK_MATCH" as CanonicalItemType;
  if (type === "order") return "OAK_ORDER" as CanonicalItemType;
  return null;
}

function answerContractForItemType(itemType: CanonicalItemType) {
  if (itemType === ("OAK_MULTIPLE_CHOICE" as CanonicalItemType)) return "single_choice";
  if (itemType === ("OAK_MULTI_BLANK_CHOICE" as CanonicalItemType))
    return "multi_blank_choice";
  if (itemType === ("OAK_SHORT_ANSWER" as CanonicalItemType))
    return "short_answer_alias";
  if (itemType === ("OAK_MATCH" as CanonicalItemType)) return "match_pairs";
  if (itemType === ("OAK_ORDER" as CanonicalItemType)) return "ordered_sequence";
  return "unknown";
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

function buildCanonicalFromOakQuestion(input: {
  question: OakQuizQuestion;
  quizSection: "starterQuiz" | "exitQuiz";
  lessonSlug: string;
  lessonTitle: string;
  unitSlug: string;
  unitTitle: string;
  objectiveMatchScore: number;
  allUnitObjectives: ObjectiveRow[];
}): Omit<PendingCanonical, "objectiveId" | "strandId" | "strandLabel"> | null {
  const promptText = promptWithSupplement(input.question);
  const questionType = String(input.question.questionType ?? "").trim();
  let itemType = oakItemType(questionType);
  const answers = Array.isArray(input.question.answers) ? input.question.answers : [];

  if (!promptText || !itemType) return null;

  let answerText = "";
  let choices: Array<{ label: string; isCorrect: boolean }> | undefined;
  let correctAnswers: string[] = [];
  let distractors: string[] = [];
  let optionBank: string[] = [];
  let matchPairs: Array<{ left: string; right: string }> | undefined;
  let orderedAnswers: string[] | undefined;

  if (questionType === "multiple-choice") {
    choices = answers
      .map((answer) => ({
        label: answerContent(answer),
        isCorrect: answer.distractor === false,
      }))
      .filter((choice) => choice.label);
    const correct = choices.filter((choice) => choice.isCorrect);
    if (correct.length === 0) return null;
    correctAnswers = correct.map((choice) => choice.label);
    distractors = choices
      .filter((choice) => !choice.isCorrect)
      .map((choice) => choice.label);
    optionBank = choices.map((choice) => choice.label);
    if (correctAnswers.length > 1) {
      itemType = "OAK_MULTI_BLANK_CHOICE" as CanonicalItemType;
      answerText = correctAnswers.join(" | ");
    } else {
      answerText = correctAnswers[0]!;
    }
  } else if (questionType === "short-answer") {
    correctAnswers = answers.map(answerContent).filter(Boolean);
    optionBank = correctAnswers;
    answerText = correctAnswers.join(" / ");
  } else if (questionType === "match") {
    matchPairs = answers
      .map((answer) => {
        const left = nestedContent(answer.matchOption);
        const right = nestedContent(answer.correctChoice);
        return left && right ? { left, right } : null;
      })
      .filter((pair): pair is { left: string; right: string } => pair !== null);
    correctAnswers = matchPairs.map((pair) => `${pair.left} -> ${pair.right}`);
    optionBank = matchPairs.flatMap((pair) => [pair.left, pair.right]);
    answerText = correctAnswers.join("; ");
  } else if (questionType === "order") {
    orderedAnswers = [...answers]
      .filter((answer) => typeof answer.order === "number" && answerContent(answer))
      .sort((a, b) => Number(a.order) - Number(b.order))
      .map(answerContent);
    correctAnswers = orderedAnswers;
    optionBank = [...answers].map(answerContent).filter(Boolean);
    answerText = orderedAnswers.join(" -> ");
  }

  if (!answerText.trim()) return null;

  const contract = answerContractForItemType(itemType);
  const canonicalTruth = buildCanonicalTruth({
    itemType,
    originalQuestion: promptText,
    correctAnswers,
    distractors,
    optionBank,
    matchPairs,
    orderedAnswers,
  });

  return {
    itemType,
    promptText,
    answerText,
    difficulty: input.quizSection === "starterQuiz" ? "EASY" : "MEDIUM",
    contentJson: {
      answerContract: contract,
      canonicalTruth,
      rubric: buildRubric({ contract, correctAnswers, distractors }),
      renderPolicy: buildRenderPolicy({ contract, correctAnswers }),
      vectorText: buildVectorText({
        originalQuestion: promptText,
        lessonTitle: input.lessonTitle,
        unitTitle: input.unitTitle,
        correctAnswers,
        distractors,
      }),
      oak: {
        source: "oak",
        questionType,
        derivedQuestionType: contract,
        quizSection: input.quizSection,
        lessonSlug: input.lessonSlug,
        lessonTitle: input.lessonTitle,
        unitSlug: input.unitSlug,
        unitTitle: input.unitTitle,
        objectiveMatchScore: input.objectiveMatchScore,
        unitObjectiveCodes: input.allUnitObjectives.map((objective) => objective.code),
        questionImage: input.question.questionImage ?? null,
        choices,
        rawAnswers: JSON.parse(JSON.stringify(answers)) as Prisma.InputJsonValue,
      },
    },
    generatorVersion: GENERATOR_VERSION,
    generatorMeta: {
      source: "oak",
      lessonSlug: input.lessonSlug,
      unitSlug: input.unitSlug,
      quizSection: input.quizSection,
    },
    status:
      itemType === ("OAK_MULTI_BLANK_CHOICE" as CanonicalItemType)
        ? "ACTIVE"
        : "ACTIVE",
  };
}

function tokenize(value: string) {
  return new Set(
    value
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 3),
  );
}

function scoreObjective(objective: ObjectiveRow, haystack: string) {
  const hay = tokenize(haystack);
  if (!hay.size) return 0;
  const objectiveTokens = tokenize(
    [objective.title, objective.statement, objective.strand].join(" "),
  );
  let score = 0;
  for (const token of objectiveTokens) {
    if (hay.has(token)) score++;
  }
  return score;
}

function chooseObjective(
  objectives: ObjectiveRow[],
  lessonSummary: OakLessonSummaryForCanonicals | null,
  quiz: OakSequenceQuestion | undefined,
) {
  if (objectives.length <= 1) {
    return { objective: objectives[0] ?? null, score: objectives.length ? 999 : 0 };
  }

  const learningPoints = Array.isArray(lessonSummary?.keyLearningPoints)
    ? lessonSummary.keyLearningPoints
        .map((point) => point.keyLearningPoint ?? "")
        .join(" ")
    : "";
  const quizText = [...(quiz?.starterQuiz ?? []), ...(quiz?.exitQuiz ?? [])]
    .map((question) => question.question ?? "")
    .join(" ");
  const haystack = [
    lessonSummary?.lessonTitle ?? quiz?.lessonTitle ?? "",
    lessonSummary?.pupilLessonOutcome ?? "",
    learningPoints,
    quizText,
  ].join(" ");

  const scored = objectives
    .map((objective) => ({ objective, score: scoreObjective(objective, haystack) }))
    .sort((a, b) => b.score - a.score || a.objective.code.localeCompare(b.objective.code));

  return scored[0] ?? { objective: null, score: 0 };
}

async function upsertUnitObjectives(input: {
  organisationId: string;
  sourceId: string;
  unit: OakUnitSummaryForCanonicals;
  fallbackUnitTitle: string;
  fallbackSubjectSlug: string;
}) {
  const subjectSlug = String(input.unit.subjectSlug ?? input.fallbackSubjectSlug);
  const keyStageSlug = String(input.unit.keyStageSlug ?? "");
  const unitSlug = String(input.unit.unitSlug);
  const yearGroup = safeYearGroup(input.unit.year);
  const subject = mapOakSubjectToEnum(subjectSlug);
  const keyStage = mapOakKsToEnumKeyStage(keyStageSlug);
  const strand = input.unit.unitTitle ?? input.fallbackUnitTitle ?? "Oak Unit";
  const statements = extractStatements(input.unit);
  const rows: ObjectiveRow[] = [];

  for (const statement of statements) {
    const code = objectiveCode(subjectSlug, keyStageSlug, unitSlug, statement);
    const objective = await prisma.curriculumObjective.upsert({
      where: {
        organisationId_code: {
          organisationId: input.organisationId,
          code,
        },
      },
      update: {
        organisationId: input.organisationId,
        subject,
        keyStage,
        yearGroup,
        strand,
        title: statement.slice(0, 160),
        statement,
        statutory: true,
        keywords: ["oak", subjectSlug, keyStageSlug].filter(Boolean),
        sourceId: input.sourceId,
        isActive: true,
      },
      create: {
        organisationId: input.organisationId,
        code,
        subject,
        keyStage,
        yearGroup,
        strand,
        title: statement.slice(0, 160),
        statement,
        statutory: true,
        keywords: ["oak", subjectSlug, keyStageSlug].filter(Boolean),
        sourceId: input.sourceId,
        isActive: true,
      },
      select: {
        id: true,
        code: true,
        title: true,
        statement: true,
        strand: true,
        yearGroup: true,
        strandId: true,
      },
    });
    rows.push(objective);
  }

  return rows;
}

function dedupePending(rows: PendingCanonical[]) {
  const seen = new Set<string>();
  const out: PendingCanonical[] = [];
  for (const row of rows) {
    const key = [
      row.objectiveId,
      row.itemType,
      row.promptText.trim().toLowerCase(),
      row.answerText.trim().toLowerCase(),
    ].join("|");
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(row);
  }
  return out;
}

async function createCanonicalRows(input: {
  organisationId: string;
  rows: PendingCanonical[];
}) {
  const byObjective = new Map<string, PendingCanonical[]>();
  for (const row of dedupePending(input.rows)) {
    const bucket = byObjective.get(row.objectiveId) ?? [];
    bucket.push(row);
    byObjective.set(row.objectiveId, bucket);
  }

  let created = 0;
  for (const [objectiveId, rows] of byObjective) {
    const existingMax = await prisma.canonicalQuestion.aggregate({
      where: { objectiveId },
      _max: { sequence: true },
    });
    const start = existingMax._max.sequence ?? 0;
    const data = rows.map((row, index) => {
      const sequence = start + index + 1;
      const createRow = {
        organisationId: input.organisationId,
        objectiveId: row.objectiveId,
        strandId: row.strandId,
        strandLabel: row.strandLabel,
        itemType: row.itemType,
        promptText: row.promptText,
        answerText: row.answerText,
        contentJson: row.contentJson,
        sequence,
        difficulty: row.difficulty,
        isGenerated: false,
        generatorVersion: row.generatorVersion,
        generatorMeta: row.generatorMeta,
        status: row.status,
      };
      return {
        ...createRow,
        contentSha256: contentHash(createRow),
      };
    });

    const result = await prisma.canonicalQuestion.createMany({
      data,
      skipDuplicates: true,
    });
    created += result.count;
  }
  return created;
}

export async function rebuildOakCanonicals(
  options: RebuildOakCanonicalsOptions = {},
): Promise<RebuildOakCanonicalsStats> {
  const apply = options.apply ?? process.env.OAK_CANONICAL_APPLY === "1";
  const replaceExisting =
    options.replaceExisting ?? process.env.OAK_CANONICAL_REPLACE === "1";
  const subjectSlugs = resolveSubjectSlugs(options.subjectSlugs);
  const maxUnits = options.maxUnits ?? Number(process.env.OAK_CANONICAL_MAX_UNITS || 0);
  const maxLessons =
    options.maxLessons ?? Number(process.env.OAK_CANONICAL_MAX_LESSONS || 0);
  const source = await ensureOakSource();
  const selectedSubjects: OakSubjectListItem[] = subjectSlugs.every(
    (subjectSlug) => KNOWN_SEQUENCE_SLUGS[subjectSlug],
  )
    ? subjectSlugs.map((subjectSlug) => ({
        subjectTitle: subjectSlug,
        subjectSlug,
        sequenceSlugs: KNOWN_SEQUENCE_SLUGS[subjectSlug].map((sequenceSlug) => ({
          sequenceSlug,
          years: [],
          keyStages: [],
          phaseSlug: "",
          phaseTitle: "",
          ks4Options: null,
        })),
      }))
    : (await oakGet<OakSubjectListItem[]>("/subjects")).filter((subject) =>
        subjectSlugs.includes(subject.subjectSlug),
      );

  const stats: RebuildOakCanonicalsStats = {
    apply,
    replaceExisting,
    subjects: 0,
    sequences: 0,
    units: 0,
    lessons: 0,
    oakQuestionsSeen: 0,
    canonicalQuestionsPrepared: 0,
    canonicalQuestionsCreated: 0,
    skippedNoObjective: 0,
    skippedUnsupportedQuestion: 0,
    skippedMultiCorrect: 0,
    multiBlankCanonicalsPrepared: 0,
    skippedNoAnswer: 0,
    weakObjectiveMatches: 0,
    errors: 0,
  };

  if (apply && replaceExisting) {
    const subjectEnums = subjectSlugs.map(mapOakSubjectToEnum);
    const deleted = await prisma.canonicalQuestion.deleteMany({
      where: {
        objective: {
          subject: { in: subjectEnums },
          source: { slug: "oak" },
          organisationId: source.organisationId,
        },
      },
    });
    console.log(`[oak-canonical] deleted existing Oak canonical rows=${deleted.count}`);
  }

  const pending: PendingCanonical[] = [];
  let unitCounter = 0;
  let lessonCounter = 0;
  const stopStartingUnits = () => maxUnits > 0 && unitCounter >= maxUnits;
  const stopStartingLessons = () => maxLessons > 0 && lessonCounter >= maxLessons;
  const stopFetchingMoreSequences = () => stopStartingUnits() || stopStartingLessons();

  for (const subject of selectedSubjects) {
    if (stopFetchingMoreSequences()) break;
    stats.subjects++;
    console.log(`[oak-canonical] subject=${subject.subjectSlug}`);

    for (const sequence of subject.sequenceSlugs) {
      if (stopFetchingMoreSequences()) break;
      stats.sequences++;
      console.log(`[oak-canonical]  sequence=${sequence.sequenceSlug}`);
      const [unitsRaw, questionsRaw] = await Promise.all([
        oakGet<any>(`/sequences/${sequence.sequenceSlug}/units`),
        fetchAllSequenceQuestions(sequence.sequenceSlug),
      ]);
      const questionsByLesson = new Map(
        questionsRaw.map((question) => [question.lessonSlug, question]),
      );
      const unitGroups = normalizeUnitsResponse(unitsRaw);

      for (const group of unitGroups) {
        if (stopStartingUnits()) break;
        for (const rawUnit of group.units) {
          if (stopStartingUnits()) break;
          const unitItem = normalizeUnitItem(rawUnit);
          if (!unitItem.unitSlug) continue;
          unitCounter++;
          stats.units++;
          console.log(
            `[oak-canonical]   unit ${unitCounter} slug=${unitItem.unitSlug}`,
          );

          let unit: OakUnitSummaryForCanonicals;
          try {
            unit = await oakGet<OakUnitSummaryForCanonicals>(
              `/units/${unitItem.unitSlug}/summary`,
            );
          } catch (error: any) {
            stats.errors++;
            console.warn(
              `[oak-canonical]   unit failed unit=${unitItem.unitSlug} ${error?.message ?? error}`,
            );
            continue;
          }

          const objectives = await upsertUnitObjectives({
            organisationId: source.organisationId,
            sourceId: source.id,
            unit,
            fallbackUnitTitle: unitItem.unitTitle ?? "Oak Unit",
            fallbackSubjectSlug: subject.subjectSlug,
          });
          if (!objectives.length) {
            stats.skippedNoObjective++;
            continue;
          }

          for (const lesson of extractUnitLessons(unit)) {
            if (stopStartingLessons()) break;
            const sequenceQuiz = questionsByLesson.get(lesson.lessonSlug);
            const sequenceQuizCount =
              (sequenceQuiz?.starterQuiz?.length ?? 0) +
              (sequenceQuiz?.exitQuiz?.length ?? 0);
            const quiz =
              sequenceQuizCount > 0
                ? sequenceQuiz
                : await fetchLessonQuiz(
                    lesson.lessonSlug,
                    lesson.lessonTitle ?? sequenceQuiz?.lessonTitle,
                  );
            if (!quiz) continue;
            lessonCounter++;
            stats.lessons++;
            if (lessonCounter % 25 === 0) {
              console.log(`[oak-canonical]   lessons processed=${lessonCounter}`);
            }

            let lessonSummary: OakLessonSummaryForCanonicals | null = null;
            if (!SKIP_LESSON_SUMMARIES) {
              try {
                lessonSummary = await oakGet<OakLessonSummaryForCanonicals>(
                  `/lessons/${lesson.lessonSlug}/summary`,
                );
              } catch {
                lessonSummary = null;
              }
            }

            const match = chooseObjective(objectives, lessonSummary, quiz);
            if (!match.objective) {
              stats.skippedNoObjective++;
              continue;
            }
            if (match.score === 0) stats.weakObjectiveMatches++;

            for (const quizSection of ["starterQuiz", "exitQuiz"] as const) {
              for (const question of quiz[quizSection] ?? []) {
                stats.oakQuestionsSeen++;
                const questionType = String(question.questionType ?? "").trim();

                const canonical = buildCanonicalFromOakQuestion({
                  question,
                  quizSection,
                  lessonSlug: lesson.lessonSlug,
                  lessonTitle:
                    lessonSummary?.lessonTitle ?? quiz.lessonTitle ?? lesson.lessonTitle,
                  unitSlug: unit.unitSlug,
                  unitTitle: unit.unitTitle,
                  objectiveMatchScore: match.score,
                  allUnitObjectives: objectives,
                });

                if (!canonical) {
                  if (!oakItemType(questionType)) stats.skippedUnsupportedQuestion++;
                  else stats.skippedNoAnswer++;
                  continue;
                }

                pending.push({
                  ...canonical,
                  objectiveId: match.objective.id,
                  strandId: match.objective.strandId,
                  strandLabel: match.objective.strand,
                });
                stats.canonicalQuestionsPrepared++;
                if (
                  canonical.itemType ===
                  ("OAK_MULTI_BLANK_CHOICE" as CanonicalItemType)
                ) {
                  stats.multiBlankCanonicalsPrepared++;
                }
              }
            }
          }
        }
      }
    }
  }

  if (apply) {
    stats.canonicalQuestionsCreated = await createCanonicalRows({
      organisationId: source.organisationId,
      rows: pending,
    });
  }

  return stats;
}
