import type { CanonicalItemType, ChunkType, DifficultyBand, KeyStage, Subject } from "@prisma/client";
import crypto from "node:crypto";
import { prisma } from "../lib/prisma.js";

type LessonObjectiveEvidence = {
  id: string;
  code: string;
  subject: Subject;
  keyStage: KeyStage;
  yearGroup: number | null;
  strand: string;
  title: string;
  statement: string;
  keywords: string[];
  score: number;
  matchReason: string;
  contentChunkCount: number;
  canonicalQuestionCount: number;
};

type LessonChunkEvidence = {
  id: string;
  type: ChunkType;
  difficulty: DifficultyBand;
  content: string;
  excerpt: string;
  citations: string[];
  tags: string[];
  objectiveId: string | null;
  objectiveCode: string | null;
  objectiveTitle: string | null;
  strand: string | null;
  yearGroup: number | null;
};

type LessonQuestionEvidence = {
  id: string;
  sequence: number;
  itemType: CanonicalItemType;
  difficulty: DifficultyBand;
  promptText: string;
  answerText: string;
  objectiveId: string;
  objectiveCode: string;
  objectiveTitle: string;
  strand: string;
  yearGroup: number | null;
};

export type BespokeLessonGuide = {
  title: string;
  topic: string;
  subject: Subject;
  keyStage: KeyStage | null;
  yearGroup: number | null;
  overview: string;
  learningObjectives: string[];
  keyVocabulary: Array<{ term: string; meaning: string }>;
  lessonSections: Array<{
    title: string;
    durationMinutes: number;
    teacherActions: string[];
    studentActions: string[];
    workedExample?: {
      problem: string;
      steps: string[];
      answer: string;
    };
  }>;
  practice: Array<{
    prompt: string;
    answer: string;
    sourceQuestionId?: string;
  }>;
  checksForUnderstanding: string[];
  misconceptions: Array<{
    misconception: string;
    repair: string;
  }>;
  stretch: string[];
  resources: string[];
};

export type BespokeLessonBuildResult = {
  source: "llm" | "fallback";
  fallbackReason?: string;
  retrieval: {
    topic: string;
    objectiveCount: number;
    chunkCount: number;
    questionCount: number;
    objectives: LessonObjectiveEvidence[];
    chunks: LessonChunkEvidence[];
    questions: LessonQuestionEvidence[];
  };
  guide: BespokeLessonGuide;
};

export type BespokeSectionContent = {
  source: "llm" | "fallback";
  fallbackReason?: string;
  title: string;
  sectionTitle: string;
  durationMinutes: number;
  tutorScript: string[];
  boardContent: string[];
  workedExample?: {
    problem: string;
    steps: string[];
    answer: string;
  };
  guidedPractice: Array<{
    prompt: string;
    answer: string;
  }>;
  checksForUnderstanding: string[];
  supportPrompts: string[];
  stretchPrompt: string;
  exitTicket: {
    prompt: string;
    answer: string;
  };
};

type BuildBespokeLessonInput = {
  topic: string;
  subject?: Subject;
  keyStage?: KeyStage;
  yearGroup?: number;
  domain?: string;
  maxObjectives?: number;
};

type GenerateBespokeSectionContentInput = {
  topic: string;
  subject?: Subject;
  keyStage?: KeyStage | null;
  yearGroup?: number | null;
  guideTitle?: string;
  section: BespokeLessonGuide["lessonSections"][number];
  objectives?: Array<Pick<LessonObjectiveEvidence, "code" | "title" | "statement" | "strand" | "keyStage" | "yearGroup">>;
  questions?: Array<{
    id: string;
    promptText: string;
    answerText: string;
    difficulty: string;
    objectiveCode: string;
  }>;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

class LlmUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmUnavailableError";
  }
}

class LlmGenerationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LlmGenerationError";
  }
}

function isLlmUnavailableError(error: unknown): error is LlmUnavailableError {
  return error instanceof LlmUnavailableError;
}

function normaliseTopicLanguage(value: string | null | undefined): string {
  return clean(value)
    .toLowerCase()
    .replace(/pythagor(?:us|ous|as)?/g, "pythagoras")
    .replace(/theory/g, "theorem")
    .replace(/\bn\s*th\b/g, "nth")
    .replace(/\bnth\s*[- ]?\s*terms?\b/g, "nth term sequence position term")
    .replace(/\bposition\s*[- ]?\s*to\s*[- ]?\s*terms?\b/g, "position term sequence rule")
    .replace(/\bterm\s*[- ]?\s*to\s*[- ]?\s*terms?\b/g, "term term sequence rule")
    .replace(/\bsequences?\b/g, "sequence")
    .replace(/\btimes?\s*[- ]?\s*tables?\b/g, "times table multiplication tables multiplication facts")
    .replace(/\btimestables?\b/g, "times table multiplication tables multiplication facts")
    .replace(/\bx\s*[- ]?\s*tables?\b/g, "times table multiplication tables multiplication facts")
    .replace(/\btables?\s*[- ]?\s*facts?\b/g, "times table multiplication facts");
}

function tokenise(value: string | null | undefined): string[] {
  const stopWords = new Set([
    "and",
    "for",
    "from",
    "into",
    "the",
    "then",
    "this",
    "that",
    "with",
  ]);
  return normaliseTopicLanguage(value)
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3 && !stopWords.has(token));
}

function unique<T>(items: T[]): T[] {
  return Array.from(new Set(items));
}

function topicTokens(topic: string): string[] {
  const base = tokenise(topic);
  const expanded = [...base];
  if (base.includes("pythagoras")) expanded.push("pythagorean", "right", "triangle", "hypotenuse");
  if (base.includes("trigonometry") || base.includes("trigonometric") || base.includes("trig")) {
    expanded.push("sine", "cosine", "tangent", "soh", "cah", "toa", "triangle");
  }
  if (base.includes("angle") || base.includes("angles")) expanded.push("degrees");
  if (base.includes("length") || base.includes("lengths")) expanded.push("side", "sides");
  if (
    base.includes("multiplication") ||
    base.includes("multiply") ||
    (base.includes("times") && (base.includes("table") || base.includes("tables")))
  ) {
    expanded.push(
      "multiplication",
      "multiply",
      "multiplying",
      "division",
      "divide",
      "tables",
      "facts",
      "counting",
      "arrays",
      "repeated",
      "addition",
      "commutative",
      "factors",
      "products",
    );
  }
  return unique(expanded);
}

function isTimesTableTopic(topic: string): boolean {
  const tokens = topicTokens(topic);
  return (
    tokens.includes("multiplication") ||
    tokens.includes("multiply") ||
    (tokens.includes("times") && (tokens.includes("table") || tokens.includes("tables")))
  );
}

function isSequenceTopic(topic: string): boolean {
  const normalised = normaliseTopicLanguage(topic);
  const tokens = topicTokens(topic);
  return (
    tokens.includes("sequence") ||
    normalised.includes("nth term") ||
    normalised.includes("position term") ||
    normalised.includes("term term")
  );
}

function exactTopicBoost(text: string, topic: string) {
  const haystack = normaliseTopicLanguage(text);
  const needles = unique([
    normaliseTopicLanguage(topic),
    ...topicTokens(topic).map((token) => normaliseTopicLanguage(token)),
  ]).filter((token) => token.length >= 3);

  return needles.reduce((score, token) => score + (haystack.includes(token) ? 8 : 0), 0);
}

function overlapScore(text: string, tokens: string[]) {
  const haystack = tokenise(text);
  const set = new Set(haystack);
  return tokens.reduce((score, token) => score + (set.has(token) ? 1 : 0), 0);
}

function domainTerms(domain: string | undefined): string[] {
  switch (clean(domain).toUpperCase()) {
    case "GEOMETRY":
      return ["geometry", "shape", "angle", "triangle", "pythagoras", "trigonometry", "coordinate"];
    case "ALGEBRA":
      return ["algebra", "equation", "expression", "formula", "graph", "function"];
    case "NUMBER":
      return ["number", "fraction", "decimal", "integer", "arithmetic", "surd"];
    case "RATIO":
      return ["ratio", "proportion", "scale", "similarity"];
    case "DATA":
      return ["data", "statistics", "table", "chart", "graph"];
    case "PROBABILITY":
      return ["probability", "chance", "event", "outcome"];
    default:
      return [];
  }
}

function sha1(value: string): string {
  return crypto.createHash("sha1").update(value).digest("hex");
}

function objectiveUnitSlug(code: string): string | null {
  const parts = code.split(":").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 4 && parts[0] === "oak" ? parts[3] : null;
}

async function retrieveLessonEvidence(input: BuildBespokeLessonInput) {
  const subject = input.subject ?? "MATHS";
  const tokens = unique([...topicTokens(input.topic), ...domainTerms(input.domain)]);
  const containsClauses = tokens.slice(0, 12).flatMap((token) => [
    { title: { contains: token, mode: "insensitive" as const } },
    { statement: { contains: token, mode: "insensitive" as const } },
    { strand: { contains: token, mode: "insensitive" as const } },
  ]);

  const objectives = await prisma.curriculumObjective.findMany({
    where: {
      subject,
      isActive: true,
      source: { slug: "oak", isActive: true },
      ...(input.keyStage ? { keyStage: input.keyStage } : {}),
      ...(typeof input.yearGroup === "number" ? { yearGroup: input.yearGroup } : {}),
      OR: containsClauses.length
        ? containsClauses
        : [{ canonicalQuestions: { some: { status: "ACTIVE" } } }, { chunks: { some: { isActive: true } } }],
    },
    take: 900,
    select: {
      id: true,
      code: true,
      subject: true,
      keyStage: true,
      yearGroup: true,
      strand: true,
      title: true,
      statement: true,
      keywords: true,
      _count: { select: { chunks: true, canonicalQuestions: true } },
    },
  });

  const rankedObjectives = objectives
    .map((objective) => {
      const text = [objective.code, objective.title, objective.statement, objective.strand, ...objective.keywords].join(" ");
      const overlap = overlapScore(text, tokens);
      let score = overlap * 28;
      score += exactTopicBoost(text, input.topic);
      if (isTimesTableTopic(input.topic)) {
        const normalisedText = normaliseTopicLanguage(text);
        const normalisedStrand = normaliseTopicLanguage(objective.strand);
        const normalisedTitle = normaliseTopicLanguage(objective.title);
        if (normalisedText.includes("multiplication tables")) score += 80;
        if (normalisedTitle.includes("multiplication tables")) score += 65;
        if (normalisedStrand.includes("times table")) score += 70;
        if (normalisedTitle.includes("recall") && normalisedTitle.includes("multiplication")) score += 55;
        if (normalisedTitle.includes("place value") && !normalisedTitle.includes("multiplication tables")) {
          score -= 55;
        }
        if (normalisedStrand.startsWith("time:")) score -= 75;
      }
      if (isSequenceTopic(input.topic)) {
        const normalisedText = normaliseTopicLanguage(text);
        const normalisedStrand = normaliseTopicLanguage(objective.strand);
        const normalisedTitle = normaliseTopicLanguage(objective.title);
        if (normalisedStrand.includes("sequence")) score += 160;
        if (normalisedText.includes("nth term")) score += 140;
        if (normalisedTitle.includes("nth term")) score += 120;
        if (normalisedText.includes("arithmetic sequence")) score += 100;
        if (normalisedText.includes("position term")) score += 85;
        if (normalisedText.includes("term term") && normalisedText.includes("rule")) score += 60;
        if (normalisedText.includes("generate terms") && normalisedText.includes("sequence")) score += 55;
        if (
          normalisedText.includes("collecting like terms") ||
          normalisedText.includes("algebraic expression") ||
          normalisedText.includes("single term over a bracket") ||
          normalisedText.includes("factoris")
        ) {
          score -= 140;
        }
        if (normalisedStrand.includes("expressions and equations") && !normalisedText.includes("sequence")) {
          score -= 80;
        }
      }
      if (tokens.includes("algebra")) {
        const normalisedText = normaliseTopicLanguage(text);
        const normalisedStrand = normaliseTopicLanguage(objective.strand);
        const normalisedTitle = normaliseTopicLanguage(objective.title);
        if (normalisedStrand.includes("algebra")) score += 90;
        if (normalisedText.includes("algebraic expression")) score += 80;
        if (normalisedTitle.includes("algebraic expression")) score += 80;
        if (normalisedText.includes("collecting like terms")) score += 70;
        if (normalisedText.includes("equation")) score += 55;
        if (normalisedText.includes("substitution")) score += 45;
        if (normalisedText.includes("factoris")) score += 45;
        if (normalisedStrand.includes("fraction") || normalisedStrand.includes("decimal")) score -= 80;
        if (normalisedTitle.includes("geometry") && normalisedTitle.includes("geometrical construction")) score -= 90;
      }
      if (tokens.includes("pythagoras") || tokens.includes("trigonometry") || tokens.includes("trigonometric")) {
        const normalisedText = normaliseTopicLanguage(text);
        const normalisedStrand = normaliseTopicLanguage(objective.strand);
        if (normalisedStrand.includes("right angled trigonometry")) score += 120;
        if (normalisedStrand.includes("trigonometry")) score += 90;
        if (normalisedStrand.includes("pythagoras")) score += 70;
        if (normalisedText.includes("right angled triangle")) score += 55;
        if (normalisedStrand.includes("compound shapes") && normalisedText.includes("perimeter")) {
          score -= 90;
        }
      }
      if (objective._count.canonicalQuestions > 0) score += 18 + Math.min(objective._count.canonicalQuestions, 12) * 4;
      if (objective._count.chunks > 0) score += 14 + Math.min(objective._count.chunks, 8) * 2;
      if (input.keyStage && objective.keyStage === input.keyStage) score += 12;
      if (typeof input.yearGroup === "number" && objective.yearGroup === input.yearGroup) score += 10;
      if (clean(input.topic) && clean(objective.title).toLowerCase().includes(clean(input.topic).toLowerCase())) score += 35;
      return {
        ...objective,
        score,
        matchReason:
          overlap > 0
            ? `Matched ${overlap} topic terms: ${tokens.filter((token) => tokenise(text).includes(token)).slice(0, 6).join(", ")}.`
            : "Included because it has Oak canonical questions or support content for the selected subject.",
      };
    })
    .filter((objective) => objective.score > 0)
    .sort((a, b) => b.score - a.score || (b._count.canonicalQuestions + b._count.chunks) - (a._count.canonicalQuestions + a._count.chunks));

  const topicScopedObjectives =
    isSequenceTopic(input.topic) && rankedObjectives.some((objective) => normaliseTopicLanguage(objective.strand).includes("sequence"))
      ? rankedObjectives.filter((objective) => normaliseTopicLanguage(objective.strand).includes("sequence"))
      : rankedObjectives;

  const scored = topicScopedObjectives
    .slice(0, Math.min(Math.max(input.maxObjectives ?? 5, 1), 8));

  const objectiveIds = scored.map((objective) => objective.id);
  const strands = unique(scored.map((objective) => objective.strand).filter(Boolean));

  const [chunks, questions] = await Promise.all([
    prisma.contentChunk.findMany({
      where: {
        subject,
        isActive: true,
        ...(scored[0]?.keyStage ? { keyStage: scored[0].keyStage } : input.keyStage ? { keyStage: input.keyStage } : {}),
        OR: [
          { objectiveId: { in: objectiveIds } },
          ...strands.slice(0, 4).map((strand) => ({ strand: { contains: strand, mode: "insensitive" as const } })),
          ...tokens.slice(0, 8).map((token) => ({ content: { contains: token, mode: "insensitive" as const } })),
        ],
      },
      orderBy: [{ type: "asc" }, { updatedAt: "desc" }],
      take: 80,
      select: {
        id: true,
        type: true,
        difficulty: true,
        content: true,
        citations: true,
        tags: true,
        objectiveId: true,
        strand: true,
        yearGroup: true,
        objective: { select: { code: true, title: true } },
      },
    }),
    prisma.canonicalQuestion.findMany({
      where: {
        status: "ACTIVE",
        objectiveId: { in: objectiveIds },
      },
      orderBy: [{ objectiveId: "asc" }, { sequence: "asc" }],
      take: 80,
      select: {
        id: true,
        sequence: true,
        itemType: true,
        difficulty: true,
        promptText: true,
        answerText: true,
        objectiveId: true,
        objective: {
          select: {
            code: true,
            title: true,
            strand: true,
            yearGroup: true,
          },
        },
      },
    }),
  ]);

  return {
    subject,
    keyStage: input.keyStage ?? scored[0]?.keyStage ?? null,
    yearGroup: input.yearGroup ?? scored[0]?.yearGroup ?? null,
    objectives: scored.map((objective) => ({
      id: objective.id,
      code: objective.code,
      subject: objective.subject,
      keyStage: objective.keyStage,
      yearGroup: objective.yearGroup,
      strand: objective.strand,
      title: objective.title,
      statement: objective.statement,
      keywords: objective.keywords,
      score: objective.score,
      matchReason: objective.matchReason,
      contentChunkCount: objective._count.chunks,
      canonicalQuestionCount: objective._count.canonicalQuestions,
    })),
    chunks: chunks.slice(0, 24).map((chunk) => ({
      id: chunk.id,
      type: chunk.type,
      difficulty: chunk.difficulty,
      content: chunk.content,
      excerpt: chunk.content.split("\n").map((line) => line.trim()).filter(Boolean).slice(0, 3).join(" "),
      citations: chunk.citations,
      tags: chunk.tags,
      objectiveId: chunk.objectiveId,
      objectiveCode: chunk.objective?.code ?? null,
      objectiveTitle: chunk.objective?.title ?? null,
      strand: chunk.strand,
      yearGroup: chunk.yearGroup,
    })),
    questions: questions.slice(0, 30).map((question) => ({
      id: question.id,
      sequence: question.sequence,
      itemType: question.itemType,
      difficulty: question.difficulty,
      promptText: question.promptText,
      answerText: question.answerText,
      objectiveId: question.objectiveId,
      objectiveCode: question.objective.code,
      objectiveTitle: question.objective.title,
      strand: question.objective.strand,
      yearGroup: question.objective.yearGroup,
    })),
  };
}

async function completeEvidenceFromOakLive(
  evidence: Awaited<ReturnType<typeof retrieveLessonEvidence>>,
): Promise<Awaited<ReturnType<typeof retrieveLessonEvidence>>> {
  const needsChunks = evidence.chunks.length === 0;
  const needsQuestions = evidence.questions.length === 0;
  if (!needsChunks && !needsQuestions) return evidence;

  const primaryObjective = evidence.objectives[0];
  const unitSlug = primaryObjective ? objectiveUnitSlug(primaryObjective.code) : null;
  if (!primaryObjective || !unitSlug) return evidence;

  try {
    const { oakGet } = await import("../lib/oakClient.js");
    const unit = await oakGet<any>(`/units/${unitSlug}/summary`);
    const lessons = Array.isArray(unit?.lessons) ? unit.lessons : [];
    const scoredLessons = lessons
      .filter((lesson: any) => clean(lesson?.lessonSlug))
      .map((lesson: any) => ({
        lesson,
        score: overlapScore(
          [lesson.lessonTitle, lesson.pupilLessonOutcome].map((item) => clean(item)).join(" "),
          topicTokens(primaryObjective.title),
        ),
      }))
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 3);

    const liveChunks: LessonChunkEvidence[] = [];
    const liveQuestions: LessonQuestionEvidence[] = [];
    for (const { lesson } of scoredLessons) {
      const lessonSlug = clean(lesson.lessonSlug);
      const [summary, quiz] = await Promise.all([
        oakGet<any>(`/lessons/${lessonSlug}/summary`).catch(() => null),
        oakGet<any>(`/lessons/${lessonSlug}/quiz`).catch(() => null),
      ]);

      const content = [
        `Oak live lesson: ${clean(summary?.lessonTitle) || clean(lesson.lessonTitle) || lessonSlug}`,
        clean(summary?.pupilLessonOutcome) ? `Outcome: ${clean(summary.pupilLessonOutcome)}` : "",
        Array.isArray(summary?.lessonKeywords) && summary.lessonKeywords.length
          ? `Vocabulary: ${summary.lessonKeywords
              .map((item: any) => [item.keyword, item.description].map((value) => clean(value)).filter(Boolean).join(": "))
              .filter(Boolean)
              .slice(0, 8)
              .join("; ")}`
          : "",
        Array.isArray(summary?.keyLearningPoints) && summary.keyLearningPoints.length
          ? `Key learning points: ${summary.keyLearningPoints
              .map((item: any) => clean(item.keyLearningPoint))
              .filter(Boolean)
              .slice(0, 8)
              .join(" | ")}`
          : "",
      ].filter(Boolean).join("\n");
      if (content) {
        liveChunks.push({
          id: `oak_live_chunk_${sha1(`${primaryObjective.id}:${lessonSlug}:${content}`).slice(0, 24)}`,
          type: "EXPLANATION",
          difficulty: "MEDIUM",
          content,
          excerpt: content.split("\n").slice(0, 3).join(" "),
          citations: [`/units/${unitSlug}/summary`, `/lessons/${lessonSlug}/summary`],
          tags: ["oak-live", "runtime"],
          objectiveId: primaryObjective.id,
          objectiveCode: primaryObjective.code,
          objectiveTitle: primaryObjective.title,
          strand: primaryObjective.strand,
          yearGroup: primaryObjective.yearGroup,
        });
      }

      const quizItems = [
        ...(Array.isArray(quiz?.starterQuiz) ? quiz.starterQuiz : []),
        ...(Array.isArray(quiz?.exitQuiz) ? quiz.exitQuiz : []),
      ];
      for (const item of quizItems.slice(0, 6)) {
        const promptText = clean(item?.question ?? item?.questionStem?.text ?? item?.questionStem ?? item?.prompt);
        const answerText = clean(
          item?.answer ??
            item?.correctAnswer ??
            item?.answers?.find?.((answerItem: any) => answerItem?.answerIsCorrect)?.answer ??
            item?.answers?.[0]?.answer,
        );
        if (!promptText || !answerText) continue;
        liveQuestions.push({
          id: `oak_live_question_${sha1(`${primaryObjective.id}:${liveQuestions.length}:${promptText}`).slice(0, 24)}`,
          sequence: liveQuestions.length + 1,
          itemType: "OAK_SHORT_ANSWER",
          difficulty: "MEDIUM",
          promptText,
          answerText,
          objectiveId: primaryObjective.id,
          objectiveCode: primaryObjective.code,
          objectiveTitle: primaryObjective.title,
          strand: primaryObjective.strand,
          yearGroup: primaryObjective.yearGroup,
        });
      }
    }

    return {
      ...evidence,
      chunks: needsChunks ? liveChunks : evidence.chunks,
      questions: needsQuestions ? liveQuestions : evidence.questions,
    };
  } catch {
    return evidence;
  }
}

function stripJsonFence(value: string): string {
  return value.replace(/^```(?:json)?/i, "").replace(/```$/i, "").trim();
}

function hasLlmConfig() {
  return Boolean(
    clean(process.env.AZURE_OPENAI_ENDPOINT) &&
      clean(process.env.AZURE_OPENAI_DEPLOYMENT) &&
      clean(process.env.AZURE_OPENAI_API_KEY),
  );
}

function azureEndpointBase(): string {
  return clean(process.env.AZURE_OPENAI_ENDPOINT)
    .replace(/\/+$/, "")
    .replace(/\/openai$/i, "");
}

async function callLessonGuideLlm(input: {
  topic: string;
  evidence: Awaited<ReturnType<typeof retrieveLessonEvidence>>;
}): Promise<BespokeLessonGuide> {
  const endpoint = azureEndpointBase();
  const deployment = clean(process.env.AZURE_OPENAI_DEPLOYMENT);
  const apiVersion = clean(process.env.AZURE_OPENAI_API_VERSION) || "2025-01-01-preview";

  async function requestGuide(compact: boolean) {
    const body = {
      topic: input.topic,
      subject: input.evidence.subject,
      keyStage: input.evidence.keyStage,
      yearGroup: input.evidence.yearGroup,
      oakObjectives: input.evidence.objectives.map((objective) => ({
        id: objective.id,
        code: objective.code,
        keyStage: objective.keyStage,
        yearGroup: objective.yearGroup,
        strand: objective.strand,
        title: objective.title,
        statement: objective.statement,
      })),
      oakChunks: input.evidence.chunks.slice(0, compact ? 8 : 16).map((chunk) => ({
        id: chunk.id,
        type: chunk.type,
        objectiveCode: chunk.objectiveCode,
        strand: chunk.strand,
        excerpt: chunk.excerpt.slice(0, compact ? 450 : 800),
        tags: chunk.tags,
      })),
      oakQuestions: input.evidence.questions.slice(0, compact ? 8 : 12).map((question) => ({
        id: question.id,
        objectiveCode: question.objectiveCode,
        difficulty: question.difficulty,
        promptText: question.promptText,
        answerText: question.answerText,
      })),
      outputContract: {
        title: "string",
        overview: compact ? "one concise paragraph" : "short paragraph",
        learningObjectives: compact ? "4-6 strings" : "5-8 strings",
        keyVocabulary: compact ? "5-8 objects { term, meaning }" : "6-12 objects { term, meaning }",
        lessonSections: compact
          ? "5-6 concise objects { title, durationMinutes, teacherActions: 2-4 strings, studentActions: 2-4 strings, workedExample?: { problem, steps, answer } }"
          : "6-10 objects { title, durationMinutes, teacherActions: strings[], studentActions: strings[], workedExample?: { problem, steps, answer } }",
        practice: compact
          ? "4-6 objects { prompt, answer, sourceQuestionId? } using Oak questions where possible"
          : "5-10 objects { prompt, answer, sourceQuestionId? } using Oak questions where possible",
        checksForUnderstanding: compact ? "3-5 strings" : "4-8 strings",
        misconceptions: compact ? "2-4 objects { misconception, repair }" : "3-6 objects { misconception, repair }",
        stretch: compact ? "1-3 strings" : "2-5 strings",
        resources: compact ? "2-4 strings" : "3-6 strings",
      },
    };

    let res: Response;
    try {
      res = await fetch(
        `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
        {
          method: "POST",
          headers: {
            "content-type": "application/json",
            "api-key": clean(process.env.AZURE_OPENAI_API_KEY),
          },
          body: JSON.stringify({
            max_completion_tokens: compact ? 5000 : 7000,
            temperature: compact ? 0.1 : 0.2,
            response_format: { type: "json_object" },
            messages: [
              {
                role: "system",
                content: [
                  "You are MyLisa's production lesson-builder.",
                  "Build a tutor-ready lesson guide from retrieved Oak curriculum objectives, Oak chunks, and Oak canonical questions.",
                  "The canonical scope is the provided Oak key stage, year group, and strand/objective. Do not widen to another key stage, year group, or strand.",
                  "Ground Oak-sourced claims in the provided evidence. If Oak chunks or questions are absent, do not imply Oak has supplied that missing content.",
                  "Generated teaching support must follow Oak-style pedagogy: prior knowledge activation, explicit instruction, worked examples, guided practice, independent practice, checks for understanding, misconception repair, and review.",
                  "Every section must contain substance: exact vocabulary, explicit modelling steps, worked examples, guided questions, checks, likely misconceptions, repair language, and a concrete visual/board representation.",
                  "When a visual model is needed, specify the representation precisely. For data or percentage topics, include a chart/table type, labels, values, and what learners should compare.",
                  "For maths, include exact notation where useful and keep examples correct.",
                  compact
                    ? "Return compact, valid JSON only. Prioritise syntactic completeness over length."
                    : "Return JSON only.",
                ].join("\n"),
              },
              { role: "user", content: JSON.stringify(body, null, compact ? 0 : 2) },
            ],
          }),
        },
      );
    } catch (error) {
      throw new LlmUnavailableError(
        `Bespoke lesson LLM unavailable: ${error instanceof Error ? error.message : "network request failed"}`,
      );
    }

    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new LlmUnavailableError(`Bespoke lesson LLM failed: ${res.status} ${res.statusText} ${text}`.slice(0, 500));
    }

    const data = (await res.json()) as any;
    const content = data?.choices?.[0]?.message?.content;
    const finishReason = clean(data?.choices?.[0]?.finish_reason);
    if (!content || typeof content !== "string") {
      throw new LlmGenerationError("Bespoke lesson LLM returned empty content.");
    }

    return { content, finishReason };
  }

  let lastReason = "The generated guide response was incomplete.";
  for (const compact of [false, true]) {
    const { content, finishReason } = await requestGuide(compact);
    if (finishReason === "length") {
      lastReason = "The generated guide response was truncated.";
      console.warn("[lesson-builder] guide LLM response truncated", {
        topic: input.topic,
        mode: compact ? "compact-retry" : "full",
        objectiveCount: input.evidence.objectives.length,
        chunkCount: input.evidence.chunks.length,
        questionCount: input.evidence.questions.length,
        contentLength: content.length,
      });
      continue;
    }

    try {
      const parsed = JSON.parse(stripJsonFence(content)) as Partial<BespokeLessonGuide>;
      return normaliseGuide(parsed, input.topic, input.evidence);
    } catch {
      lastReason = "The generated guide response was not valid JSON.";
      console.warn("[lesson-builder] guide LLM JSON parse failed", {
        topic: input.topic,
        mode: compact ? "compact-retry" : "full",
        objectiveCount: input.evidence.objectives.length,
        chunkCount: input.evidence.chunks.length,
        questionCount: input.evidence.questions.length,
        finishReason,
        contentLength: content.length,
      });
    }
  }

  throw new LlmGenerationError(`${lastReason} Please generate again.`);
}

function asStringArray(value: unknown, fallback: string[]): string[] {
  return Array.isArray(value) ? value.map(String).map(clean).filter(Boolean).slice(0, 12) : fallback;
}

function normaliseGuide(
  guide: Partial<BespokeLessonGuide>,
  topic: string,
  evidence: Awaited<ReturnType<typeof retrieveLessonEvidence>>,
): BespokeLessonGuide {
  const fallback = fallbackGuide(topic, evidence);
  return {
    title: clean(guide.title) || fallback.title,
    topic,
    subject: evidence.subject,
    keyStage: evidence.keyStage,
    yearGroup: evidence.yearGroup,
    overview: clean(guide.overview) || fallback.overview,
    learningObjectives: asStringArray(guide.learningObjectives, fallback.learningObjectives),
    keyVocabulary: Array.isArray(guide.keyVocabulary)
      ? guide.keyVocabulary
          .map((item: any) => ({ term: clean(item?.term), meaning: clean(item?.meaning) }))
          .filter((item) => item.term && item.meaning)
          .slice(0, 14)
      : fallback.keyVocabulary,
    lessonSections: Array.isArray(guide.lessonSections)
      ? guide.lessonSections
          .map((item: any, index) => ({
            title: clean(item?.title) || `Lesson section ${index + 1}`,
            durationMinutes: Number.isFinite(Number(item?.durationMinutes)) ? Number(item.durationMinutes) : 8,
            teacherActions: asStringArray(item?.teacherActions, []),
            studentActions: asStringArray(item?.studentActions, []),
            workedExample: item?.workedExample
              ? {
                  problem: clean(item.workedExample.problem),
                  steps: asStringArray(item.workedExample.steps, []),
                  answer: clean(item.workedExample.answer),
                }
              : undefined,
          }))
          .filter((item) => item.teacherActions.length || item.studentActions.length)
          .slice(0, 12)
      : fallback.lessonSections,
    practice: Array.isArray(guide.practice)
      ? guide.practice
          .map((item: any) => ({
            prompt: clean(item?.prompt),
            answer: clean(item?.answer),
            sourceQuestionId: clean(item?.sourceQuestionId) || undefined,
          }))
          .filter((item) => item.prompt && item.answer)
          .slice(0, 12)
      : fallback.practice,
    checksForUnderstanding: asStringArray(guide.checksForUnderstanding, fallback.checksForUnderstanding),
    misconceptions: Array.isArray(guide.misconceptions)
      ? guide.misconceptions
          .map((item: any) => ({ misconception: clean(item?.misconception), repair: clean(item?.repair) }))
          .filter((item) => item.misconception && item.repair)
          .slice(0, 8)
      : fallback.misconceptions,
    stretch: asStringArray(guide.stretch, fallback.stretch),
    resources: asStringArray(guide.resources, fallback.resources),
  };
}

function normaliseSectionContent(
  content: Partial<BespokeSectionContent>,
  input: GenerateBespokeSectionContentInput,
): BespokeSectionContent {
  const fallback = fallbackSectionContent(input);
  return {
    source: fallback.source,
    fallbackReason: fallback.fallbackReason,
    title: clean(content.title) || fallback.title,
    sectionTitle: input.section.title,
    durationMinutes: input.section.durationMinutes,
    tutorScript: asStringArray(content.tutorScript, fallback.tutorScript).slice(0, 10),
    boardContent: asStringArray(content.boardContent, fallback.boardContent).slice(0, 10),
    workedExample: content.workedExample
      ? {
          problem: clean(content.workedExample.problem) || fallback.workedExample?.problem || "",
          steps: asStringArray(content.workedExample.steps, fallback.workedExample?.steps ?? []),
          answer: clean(content.workedExample.answer) || fallback.workedExample?.answer || "",
        }
      : fallback.workedExample,
    guidedPractice: Array.isArray(content.guidedPractice)
      ? content.guidedPractice
          .map((item: any) => ({
            prompt: clean(item?.prompt),
            answer: clean(item?.answer),
          }))
          .filter((item) => item.prompt && item.answer)
          .slice(0, 8)
      : fallback.guidedPractice,
    checksForUnderstanding: asStringArray(
      content.checksForUnderstanding,
      fallback.checksForUnderstanding,
    ).slice(0, 8),
    supportPrompts: asStringArray(content.supportPrompts, fallback.supportPrompts).slice(0, 8),
    stretchPrompt: clean(content.stretchPrompt) || fallback.stretchPrompt,
    exitTicket: content.exitTicket
      ? {
          prompt: clean(content.exitTicket.prompt) || fallback.exitTicket.prompt,
          answer: clean(content.exitTicket.answer) || fallback.exitTicket.answer,
        }
      : fallback.exitTicket,
  };
}

function fallbackSectionContent(
  input: GenerateBespokeSectionContentInput,
): BespokeSectionContent {
  const firstQuestion = input.questions?.[0];
  const objective = input.objectives?.[0];
  const teacherActions = input.section.teacherActions.length
    ? input.section.teacherActions
    : [`Model ${input.topic} with one clear example.`];
  const studentActions = input.section.studentActions.length
    ? input.section.studentActions
    : ["Answer one check question after each modelled step."];

  return {
    source: "fallback",
    fallbackReason: "Azure OpenAI configuration is not available.",
    title: `${input.section.title}: generated content`,
    sectionTitle: input.section.title,
    durationMinutes: input.section.durationMinutes,
    tutorScript: [
      `We are working on ${objective?.title ?? input.topic}.`,
      ...teacherActions.map((action) => action.replace(/^Tutor:\s*/i, "")),
      "Pause after each step and ask learners to explain the next move before you reveal it.",
    ],
    boardContent: [
      input.guideTitle || `Lesson: ${input.topic}`,
      objective?.statement ?? `Objective: ${input.topic}`,
      ...teacherActions.slice(0, 3),
    ],
    workedExample: input.section.workedExample ?? (firstQuestion
      ? {
          problem: firstQuestion.promptText,
          steps: ["Read the question.", "Identify the known information.", "Apply the method.", "Check the answer."],
          answer: firstQuestion.answerText,
        }
      : undefined),
    guidedPractice: (input.questions ?? []).slice(0, 5).map((question) => ({
      prompt: question.promptText,
      answer: question.answerText,
    })),
    checksForUnderstanding: [
      "What is the first thing we need to identify?",
      "Which fact or method helps here?",
      "How do you know the answer is reasonable?",
    ],
    supportPrompts: [
      ...studentActions.slice(0, 3),
      "Say the fact family aloud before writing the answer.",
      "Use a smaller known fact, then build back to the target fact.",
    ],
    stretchPrompt: "Write a related question that uses the same structure but different numbers.",
    exitTicket: firstQuestion
      ? { prompt: firstQuestion.promptText, answer: firstQuestion.answerText }
      : {
          prompt: `Create and solve one question about ${input.topic}.`,
          answer: "Learner gives a valid method and checked answer.",
        },
  };
}

async function callSectionContentLlm(
  input: GenerateBespokeSectionContentInput,
): Promise<BespokeSectionContent> {
  const endpoint = azureEndpointBase();
  const deployment = clean(process.env.AZURE_OPENAI_DEPLOYMENT);
  const apiVersion = clean(process.env.AZURE_OPENAI_API_VERSION) || "2025-01-01-preview";

  const res = await fetch(
    `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": clean(process.env.AZURE_OPENAI_API_KEY),
      },
      body: JSON.stringify({
        max_completion_tokens: 2400,
        temperature: 0.25,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You generate production-ready tutor lesson content for MyLisa.",
              "Use the provided Oak-grounded objectives, questions, and the suggested lesson section.",
              "Stay inside the provided Oak key stage, year group, and strand/objective. Do not widen to another canonical scope.",
              "Create concrete content the tutor can use immediately. Do not return generic labels or empty routines.",
              "Include precise teacher wording, board layout, full worked-example steps, guided practice, checks, repair prompts, and where useful a visual model specification with labels and values.",
              "If Oak support is thin or missing, do not describe generated support as Oak content. Use Oak-style pedagogy while keeping source claims factual.",
              "Keep maths correct. Do not invent source claims.",
              "Return JSON only with: title, tutorScript, boardContent, workedExample, guidedPractice, checksForUnderstanding, supportPrompts, stretchPrompt, exitTicket.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              topic: input.topic,
              subject: input.subject ?? "MATHS",
              keyStage: input.keyStage ?? null,
              yearGroup: input.yearGroup ?? null,
              guideTitle: input.guideTitle ?? null,
              section: input.section,
              objectives: input.objectives?.slice(0, 6) ?? [],
              questions: input.questions?.slice(0, 10) ?? [],
            }),
          },
        ],
      }),
    },
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(`Section content LLM failed: ${res.status} ${res.statusText} ${text}`.slice(0, 500));
  }

  const data = (await res.json()) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") throw new Error("Section content LLM returned empty content");
  return normaliseSectionContent(JSON.parse(stripJsonFence(content)), input);
}

function fallbackGuide(
  topic: string,
  evidence: Awaited<ReturnType<typeof retrieveLessonEvidence>>,
): BespokeLessonGuide {
  const objectives = evidence.objectives.slice(0, 6);
  const questions = evidence.questions.slice(0, 8);
  const title = objectives[0]?.title || topic;
  return {
    title: `Bespoke lesson: ${title}`,
    topic,
    subject: evidence.subject,
    keyStage: evidence.keyStage,
    yearGroup: evidence.yearGroup,
    overview: `Teach ${topic} using the matched Oak objective sequence, explicit modelling, guided practice, and canonical Oak questions as the truth layer.`,
    learningObjectives: objectives.length
      ? objectives.map((objective) => objective.statement).slice(0, 8)
      : [`Understand and apply ${topic}.`],
    keyVocabulary: [
      { term: "Key idea", meaning: `The central method or concept in ${topic}.` },
      { term: "Worked example", meaning: "A model answer shown step by step before independent practice." },
      { term: "Check", meaning: "A quick test that the answer fits the question." },
    ],
    lessonSections: [
      {
        title: "Activate prior knowledge",
        durationMinutes: 5,
        teacherActions: ["Name the topic and show the first matched Oak objective.", "Ask learners what vocabulary they already recognise."],
        studentActions: ["Identify familiar words and one point of uncertainty."],
      },
      {
        title: "Model the core method",
        durationMinutes: 12,
        teacherActions: ["Use one clear worked example from the objective.", "Keep the method visible and explain one line at a time."],
        studentActions: ["Copy the structure and answer a single-step check-in."],
        workedExample: questions[0]
          ? {
              problem: questions[0].promptText,
              steps: ["Read the question.", "Choose the relevant method.", "Work one line at a time.", "Check against the prompt."],
              answer: questions[0].answerText,
            }
          : undefined,
      },
      {
        title: "Guided practice",
        durationMinutes: 15,
        teacherActions: ["Use the next Oak questions as guided prompts.", "Ask learners to justify each method choice before calculating."],
        studentActions: ["Attempt matched questions and explain the first step aloud."],
      },
      {
        title: "Independent practice and review",
        durationMinutes: 15,
        teacherActions: ["Select questions from the practice list.", "Review misconceptions and repair one error publicly."],
        studentActions: ["Complete questions independently and mark corrections clearly."],
      },
    ],
    practice: questions.map((question) => ({
      prompt: question.promptText,
      answer: question.answerText,
      sourceQuestionId: question.id,
    })),
    checksForUnderstanding: [
      "What is the first feature you need to identify?",
      "Which method fits this information?",
      "How can you check the answer is sensible?",
    ],
    misconceptions: [
      {
        misconception: "Choosing a method from memory rather than from the information in the question.",
        repair: "Circle the known information first, then decide which method uses those values.",
      },
    ],
    stretch: ["Ask learners to create a similar problem and explain why the method still works."],
    resources: ["Matched Oak objectives", "Oak canonical questions", "Tutor whiteboard or shared screen"],
  };
}

export async function buildBespokeLesson(input: BuildBespokeLessonInput): Promise<BespokeLessonBuildResult> {
  const topic = clean(input.topic);
  if (!topic) throw new Error("Topic is required.");

  let evidence = await retrieveLessonEvidence({
    ...input,
    topic,
    subject: input.subject ?? "MATHS",
  });

  if (!evidence.objectives.length) {
    const requestedScope = [
      input.keyStage ? `key stage ${input.keyStage}` : null,
      typeof input.yearGroup === "number" ? `year ${input.yearGroup}` : null,
      input.domain ? `strand/domain ${input.domain}` : null,
    ].filter(Boolean).join(", ");
    throw new Error(
      requestedScope
        ? `No Oak objectives matched this lesson topic in the requested canonical scope (${requestedScope}).`
        : "No Oak maths objectives matched this lesson topic."
    );
  }

  evidence = await completeEvidenceFromOakLive(evidence);

  let guide: BespokeLessonGuide;
  let source: "llm" | "fallback" = "fallback";
  let fallbackReason: string | undefined;

  if (hasLlmConfig()) {
    try {
      guide = await callLessonGuideLlm({ topic, evidence });
      source = "llm";
    } catch (error) {
      if (!isLlmUnavailableError(error)) {
        throw error;
      }
      fallbackReason = error instanceof Error ? error.message : "LLM guide generation failed.";
      console.warn("[lesson-builder] using guide fallback", {
        topic,
        subject: input.subject ?? "MATHS",
        keyStage: input.keyStage ?? null,
        yearGroup: input.yearGroup ?? null,
        objectiveCount: evidence.objectives.length,
        chunkCount: evidence.chunks.length,
        questionCount: evidence.questions.length,
        reason: fallbackReason,
      });
      guide = fallbackGuide(topic, evidence);
    }
  } else {
    fallbackReason = "Azure OpenAI configuration is not available.";
    guide = fallbackGuide(topic, evidence);
  }

  return {
    source,
    fallbackReason,
    retrieval: {
      topic,
      objectiveCount: evidence.objectives.length,
      chunkCount: evidence.chunks.length,
      questionCount: evidence.questions.length,
      objectives: evidence.objectives,
      chunks: evidence.chunks,
      questions: evidence.questions,
    },
    guide,
  };
}

export async function generateBespokeSectionContent(
  input: GenerateBespokeSectionContentInput,
): Promise<BespokeSectionContent> {
  if (!clean(input.topic)) throw new Error("Topic is required.");
  if (!clean(input.section?.title)) throw new Error("Section title is required.");

  if (hasLlmConfig()) {
    try {
      const content = await callSectionContentLlm(input);
      return { ...content, source: "llm", fallbackReason: undefined };
    } catch (error) {
      return {
        ...fallbackSectionContent(input),
        fallbackReason: error instanceof Error ? error.message : "Section content generation failed.",
      };
    }
  }

  return fallbackSectionContent(input);
}
