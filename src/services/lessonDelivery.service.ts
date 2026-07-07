import crypto from "node:crypto";
import type { CanonicalItemType, CanonicalOperator, ChunkType, DifficultyBand, Subject } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { buildCombinedChildProfile } from "./childProfile.service.js";
import { resolveOakCurriculumObjective } from "./curriculumExplorer.service.js";

type LessonSection = {
  key: string;
  title: string;
  purpose: string;
  durationMinutes: number;
  audience: "TUTOR_SCREEN" | "STUDENT_DEVICE";
  mode: string;
  chunkIds: string[];
  canonicalQuestionIds: string[];
};

type LessonSessionBlock = LessonSection & {
  objectiveCodes: string[];
  vectorTitles: string[];
};

type SupportChunkCard = {
  id: string;
  type: string;
  difficulty: string;
  content: string;
  citations: string[];
  tags: string[];
  subject: string;
  keyStage: string;
  objectiveId: string | null;
  objectiveCode: string | null;
  objectiveTitle: string | null;
  objectiveSubject: string | null;
  objectiveKeyStage: string | null;
  strand: string | null;
  yearGroup: number | null;
  matchScore: number;
  matchReason: string;
};

type PersonalisedQuestionCard = {
  id: string;
  sequence: number;
  itemType: string;
  difficulty: string;
  promptText: string;
  answerText: string;
  contentJson?: unknown;
  objectiveId: string;
  objectiveCode: string;
  objectiveTitle: string;
  strand: string;
  yearGroup: number | null;
  rationale: string;
  vectorTitles: string[];
  matchScore?: number;
  vectorSource?: string;
};

type PersonalisedQuestionRound = {
  key: string;
  title: string;
  purpose: string;
  durationMinutes: number;
  questions: PersonalisedQuestionCard[];
};

type LessonObjective = {
  id: string;
  organisationId: string;
  code: string;
  subject: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
  keyStage: "KS1" | "KS2" | "KS3" | "KS4";
  yearGroup: number | null;
  strand: string;
  title: string;
  statement: string;
  keywords: string[];
};

type LessonDeliveryParams = {
  studentId: string;
  objectiveId: string;
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
  selectedChunkIds?: string[];
};

type LessonDeliverySelectionParams = {
  studentId: string;
  subject?: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
  keyStage?: "KS1" | "KS2" | "KS3" | "KS4";
  yearGroup?: number;
  strand?: string;
  objectiveCode?: string;
  search?: string;
  organisationSlug?: string;
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
  selectedChunkIds?: string[];
};

function normaliseText(value: string | number | boolean | null | undefined): string {
  if (value == null) return "";
  return String(value).trim();
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function clean(value: string | null | undefined): string {
  return normaliseText(value);
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

function stripJsonFence(value: string): string {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function tokeniseText(value: string | null | undefined): string[] {
  return normaliseText(value)
    .toLowerCase()
    .split(/[^a-z0-9]+/g)
    .filter((token) => token.length >= 3);
}

function makeTokenSet(values: Array<string | null | undefined>): Set<string> {
  return new Set(values.flatMap((value) => tokeniseText(value)));
}

function overlapCount(a: Set<string>, b: Set<string>): number {
  let count = 0;
  for (const item of a) {
    if (b.has(item)) count += 1;
  }
  return count;
}

function sameStrand(a: string | null | undefined, b: string | null | undefined): boolean {
  return normaliseText(a).toLowerCase() === normaliseText(b).toLowerCase();
}

function isSequenceObjective(objective: Pick<LessonObjective, "title" | "statement" | "strand">): boolean {
  const text = [objective.title, objective.statement, objective.strand].join(" ").toLowerCase();
  return (
    text.includes("sequence") ||
    text.includes("sequences") ||
    text.includes("nth term") ||
    text.includes("position-to-term") ||
    text.includes("position to term") ||
    text.includes("term-to-term") ||
    text.includes("term to term")
  );
}

function objectiveText(objective: Pick<LessonObjective, "title" | "statement" | "strand" | "keywords">): string {
  return [
    objective.title,
    objective.statement,
    objective.strand,
    ...objective.keywords,
  ].join(" ").toLowerCase();
}

function isMathsGeometryObjective(objective: LessonObjective): boolean {
  if (objective.subject !== "MATHS") return false;
  const text = objectiveText(objective);
  return [
    "geometry",
    "geometrical",
    "shape",
    "shapes",
    "polygon",
    "polygons",
    "angle",
    "angles",
    "cube",
    "cuboid",
    "prism",
    "faces",
    "edges",
    "vertices",
    "net",
    "nets",
  ].some((term) => text.includes(term));
}

function isScienceAtmosphereClimateObjective(objective: LessonObjective): boolean {
  if (objective.subject !== "SCIENCE") return false;
  const text = objectiveText(objective);
  return (
    ["atmosphere", "carbon dioxide", "greenhouse", "climate", "global warming", "fossil fuel", "combustion"].some((term) =>
      text.includes(term)
    )
  );
}

function isLinearEquationObjective(objective: LessonObjective): boolean {
  if (objective.subject !== "MATHS") return false;
  const text = objectiveText(objective);
  return (
    text.includes("linear equation") ||
    text.includes("linear equations") ||
    (text.includes("equation") && text.includes("variable")) ||
    text.includes("rearrangement")
  );
}

function minimumGeneratedQuestionCount(objective: LessonObjective): number {
  return isSequenceObjective(objective) ? 26 : 20;
}

function practiceQuestionTarget(objective: LessonObjective): number {
  return isSequenceObjective(objective) ? 26 : 20;
}

function questionUniquenessKey(question: Pick<PersonalisedQuestionCard, "promptText">): string {
  return normaliseText(question.promptText).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function answerUniquenessKey(question: { answerText: string }) {
  return normaliseText(question.answerText).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

function structuralQuestionKey(question: { promptText: string; answerText: string }) {
  const range = parseBlankRange(question.promptText);
  if (range) return `range:${range.lower}:${range.upper}`;

  const promptNumbers = Array.from(question.promptText.matchAll(/\d[\d,]*/g))
    .map((match) => parseIntegerText(match[0]))
    .filter((value): value is number => value != null);
  if (promptNumbers.length === 2) {
    return `compare:${promptNumbers[0]}:${promptNumbers[1]}`;
  }
  if (/order/i.test(question.promptText) && promptNumbers.length >= 3) {
    return `order:${[...promptNumbers].sort((a, b) => a - b).join(":")}`;
  }

  const answerNumbers = Array.from(question.answerText.matchAll(/\d[\d,]*/g))
    .map((match) => parseIntegerText(match[0]))
    .filter((value): value is number => value != null);
  if (/order/i.test(question.promptText) && answerNumbers.length >= 3) {
    return `order:${[...answerNumbers].sort((a, b) => a - b).join(":")}`;
  }

  return "";
}

function uniqueRenderableQuestionCount(questions: Array<{ contentJson?: unknown; itemType?: string; promptText: string }>) {
  return new Set(
    questions
      .filter((question) => isStudentRenderableQuestion(question))
      .map((question) => questionUniquenessKey(question))
      .filter(Boolean),
  ).size;
}

function contentRecord(value: unknown): Record<string, any> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, any>
    : null;
}

function canonicalTruthRecord(question: { contentJson?: unknown }): Record<string, any> | null {
  const content = contentRecord(question.contentJson);
  const truth = contentRecord(content?.canonicalTruth);
  return truth;
}

function answerContract(question: { contentJson?: unknown; itemType?: string }): string {
  const content = contentRecord(question.contentJson);
  const truth = canonicalTruthRecord(question);
  const contract = typeof content?.answerContract === "string"
    ? content.answerContract
    : typeof truth?.answerContract === "string"
      ? truth.answerContract
      : "";
  if (contract) return contract;

  const itemType = String(question.itemType ?? "").toLowerCase();
  if (itemType.includes("order")) return "ordered_sequence";
  if (itemType.includes("multiple_choice") || itemType.includes("multiple-choice")) return "single_choice";
  return "short_answer";
}

function hasUsableOptionBank(question: { contentJson?: unknown }) {
  const truth = canonicalTruthRecord(question);
  return Array.isArray(truth?.optionBank) && truth.optionBank.filter((item: unknown) => clean(String(item))).length >= 2;
}

function isGenericObjectiveTopUp(question: { contentJson?: unknown; promptText: string }) {
  const content = contentRecord(question.contentJson);
  const source = String(content?.source ?? contentRecord(content?.generated)?.source ?? "").toLowerCase();
  return source === "deterministic-objective-strand-top-up";
}

function isStudentRenderableQuestion(question: { contentJson?: unknown; itemType?: string; promptText: string }) {
  if (isGenericObjectiveTopUp(question)) return false;

  const contract = answerContract(question);
  if (contract === "single_choice") return hasUsableOptionBank(question);
  if (contract === "multi_blank_choice") return hasUsableOptionBank(question) || Array.isArray(canonicalTruthRecord(question)?.slots);
  if (contract === "match_pairs") return Array.isArray(canonicalTruthRecord(question)?.matchPairs);
  if (contract === "ordered_sequence") {
    const truth = canonicalTruthRecord(question);
    return (
      hasUsableOptionBank(question) &&
      (Array.isArray(truth?.orderedAnswers) || Array.isArray(truth?.immutableAnswers))
    );
  }
  return true;
}

function taskShapeKey(question: { contentJson?: unknown; itemType?: string; promptText: string }) {
  const contract = answerContract(question);
  return contract === "ordered_sequence" ? contract : contract;
}

function buildChildInterests(profile: Awaited<ReturnType<typeof buildCombinedChildProfile>>) {
  const structuredInterestTitles = profile.wrapperVectors
    .filter((vector) => vector.source === "INTEREST_FACTOR")
    .map((vector) => vector.title);

  const candidates = [
    ...structuredInterestTitles,
    profile.screening?.learningProfile?.summaryText,
    profile.screening?.learningProfile?.summary,
    profile.screening?.latestResult?.recommendation,
    ...profile.wrapperVectors.map((vector) => `${vector.title}: ${vector.content}`),
  ]
    .map((value) => normaliseText(value))
    .filter(Boolean);

  return candidates.slice(0, 3);
}

function buildPresentationControls(
  profile: Awaited<ReturnType<typeof buildCombinedChildProfile>>,
  preferences: {
    tutoringMode: string;
    verbosity: string;
    stepSize: string;
    lowStimulus: boolean;
    avoidMetaphors: boolean;
    useBullets: boolean;
    moreExamples: boolean;
    frequentCheckIns: boolean;
    readingLevel: number | null;
    attentionSpanMins: number | null;
  } | null,
) {
  return {
    tutoringMode: preferences?.tutoringMode ?? "AUTO",
    verbosity: preferences?.verbosity ?? "LOW",
    stepSize:
      profile.recommendations.deliveryProfile.pace === "SHORT_STEPS"
        ? "SMALL"
        : (preferences?.stepSize ?? "NORMAL"),
    lowStimulus: preferences?.lowStimulus ?? true,
    avoidMetaphors: preferences?.avoidMetaphors ?? false,
    useBullets: preferences?.useBullets ?? true,
    moreExamples: preferences?.moreExamples ?? true,
    frequentCheckIns: preferences?.frequentCheckIns ?? true,
    readingLevel: preferences?.readingLevel ?? null,
    attentionSpanMins: preferences?.attentionSpanMins ?? null,
    scaffolding: profile.recommendations.deliveryProfile.scaffolding,
    confidencePriority: profile.recommendations.deliveryProfile.confidencePriority,
    rationale: profile.recommendations.deliveryProfile.rationale,
  };
}

function buildLlmGuardrails(input: {
  displayName: string;
  interests: string[];
  presentationControls: ReturnType<typeof buildPresentationControls>;
}) {
  const interestLine = input.interests.length
    ? `Use familiar contexts only when helpful: ${input.interests.join(" | ")}.`
    : "Use neutral everyday contexts unless a known child interest is available.";

  return [
    "Canonical question content and answer are the source of truth.",
    "Do not change the facts, numbers, operators, expected answer, or teaching intent of any canonical question.",
    `Wrap explanations for ${input.displayName} using the presentation controls and confidence-first tone.`,
    interestLine,
    "Keep steps short when confidence or screening suggests extra load control.",
    "Use Oak explanation and misconception chunks to explain, model, and remediate around the canonical question.",
    "Personalization may change wording, examples, pacing, encouragement, and ordering of support, but never the canonical subject content itself.",
  ];
}

function buildLessonSessionBlocks(input: {
  selectedChunks: SupportChunkCard[];
  vectoredRounds: PersonalisedQuestionRound[];
  vectorTitles: string[];
  lessonObjectives: LessonObjective[];
}): LessonSessionBlock[] {
  const objectiveBlocks: LessonSessionBlock[] = input.lessonObjectives.slice(0, 3).map((objective, index) => {
    const chunkIds = input.selectedChunks
      .filter((chunk) => chunk.objectiveId === objective.id || chunk.objectiveCode === objective.code)
      .map((chunk) => chunk.id);

    return {
      key: `whole-group-objective-${index + 1}`,
      title: `Worked example ${index + 1}: ${objective.title}`,
      purpose:
        "Tutor models this objective using a clear worked example, spoken steps, and a visible answer check before students practise with aligned Oak questions.",
      durationMinutes: 8,
      audience: "TUTOR_SCREEN" as const,
      mode: "WORKED_EXAMPLE_TEACH",
      chunkIds: chunkIds.length ? chunkIds : input.selectedChunks.map((chunk) => chunk.id),
      canonicalQuestionIds: [],
      objectiveCodes: [objective.code],
      vectorTitles: [],
    };
  });

  const practiceBlocks: LessonSessionBlock[] = input.vectoredRounds.slice(0, 3).map((round, index) => ({
    key: `student-oak-practice-${index + 1}`,
    title: `Oak practice ${index + 1}: ${round.title}`,
    purpose:
      "Students work independently on Oak canonical questions aligned to the live whole-group objectives while MyLisa applies each learner's wrapper vectors.",
    durationMinutes: 7,
    audience: "STUDENT_DEVICE" as const,
    mode: "OAK_ALIGNED_PERSONALISED_PRACTICE",
    chunkIds: [],
    canonicalQuestionIds: round.questions.map((question) => question.id),
    objectiveCodes: Array.from(new Set(round.questions.map((question) => question.objectiveCode))),
    vectorTitles: input.vectorTitles,
  }));

  return [
    objectiveBlocks[0],
    practiceBlocks[0],
    objectiveBlocks[1],
    practiceBlocks[1],
    objectiveBlocks[2],
    practiceBlocks[2],
  ].filter((block): block is LessonSessionBlock => Boolean(block));
}

function buildKeywordEnvelope(input: {
  objective: {
    title: string;
    statement: string;
    strand: string;
    keywords: string[];
  };
  lessonObjectives?: Array<{
    title: string;
    statement: string;
    strand: string;
    keywords: string[];
  }>;
  profile: Awaited<ReturnType<typeof buildCombinedChildProfile>>;
}) {
  return makeTokenSet([
    input.objective.title,
    input.objective.statement,
    input.objective.strand,
    ...input.objective.keywords,
    ...(input.lessonObjectives ?? []).flatMap((objective) => [
      objective.title,
      objective.statement,
      objective.strand,
      ...objective.keywords,
    ]),
    input.profile.screening?.learningProfile?.summaryText,
    input.profile.screening?.learningProfile?.summary,
    input.profile.screening?.learningProfile?.primaryProfile,
    input.profile.screening?.latestResult?.profileType,
    input.profile.screening?.latestResult?.recommendation,
    ...input.profile.wrapperVectors.map((vector) => vector.title),
    ...input.profile.wrapperVectors.map((vector) => vector.content),
  ]);
}

function chunkTypeLimit(type: string): number {
  switch (type) {
    case "OBJECTIVE":
      return 2;
    case "EXPLANATION":
      return 3;
    case "WORKED_EXAMPLE":
      return 2;
    case "MISCONCEPTION":
      return 3;
    case "PRACTICE":
      return 2;
    case "GLOSSARY":
      return 2;
    case "COMMAND_WORDS":
      return 1;
    default:
      return 1;
  }
}

function scoreSupportChunk(input: {
  chunk: {
    id: string;
    type: string;
    content: string;
    tags: string[];
    subject: string;
    keyStage: string;
    objectiveId: string | null;
    yearGroup: number | null;
    strand: string | null;
    objective:
      | {
          code: string;
          subject: string;
          keyStage: string;
          title: string;
          strand: string;
          yearGroup: number | null;
        }
      | null;
  };
  selectedObjective: {
    id: string;
    subject: string;
    keyStage: string;
    strand: string;
    yearGroup: number | null;
  };
  lessonObjectives: LessonObjective[];
  objectiveSignals: Array<{
    objectiveId: string;
    code: string;
    priorityWeight?: number;
    gapSeverity?: number;
  }>;
  strandSignals: Array<{
    strand: string;
    priority: number;
  }>;
  keywordEnvelope: Set<string>;
  targetYears: number[];
}) {
  if (
    input.chunk.subject !== input.selectedObjective.subject ||
    input.chunk.keyStage !== input.selectedObjective.keyStage
  ) {
    return {
      score: 0,
      reason: "Rejected because the chunk subject or key stage label does not match the selected objective.",
    };
  }

  if (
    input.chunk.objective &&
    (input.chunk.objective.subject !== input.selectedObjective.subject ||
      input.chunk.objective.keyStage !== input.selectedObjective.keyStage)
  ) {
    return {
      score: 0,
      reason: "Rejected because the linked objective subject or key stage label does not match the selected objective.",
    };
  }

  let score = 0;
  const reasons: string[] = [];

  if (input.chunk.objectiveId === input.selectedObjective.id) {
    score += 120;
    reasons.push("Exact match to the selected objective.");
  }

  const lessonObjective = input.lessonObjectives.find(
    (objective) => objective.id === input.chunk.objectiveId,
  );
  if (lessonObjective && lessonObjective.id !== input.selectedObjective.id) {
    score += 90;
    reasons.push(`Blends related lesson objective ${lessonObjective.code}.`);
  }

  const objectiveSignal = input.objectiveSignals.find(
    (signal) => signal.objectiveId === input.chunk.objectiveId
  );
  if (objectiveSignal) {
    score +=
      55 +
      (objectiveSignal.priorityWeight ?? 0) * 6 +
      (objectiveSignal.gapSeverity ?? 0) * 10;
    reasons.push(`Supports recommended objective ${objectiveSignal.code}.`);
  }

  const chunkStrand = normaliseText(input.chunk.strand ?? input.chunk.objective?.strand);
  if (chunkStrand && chunkStrand.toLowerCase() === input.selectedObjective.strand.toLowerCase()) {
    score += 28;
    reasons.push("Aligned to the taught strand.");
  }

  const matchedStrand = input.strandSignals.find(
    (signal) => normaliseText(signal.strand).toLowerCase() === chunkStrand.toLowerCase()
  );
  if (matchedStrand) {
    score += Math.max(12, 28 - matchedStrand.priority * 4);
    reasons.push(`Supports priority strand ${matchedStrand.strand}.`);
  }

  const targetYear = input.chunk.yearGroup ?? input.chunk.objective?.yearGroup;
  if (targetYear != null && input.targetYears.includes(targetYear)) {
    score += 18;
    reasons.push(`Fits the Year ${targetYear} blend.`);
  }

  if (
    targetYear != null &&
    input.selectedObjective.yearGroup != null &&
    Math.abs(targetYear - input.selectedObjective.yearGroup) <= 1
  ) {
    score += 10;
  }

  const chunkTerms = makeTokenSet([
    input.chunk.content,
    ...input.chunk.tags,
    input.chunk.objective?.title,
    input.chunk.objective?.strand,
  ]);
  const matches = overlapCount(chunkTerms, input.keywordEnvelope);
  if (matches > 0) {
    score += Math.min(24, matches * 4);
    reasons.push("Contains vocabulary echoed in screening or wrapper vectors.");
  }

  return {
    score,
    reason:
      reasons.join(" ") ||
      "Relevant supporting content selected to keep the worked-example sequence coherent.",
  };
}

function scoreCanonicalQuestion(input: {
  row: {
    id: string;
    objectiveId: string;
    difficulty: string;
    objective: {
      code: string;
      title: string;
      strand: string;
      yearGroup: number | null;
    };
  };
  selectedObjective: {
    id: string;
    strand: string;
    yearGroup: number | null;
  };
  lessonObjectives: LessonObjective[];
  objectiveSignals: Array<{
    objectiveId: string;
    code: string;
    priorityWeight?: number;
    gapSeverity?: number;
  }>;
  strandSignals: Array<{
    strand: string;
    priority: number;
  }>;
  keywordEnvelope: Set<string>;
  vectorTitles: string[];
  targetYears: number[];
}) {
  let score = 0;
  const reasons: string[] = [];

  if (input.row.objectiveId === input.selectedObjective.id) {
    score += 55;
    reasons.push("Keeps the first question round close to the taught objective.");
  }

  const lessonObjective = input.lessonObjectives.find(
    (objective) => objective.id === input.row.objectiveId,
  );
  if (lessonObjective && lessonObjective.id !== input.selectedObjective.id) {
    score += 110;
    reasons.push(`Checks the worked-example objective ${lessonObjective.code}.`);
  }

  const objectiveSignal = input.objectiveSignals.find(
    (signal) => signal.objectiveId === input.row.objectiveId
  );
  if (objectiveSignal) {
    score +=
      100 +
      (objectiveSignal.priorityWeight ?? 0) * 12 +
      (objectiveSignal.gapSeverity ?? 0) * 18;
    reasons.push(`Targets recommended objective ${objectiveSignal.code}.`);
  }

  if (
    normaliseText(input.row.objective.strand).toLowerCase() ===
    input.selectedObjective.strand.toLowerCase()
  ) {
    score += 24;
  }

  const strandSignal = input.strandSignals.find(
    (signal) =>
      normaliseText(signal.strand).toLowerCase() ===
      normaliseText(input.row.objective.strand).toLowerCase()
  );
  if (strandSignal) {
    score += Math.max(10, 24 - strandSignal.priority * 4);
    reasons.push(`Revisits priority strand ${strandSignal.strand}.`);
  }

  if (
    input.row.objective.yearGroup != null &&
    input.targetYears.includes(input.row.objective.yearGroup)
  ) {
    score += 16;
  }

  const questionTerms = makeTokenSet([
    input.row.objective.title,
    input.row.objective.strand,
    input.row.difficulty,
  ]);
  const matches = overlapCount(questionTerms, input.keywordEnvelope);
  if (matches > 0) {
    score += Math.min(20, matches * 4);
    reasons.push("Sits inside the current vector-aware teaching envelope.");
  }

  return {
    score,
    reason:
      reasons.join(" ") ||
      "Chosen as part of the personalised question block for this learner.",
    vectorTitles: input.vectorTitles.slice(0, 3),
  };
}

function taughtFocus(input: {
  title: string;
  statement: string;
  strand: string;
  keywords: string[];
}) {
  const text = [
    input.title,
    input.statement,
    input.strand,
    ...input.keywords,
  ]
    .join(" ")
    .toLowerCase();

  if (
    ["pythagoras", "trigonometry", "trigonometric", "right-angled", "right angled"].some((term) =>
      text.includes(term)
    )
  ) {
    return {
      family: "RIGHT_TRIANGLE",
      strongPositive: [
        "pythagoras",
        "pythagorean",
        "hypotenuse",
        "right-angled triangle",
        "right angled triangle",
        "trigonometry",
        "trigonometric",
        "sine",
        "cosine",
        "tangent",
        "sin",
        "cos",
        "tan",
        "opposite side",
        "adjacent side",
        "length of x",
        "length x",
        "work out the length",
        "work out the angle",
        "find the length",
        "find the angle",
      ],
      supportingPositive: ["right angle", "right angles", "triangle", "triangles", "angle"],
      negative: [
        "perimeter",
        "area of",
        "units of area",
        "units can be used",
        "distance around",
        "cup",
        "tablespoon",
        "ounce",
        "pound",
        "kilometre",
        "centimetres",
        "smallest length",
        "regular hexagon",
        "parallelogram",
        "trapezium",
        "formula for its area",
      ],
    } as const;
  }

  return null;
}

function textHasTerm(text: string, term: string): boolean {
  if (/^[a-z0-9]+$/.test(term)) {
    return new RegExp(`\\b${term}\\b`, "i").test(text);
  }
  return text.includes(term);
}

function questionMatchesTaughtFocus(
  question: {
    promptText: string;
    answerText: string;
    sequence: number;
    objective: {
      title: string;
      strand: string;
    };
  },
  objective: {
    title: string;
    statement: string;
    strand: string;
    keywords: string[];
  },
) {
  const focus = taughtFocus(objective);
  if (!focus) return true;

  const text = [
    question.promptText,
    question.answerText,
  ]
    .join(" ")
    .toLowerCase();

  const hasStrongPositive = focus.strongPositive.some((term) => textHasTerm(text, term));
  const hasMethodPositive = focus.strongPositive
    .filter(
      (term) =>
        ![
          "right-angled triangle",
          "right angled triangle",
          "opposite side",
          "adjacent side",
        ].includes(term),
    )
    .some((term) => textHasTerm(text, term));
  const hasSupportingPositive = focus.supportingPositive.some((term) => textHasTerm(text, term));
  const hasNegative = focus.negative.some((term) => textHasTerm(text, term));

  if (focus.family === "RIGHT_TRIANGLE") {
    if (hasNegative && !hasMethodPositive) return false;
    return hasStrongPositive || (hasSupportingPositive && !hasNegative);
  }

  return !hasNegative || hasStrongPositive || hasSupportingPositive;
}

async function selectMatchedSupportChunks(input: {
  objective: LessonObjective & {
    chunks: Array<{
      id: string;
      type: string;
      difficulty: string;
      content: string;
      citations: string[];
      tags: string[];
    }>;
  };
  lessonObjectives: LessonObjective[];
  childProfile: Awaited<ReturnType<typeof buildCombinedChildProfile>>;
  selectedChunkIds?: string[];
}) {
  const keywordEnvelope = buildKeywordEnvelope({
    objective: input.objective,
    profile: input.childProfile,
  });
  const objectiveSignals = input.childProfile.recommendations.objectives
    .filter((signal) => signal.objectiveId === input.objective.id)
    .slice(0, 3);
  const targetYears = Array.from(
    new Set(
      [
        input.objective.yearGroup,
        input.childProfile.child.schoolYear,
        ...objectiveSignals.map((signal) => signal.yearGroup),
      ].filter((value): value is number => typeof value === "number")
    )
  );
  const candidateObjectiveIds = [input.objective.id];

  const rows = await prisma.contentChunk.findMany({
    where: {
      organisationId: input.objective.organisationId,
      subject: input.objective.subject,
      isActive: true,
      objectiveId: { in: candidateObjectiveIds },
      keyStage: input.objective.keyStage,
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 160,
    select: {
      id: true,
      type: true,
      difficulty: true,
      content: true,
      citations: true,
      tags: true,
      subject: true,
      keyStage: true,
      objectiveId: true,
      yearGroup: true,
      strand: true,
      objective: {
        select: {
          code: true,
          subject: true,
          keyStage: true,
          title: true,
          strand: true,
          yearGroup: true,
        },
      },
    },
  });

  const rowIds = new Set(rows.map((row) => row.id));
  const candidateRows = [
    ...rows,
    ...input.objective.chunks
      .filter((chunk) => !rowIds.has(chunk.id))
      .map((chunk) => ({
        ...chunk,
        subject: input.objective.subject,
        keyStage: input.objective.keyStage,
        objectiveId: input.objective.id,
        yearGroup: input.objective.yearGroup,
        strand: input.objective.strand,
        objective: {
          code: input.objective.code,
          subject: input.objective.subject,
          keyStage: input.objective.keyStage,
          title: input.objective.title,
          strand: input.objective.strand,
          yearGroup: input.objective.yearGroup,
        },
      })),
  ];

  const scored = candidateRows
    .map((row) => {
      const match = scoreSupportChunk({
        chunk: row,
        selectedObjective: input.objective,
        lessonObjectives: input.lessonObjectives,
        objectiveSignals,
        strandSignals: [],
        keywordEnvelope,
        targetYears,
      });

      return {
        id: row.id,
        type: row.type,
        difficulty: row.difficulty,
        content: row.content,
        citations: row.citations,
        tags: row.tags,
        subject: row.subject,
        keyStage: row.keyStage,
        objectiveId: row.objectiveId,
        objectiveCode: row.objective?.code ?? null,
        objectiveTitle: row.objective?.title ?? null,
        objectiveSubject: row.objective?.subject ?? null,
        objectiveKeyStage: row.objective?.keyStage ?? null,
        strand: row.strand ?? row.objective?.strand ?? null,
        yearGroup: row.yearGroup ?? row.objective?.yearGroup ?? null,
        matchScore: match.score,
        matchReason: match.reason,
      } satisfies SupportChunkCard;
    })
    .filter((row) => row.matchScore > 0)
    .sort((a, b) => b.matchScore - a.matchScore || a.id.localeCompare(b.id));

  const autoSelected: SupportChunkCard[] = [];
  const used = new Set<string>();
  const typeCounts = new Map<string, number>();

  for (const chunk of scored) {
    const currentCount = typeCounts.get(chunk.type) ?? 0;
    if (used.has(chunk.id) || currentCount >= chunkTypeLimit(chunk.type)) continue;
    used.add(chunk.id);
    typeCounts.set(chunk.type, currentCount + 1);
    autoSelected.push(chunk);
  }

  const requestedChunkIds = Array.from(
    new Set((input.selectedChunkIds ?? []).map((value) => value.trim()).filter(Boolean))
  );
  const customSelected: SupportChunkCard[] = [];

  for (const chunkId of requestedChunkIds) {
    const chunk = scored.find((candidate) => candidate.id === chunkId);
    if (chunk) customSelected.push(chunk);
  }

  const selected: SupportChunkCard[] =
    requestedChunkIds.length > 0 ? customSelected : autoSelected;

  const byType = selected.reduce<Record<string, SupportChunkCard[]>>((acc, chunk) => {
    if (!acc[chunk.type]) acc[chunk.type] = [];
    acc[chunk.type].push(chunk);
    return acc;
  }, {});

  return {
    selected,
    byType,
    candidates: scored.slice(0, 24),
    autoSelectedIds: autoSelected.map((chunk) => chunk.id),
    requestedChunkIds,
  };
}

async function buildVectoredQuestionRounds(input: {
  objective: LessonObjective & {
    canonicalQuestions: Array<{
      id: string;
      sequence: number;
      itemType: string;
      difficulty: string;
      promptText: string;
      answerText: string;
      contentJson: unknown;
    }>;
  };
  lessonObjectives: LessonObjective[];
  childProfile: Awaited<ReturnType<typeof buildCombinedChildProfile>>;
}) {
  const objectiveSignals = input.childProfile.recommendations.objectives
    .filter((signal) => signal.objectiveId === input.objective.id)
    .slice(0, 3);
  const candidateObjectiveIds = [input.objective.id];
  const targetYears = Array.from(
    new Set(
      [
        input.objective.yearGroup,
        input.childProfile.child.schoolYear,
        ...objectiveSignals.map((signal) => signal.yearGroup),
      ].filter((value): value is number => typeof value === "number")
    )
  );
  const keywordEnvelope = buildKeywordEnvelope({
    objective: {
      ...input.objective,
      title: "",
      statement: "",
      keywords: [],
    },
    profile: input.childProfile,
  });
  const vectorTitles = input.childProfile.wrapperVectors.map((vector) => vector.title);
  const rows = await prisma.canonicalQuestion.findMany({
    where: {
      organisationId: input.objective.organisationId,
      status: "ACTIVE",
      objective: {
        subject: input.objective.subject,
        keyStage: input.objective.keyStage,
        isActive: true,
        id: { in: candidateObjectiveIds },
      },
    },
    orderBy: [{ objectiveId: "asc" }, { sequence: "asc" }],
    take: 500,
    select: {
      id: true,
      sequence: true,
      itemType: true,
      difficulty: true,
      promptText: true,
      answerText: true,
      contentJson: true,
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
  });

  const rowIds = new Set(rows.map((row) => row.id));
  const candidateRows = [
    ...rows,
    ...input.objective.canonicalQuestions
      .filter((question) => !rowIds.has(question.id))
      .map((question) => ({
        ...question,
        objectiveId: input.objective.id,
        objective: {
          code: input.objective.code,
          title: input.objective.title,
          strand: input.objective.strand,
          yearGroup: input.objective.yearGroup,
        },
      })),
  ];

  const hasFocus = Boolean(taughtFocus(input.objective));
  const focusMatchedRows = candidateRows.filter((row) =>
    questionMatchesTaughtFocus(row, input.objective)
  );
  const minimumPracticeQuestions = practiceQuestionTarget(input.objective);
  const rowsForScoring =
    hasFocus && focusMatchedRows.length >= minimumPracticeQuestions
      ? focusMatchedRows
      : candidateRows;

  const scored = rowsForScoring
    .map((row) => {
      const match = scoreCanonicalQuestion({
        row,
        selectedObjective: input.objective,
        lessonObjectives: input.lessonObjectives,
        objectiveSignals,
        strandSignals: [],
        keywordEnvelope,
        vectorTitles,
        targetYears,
      });

      return {
        id: row.id,
        sequence: row.sequence,
        itemType: row.itemType,
        difficulty: row.difficulty,
        promptText: row.promptText,
        answerText: row.answerText,
        contentJson:
          row.contentJson && typeof row.contentJson === "object"
            ? row.contentJson
            : null,
        objectiveId: row.objectiveId,
        objectiveCode: row.objective.code,
        objectiveTitle: row.objective.title,
        strand: row.objective.strand,
        yearGroup: row.objective.yearGroup,
        rationale: match.reason,
        vectorTitles: match.vectorTitles,
        matchScore: match.score,
        vectorSource:
          objectiveSignals.some((signal) => signal.objectiveId === row.objectiveId)
            ? "RECOMMENDED_OBJECTIVE"
            : input.lessonObjectives.some(
                (objective) => objective.id === row.objectiveId && objective.id !== input.objective.id,
              )
              ? "WORKED_EXAMPLE_OBJECTIVE"
              : row.objectiveId === input.objective.id
                ? "ANCHOR_OBJECTIVE"
                : "PRIORITY_STRAND",
      };
    })
    .filter((row) => row.matchScore > 0 && isStudentRenderableQuestion(row))
    .sort((a, b) => b.matchScore - a.matchScore || a.sequence - b.sequence);

  const describeQuestion = (question: typeof scored[number]) => ({
    ...question,
    rationale: [
      question.rationale,
      question.vectorSource === "RECOMMENDED_OBJECTIVE"
        ? "Selected from learner assessment/mastery recommendations."
        : question.vectorSource === "WORKED_EXAMPLE_OBJECTIVE"
          ? "Selected from the session's worked-example objective set."
          : question.vectorSource === "PRIORITY_STRAND"
            ? "Selected from a learner priority strand."
            : question.vectorSource === "GENERATED_TOP_UP"
              ? "Generated as a top-up because the unique Oak question pool was below the minimum."
            : "Selected from the anchor objective after vector scoring.",
    ].join(" "),
  });

  const objectiveRounds = await Promise.all(input.lessonObjectives.slice(0, 3).map(async (objective, index) => {
    const targetQuestionCount = practiceQuestionTarget(objective);
    const objectiveCandidates = scored.filter((row) => row.objectiveId === objective.id);
    const strandCandidates = scored.filter(
      (row) =>
        row.objectiveId !== objective.id &&
        normaliseText(row.strand).toLowerCase() === normaliseText(objective.strand).toLowerCase(),
    );
    const picked: typeof scored = [];
    const usedIds = new Set<string>();
    const usedQuestionKeys = new Set<string>();

    const addCandidate = (candidate: typeof scored[number], allowRepeatedShape = false) => {
      if (!isStudentRenderableQuestion(candidate)) return false;
      const key = questionUniquenessKey(candidate);
      if (usedIds.has(candidate.id) || usedQuestionKeys.has(key)) return false;
      const previous = picked[picked.length - 1];
      if (!allowRepeatedShape && previous && taskShapeKey(previous) === taskShapeKey(candidate)) {
        return false;
      }
      picked.push(candidate);
      usedIds.add(candidate.id);
      usedQuestionKeys.add(key);
      return picked.length >= targetQuestionCount;
    };

    for (const candidate of objectiveCandidates) {
      if (addCandidate(candidate)) break;
    }

    if (picked.length < targetQuestionCount) {
      for (const candidate of [
        ...strandCandidates,
        ...scored.filter((row) => row.vectorSource === "RECOMMENDED_OBJECTIVE"),
        ...scored,
      ]) {
        if (addCandidate(candidate)) break;
      }
    }

    if (picked.length < targetQuestionCount) {
      for (const candidate of [
        ...objectiveCandidates,
        ...strandCandidates,
        ...scored.filter((row) => row.vectorSource === "RECOMMENDED_OBJECTIVE"),
        ...scored,
      ]) {
        if (addCandidate(candidate, true)) break;
      }
    }

    if (picked.length < targetQuestionCount) {
      const generatedQuestions = deterministicTopUpQuestions(objective, picked.length);

      for (const question of generatedQuestions) {
        if (
          addCandidate({
            id: question.id,
            sequence: question.sequence,
            itemType: String(question.itemType),
            difficulty: String(question.difficulty),
            promptText: question.promptText,
            answerText: question.answerText,
            contentJson:
              question.contentJson && typeof question.contentJson === "object"
                ? question.contentJson
                : null,
            objectiveId: objective.id,
            objectiveCode: objective.code,
            objectiveTitle: objective.title,
            strand: objective.strand,
            yearGroup: objective.yearGroup,
            rationale:
              "Generated top-up question to maintain the 20-question minimum after Oak duplicate filtering.",
            vectorTitles,
            matchScore: 1,
            vectorSource: "GENERATED_TOP_UP",
          })
        ) {
          break;
        }
      }
    }

    return {
      key: `round-${index + 1}`,
      title: `Question ${index + 1}`,
      purpose:
        "Personalised practice for the current lesson objective.",
      durationMinutes: 10,
      questions: picked.map(describeQuestion),
    };
  }));

  return objectiveRounds.filter((round) => round.questions.length > 0) satisfies PersonalisedQuestionRound[];
}

async function buildLessonObjectiveBundle(input: {
  objective: LessonObjective;
  childProfile: Awaited<ReturnType<typeof buildCombinedChildProfile>>;
}): Promise<LessonObjective[]> {
  return [input.objective];
}

type DeliveryObjectiveRow = LessonObjective & {
  source: {
    slug: string;
    name: string;
    url: string | null;
  };
  chunks: Array<{
    id: string;
    type: ChunkType;
    difficulty: DifficultyBand;
    content: string;
    citations: string[];
    tags: string[];
  }>;
  canonicalQuestions: Array<{
    id: string;
    sequence: number;
    itemType: CanonicalItemType;
    operator: CanonicalOperator | null;
    lhsA: number | null;
    lhsB: number | null;
    rhs: number | null;
    equation: string | null;
    promptText: string;
    answerText: string;
    difficulty: DifficultyBand;
    contentJson: unknown;
    generatorVersion: string | null;
    generatorMeta: unknown;
  }>;
};

type GeneratedEvidence = {
  chunks: DeliveryObjectiveRow["chunks"];
  canonicalQuestions: DeliveryObjectiveRow["canonicalQuestions"];
  notes: string[];
};

function objectiveUnitSlug(code: string): string | null {
  const parts = code.split(":").map((part) => part.trim()).filter(Boolean);
  return parts.length >= 4 && parts[0] === "oak" ? parts[3] : null;
}

function objectiveEvidenceText(objective: LessonObjective): string {
  return [
    objective.title,
    objective.statement,
    objective.strand,
    ...objective.keywords,
  ].join("\n");
}

function makeGeneratedChunk(input: {
  objective: LessonObjective;
  type: ChunkType;
  suffix: string;
  content: string;
  citations?: string[];
  tags?: string[];
}): DeliveryObjectiveRow["chunks"][number] {
  return {
    id: `generated_chunk_${sha256(`${input.objective.id}:${input.suffix}:${input.content}`).slice(0, 24)}`,
    type: input.type,
    difficulty: "MEDIUM",
    content: input.content,
    citations: input.citations ?? [],
    tags: ["generated", "llm-fallback", ...(input.tags ?? [])],
  };
}

function makeGeneratedQuestion(input: {
  objective: LessonObjective;
  sequence: number;
  promptText: string;
  answerText: string;
  choices?: string[];
  itemType?: CanonicalItemType;
}): DeliveryObjectiveRow["canonicalQuestions"][number] {
  const choices = buildGeneratedChoices(input.answerText, input.promptText, input.choices);
  return {
    id: `generated_question_${sha256(`${input.objective.id}:${input.sequence}:${input.promptText}`).slice(0, 24)}`,
    sequence: input.sequence,
    itemType: input.itemType ?? "OAK_MULTIPLE_CHOICE",
    operator: null,
    lhsA: null,
    lhsB: null,
    rhs: null,
    equation: null,
    promptText: input.promptText,
    answerText: input.answerText,
    difficulty: "MEDIUM",
    contentJson: {
      generated: true,
      source: "llm-fallback",
      objectiveCode: input.objective.code,
      answerContract: "single_choice",
      canonicalTruth: {
        answerContract: "single_choice",
        immutableAnswers: [input.answerText],
        immutableDistractors: choices.filter((choice) => normaliseText(choice).toLowerCase() !== normaliseText(input.answerText).toLowerCase()),
        optionBank: choices,
        requiredAnswerCount: 1,
        originalQuestion: input.promptText,
      },
      oak: {
        source: "generated-objective-top-up",
        questionType: "multiple-choice",
        derivedQuestionType: "single_choice",
        choices: choices.map((choice) => ({
          label: choice,
          isCorrect: normaliseText(choice).toLowerCase() === normaliseText(input.answerText).toLowerCase(),
        })),
      },
    },
    generatorVersion: "mylisa-llm-fallback-v1",
    generatorMeta: {
      source: "llm-fallback",
      reason: "No Oak canonical question was available in the local catalogue.",
    },
  };
}

function buildGeneratedChoices(answerText: string, promptText: string, choices?: string[]): string[] {
  const answer = clean(answerText);
  const seen = new Set<string>();
  const out: string[] = [];
  const add = (value: string | null | undefined) => {
    const cleaned = clean(value);
    const key = cleaned.toLowerCase();
    if (!cleaned || seen.has(key)) return;
    seen.add(key);
    out.push(cleaned);
  };

  add(answer);
  for (const choice of choices ?? []) add(choice);

  const numeric = Number(answer.replace(/[^\d.-]/g, ""));
  if (Number.isFinite(numeric) && /\d/.test(answer)) {
    const suffix = answer.replace(String(numeric), "").trim();
    add(`${numeric + 1}${suffix ? ` ${suffix}` : ""}`);
    add(`${numeric - 1}${suffix ? ` ${suffix}` : ""}`);
    add(`${numeric * 2}${suffix ? ` ${suffix}` : ""}`);
  }

  add("A different answer");
  add("Not enough information");
  add("A related idea from another objective");
  add("The opposite of the correct idea");

  const firstFour = out.slice(0, 4);
  if (firstFour.length <= 1) return firstFour;
  const offset = Number.parseInt(sha256(`${promptText}:${answerText}`).slice(0, 2), 16) % firstFour.length;
  return [...firstFour.slice(offset), ...firstFour.slice(0, offset)];
}

function parseIntegerText(value: string): number | null {
  const parsed = Number(value.replace(/,/g, ""));
  return Number.isInteger(parsed) ? parsed : null;
}

function formatIntegerText(value: number): string {
  return new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(value);
}

function parseBlankRange(promptText: string): {
  lower: number;
  upper: number;
  promptRangeText: string;
} | null {
  const blank = String.raw`(?:_{2,}|blank|the blank)`;
  const ascending = promptText.match(new RegExp(String.raw`(\d[\d,]*)\s*<\s*${blank}\s*<\s*(\d[\d,]*)`, "i"));
  if (ascending) {
    const lower = parseIntegerText(ascending[1] ?? "");
    const upper = parseIntegerText(ascending[2] ?? "");
    if (lower == null || upper == null || lower >= upper) return null;
    return {
      lower,
      upper,
      promptRangeText: `${ascending[1]} < ___ < ${ascending[2]}`,
    };
  }

  const descending = promptText.match(new RegExp(String.raw`(\d[\d,]*)\s*>\s*${blank}\s*>\s*(\d[\d,]*)`, "i"));
  if (!descending) return null;
  const upper = parseIntegerText(descending[1] ?? "");
  const lower = parseIntegerText(descending[2] ?? "");
  if (lower == null || upper == null || lower >= upper) return null;
  return {
    lower,
    upper,
    promptRangeText: `${descending[1]} > ___ > ${descending[2]}`,
  };
}

function generatedRangeChoices(input: {
  lower: number;
  upper: number;
  answerText: string;
}): { answerText: string; choices: string[] } {
  const existingAnswer = parseIntegerText(input.answerText);
  const midpoint = input.lower + Math.max(1, Math.floor((input.upper - input.lower) / 2));
  const correct = existingAnswer != null && existingAnswer > input.lower && existingAnswer < input.upper
    ? existingAnswer
    : midpoint;
  const distractors = [
    input.lower - 1,
    input.lower,
    input.upper,
    input.upper + 1,
    input.lower - 10,
    input.upper + 10,
  ].filter((value) => value !== correct);
  return {
    answerText: formatIntegerText(correct),
    choices: [
      correct,
      ...distractors.slice(0, 3),
    ].map(formatIntegerText),
  };
}

function repairGeneratedQuestionShape(input: {
  promptText: string;
  answerText: string;
  choices?: string[];
}) {
  const range = parseBlankRange(input.promptText);
  if (!range) return input;

  const asksNegative = /does\s+not\s+fit|not\s+fit/i.test(input.promptText);
  const asksFit = /fit/i.test(input.promptText);
  if (!asksNegative && !asksFit) return input;

  const repaired = generatedRangeChoices({
    lower: range.lower,
    upper: range.upper,
    answerText: input.answerText,
  });

  return {
    promptText: `Which number fits in the blank? ${range.promptRangeText}`,
    answerText: repaired.answerText,
    choices: repaired.choices,
  };
}

function generatedSequenceQuestions(objective: LessonObjective, startSequence = 1): DeliveryObjectiveRow["canonicalQuestions"] {
  const nextTerms = [
    { sequenceText: "3, 6, 9, 12, __, __", answer: "15, 18", choices: ["15, 18", "14, 16", "18, 21", "12, 15"] },
    { sequenceText: "5, 10, 15, 20, __, __", answer: "25, 30", choices: ["25, 30", "24, 28", "30, 35", "20, 25"] },
    { sequenceText: "7, 14, 21, 28, __, __", answer: "35, 42", choices: ["35, 42", "34, 41", "42, 49", "28, 35"] },
    { sequenceText: "4, 8, 12, 16, __, __", answer: "20, 24", choices: ["20, 24", "18, 20", "24, 28", "16, 20"] },
    { sequenceText: "2, 5, 8, 11, __, __", answer: "14, 17", choices: ["14, 17", "13, 15", "15, 19", "11, 14"] },
    { sequenceText: "10, 20, 30, 40, __, __", answer: "50, 60", choices: ["50, 60", "45, 50", "60, 70", "40, 50"] },
  ].map((item, index) => ({
    promptText: `Find the next two terms: ${item.sequenceText}`,
    answerText: item.answer,
    choices: item.choices,
    section: "next-terms",
    index,
  }));

  const rules = [
    { sequenceText: "6, 12, 18, 24", answer: "Add 6", choices: ["Add 6", "Add 4", "Multiply by 6", "Subtract 6"] },
    { sequenceText: "9, 18, 27, 36", answer: "Add 9", choices: ["Add 9", "Add 6", "Multiply by 9", "Subtract 9"] },
    { sequenceText: "4, 8, 12, 16", answer: "Add 4", choices: ["Add 4", "Add 2", "Multiply by 4", "Subtract 4"] },
    { sequenceText: "2, 5, 8, 11", answer: "Add 3", choices: ["Add 3", "Add 2", "Multiply by 3", "Subtract 3"] },
    { sequenceText: "7, 12, 17, 22", answer: "Add 5", choices: ["Add 5", "Add 7", "Multiply by 5", "Subtract 5"] },
    { sequenceText: "11, 22, 33, 44", answer: "Add 11", choices: ["Add 11", "Add 10", "Multiply by 11", "Subtract 11"] },
  ].map((item, index) => ({
    promptText: `Write the rule for this sequence: ${item.sequenceText}`,
    answerText: item.answer,
    choices: item.choices,
    section: "rule",
    index,
  }));

  const nthTerms = [
    { sequenceText: "3, 6, 9, 12", answer: "3n", choices: ["3n", "n + 3", "3n + 1", "n/3"] },
    { sequenceText: "5, 10, 15, 20", answer: "5n", choices: ["5n", "n + 5", "5n + 1", "n/5"] },
    { sequenceText: "2, 4, 6, 8", answer: "2n", choices: ["2n", "n + 2", "2n + 1", "n/2"] },
    { sequenceText: "4, 8, 12, 16", answer: "4n", choices: ["4n", "n + 4", "4n + 1", "n/4"] },
    { sequenceText: "3, 5, 7, 9", answer: "2n + 1", choices: ["2n + 1", "2n - 1", "3n", "n + 2"] },
    { sequenceText: "4, 7, 10, 13", answer: "3n + 1", choices: ["3n + 1", "3n - 1", "4n", "n + 3"] },
    { sequenceText: "6, 11, 16, 21", answer: "5n + 1", choices: ["5n + 1", "5n - 1", "6n", "n + 5"] },
    { sequenceText: "8, 11, 14, 17", answer: "3n + 5", choices: ["3n + 5", "3n - 5", "8n", "n + 3"] },
  ].map((item, index) => ({
    promptText: `Find the nth term of this linear sequence: ${item.sequenceText}`,
    answerText: item.answer,
    choices: item.choices,
    section: "nth-term",
    index,
  }));

  const substitutions = [
    { promptText: "Find the 10th term of 3n + 2.", answer: "32", choices: ["32", "30", "35", "12"] },
    { promptText: "Find the 8th term of 5n.", answer: "40", choices: ["40", "13", "35", "45"] },
    { promptText: "Find the 12th term of 2n + 1.", answer: "25", choices: ["25", "24", "26", "13"] },
    { promptText: "Find the 6th term of 4n + 3.", answer: "27", choices: ["27", "24", "31", "13"] },
    { promptText: "Find the 20th term of 10n.", answer: "200", choices: ["200", "30", "210", "100"] },
    { promptText: "Find the 15th term of 3n + 1.", answer: "46", choices: ["46", "45", "48", "16"] },
  ].map((item, index) => ({
    promptText: item.promptText,
    answerText: item.answer,
    choices: item.choices,
    section: "use-nth-term",
    index,
  }));

  return [...nextTerms, ...rules, ...nthTerms, ...substitutions].map((item, index) => {
    const question = makeGeneratedQuestion({
      objective,
      sequence: startSequence + index,
      promptText: item.promptText,
      answerText: item.answerText,
      choices: item.choices,
    });
    return {
      ...question,
      difficulty: index < 12 ? "EASY" : "MEDIUM",
      contentJson: {
        ...(question.contentJson as Record<string, unknown>),
        source: "deterministic-sequence-worksheet",
        section: item.section,
        sectionIndex: item.index + 1,
        objectiveCode: objective.code,
      },
      generatorVersion: "mylisa-sequence-worksheet-v1",
      generatorMeta: {
        source: "deterministic-sequence-worksheet",
        section: item.section,
      },
    };
  });
}

function generatedLinearEquationQuestions(objective: LessonObjective, startSequence = 1): DeliveryObjectiveRow["canonicalQuestions"] {
  const items = [
    {
      promptText: "Solve 3x = 18. What is x?",
      answerText: "6",
      choices: ["6", "15", "21", "54"],
    },
    {
      promptText: "Solve x + 7 = 19. What is x?",
      answerText: "12",
      choices: ["12", "26", "7", "19"],
    },
    {
      promptText: "Solve x - 5 = 14. What is x?",
      answerText: "19",
      choices: ["19", "9", "14", "70"],
    },
    {
      promptText: "Solve x/4 = 9. What is the most efficient first step?",
      answerText: "Multiply both sides by 4",
      choices: ["Multiply both sides by 4", "Divide both sides by 4", "Add 4 to both sides", "Subtract 9 from both sides"],
    },
    {
      promptText: "Solve 5x + 2 = 27. What is the first inverse step?",
      answerText: "Subtract 2 from both sides",
      choices: ["Subtract 2 from both sides", "Divide both sides by 5", "Add 2 to both sides", "Multiply both sides by 5"],
    },
    {
      promptText: "Solve 2x - 3 = 11. What is x?",
      answerText: "7",
      choices: ["7", "4", "14", "22"],
    },
    {
      promptText: "Solve 4x + 6 = 30. What is x?",
      answerText: "6",
      choices: ["6", "9", "24", "36"],
    },
    {
      promptText: "Solve 7x = 42. Which operation isolates x?",
      answerText: "Divide both sides by 7",
      choices: ["Divide both sides by 7", "Multiply both sides by 7", "Subtract 7 from both sides", "Add 42 to both sides"],
    },
    {
      promptText: "Solve x/3 + 4 = 10. What is the first inverse step?",
      answerText: "Subtract 4 from both sides",
      choices: ["Subtract 4 from both sides", "Multiply both sides by 3", "Divide both sides by 3", "Add 4 to both sides"],
    },
    {
      promptText: "Solve 6x - 8 = 22. What is x?",
      answerText: "5",
      choices: ["5", "3", "14", "30"],
    },
    {
      promptText: "Solve 3(x + 2) = 21. What is the most efficient first step?",
      answerText: "Divide both sides by 3",
      choices: ["Divide both sides by 3", "Add 2 to both sides", "Subtract 21 from both sides", "Multiply both sides by 3"],
    },
    {
      promptText: "Solve (x - 4)/2 = 6. What is the first inverse step?",
      answerText: "Multiply both sides by 2",
      choices: ["Multiply both sides by 2", "Subtract 4 from both sides", "Divide both sides by 2", "Add 6 to both sides"],
    },
    {
      promptText: "Solve 9 = x + 2. What is x?",
      answerText: "7",
      choices: ["7", "11", "18", "2"],
    },
    {
      promptText: "Solve 20 = 4x. What is x?",
      answerText: "5",
      choices: ["5", "16", "24", "80"],
    },
    {
      promptText: "Solve 2(x - 1) = 10. What is x?",
      answerText: "6",
      choices: ["6", "4", "5", "20"],
    },
    {
      promptText: "Solve 12 = 3x + 3. What is the first inverse step?",
      answerText: "Subtract 3 from both sides",
      choices: ["Subtract 3 from both sides", "Divide both sides by 3", "Add 3 to both sides", "Multiply both sides by 3"],
    },
    {
      promptText: "Solve x/5 = 8. What is x?",
      answerText: "40",
      choices: ["40", "13", "3", "8"],
    },
    {
      promptText: "Solve 4 + x = 15. What operation isolates x?",
      answerText: "Subtract 4 from both sides",
      choices: ["Subtract 4 from both sides", "Add 4 to both sides", "Divide both sides by 4", "Multiply both sides by 15"],
    },
    {
      promptText: "Solve 8x - 1 = 31. What is x?",
      answerText: "4",
      choices: ["4", "3", "30", "32"],
    },
    {
      promptText: "Solve (3x)/5 = 9. What is a valid first step?",
      answerText: "Multiply both sides by 5",
      choices: ["Multiply both sides by 5", "Divide both sides by 5", "Subtract 3 from both sides", "Add 9 to both sides"],
    },
  ];

  return items.map((item, index) => {
    const question = makeGeneratedQuestion({
      objective,
      sequence: startSequence + index,
      promptText: item.promptText,
      answerText: item.answerText,
      choices: item.choices,
    });
    return {
      ...question,
      difficulty: index < 10 ? "EASY" : "MEDIUM",
      contentJson: {
        ...(question.contentJson as Record<string, unknown>),
        source: "deterministic-linear-equations-top-up",
        strand: objective.strand,
        objectiveId: objective.id,
      },
      generatorVersion: "mylisa-linear-equations-mcq-top-up-v1",
      generatorMeta: {
        source: "deterministic-linear-equations-top-up",
        reason: "Generated MCQs for a thin Oak canonical pool, scoped to the selected linear-equations objective and strand.",
      },
    };
  });
}

function deterministicTopUpQuestions(
  objective: LessonObjective,
  existingCount: number,
): DeliveryObjectiveRow["canonicalQuestions"] {
  if (isSequenceObjective(objective)) {
    return generatedSequenceQuestions(objective, existingCount + 1);
  }
  if (isLinearEquationObjective(objective)) {
    return generatedLinearEquationQuestions(objective, existingCount + 1);
  }

  const focus = objective.title || objective.statement || objective.strand;
  const prompts = isMathsGeometryObjective(objective)
    ? [
        ["How many sides does a hexagon have?", "6"],
        ["How many sides does an octagon have?", "8"],
        ["How many faces does a cube have?", "6"],
        ["How many edges does a cube have?", "12"],
        ["How many vertices does a cube have?", "8"],
        ["Which word means a shape has equal sides and equal angles?", "regular"],
        ["A triangle has angles of 60 degrees and 70 degrees. What is the missing angle?", "50 degrees"],
        ["A quadrilateral has angles of 90 degrees, 90 degrees and 80 degrees. What is the missing angle?", "100 degrees"],
        ["Which shape has four equal sides and four right angles?", "square"],
        ["Which 3D shape has 6 faces, 12 edges and 8 vertices?", "cuboid"],
        ["What do we call a flat pattern that folds to make a 3D shape?", "net"],
        ["A pentagon has how many sides?", "5"],
        ["A regular polygon has equal sides. What else is equal?", "angles"],
        ["Which property helps you tell a rectangle from a parallelogram?", "right angles"],
        ["Angles in a triangle add to what total?", "180 degrees"],
        ["Angles in a quadrilateral add to what total?", "360 degrees"],
        ["Which shape has exactly one pair of parallel sides?", "trapezium"],
        ["Which shape has opposite sides equal and four right angles?", "rectangle"],
        ["How many vertices does a triangular prism have?", "6"],
        ["How many faces does a triangular prism have?", "5"],
      ]
    : isScienceAtmosphereClimateObjective(objective)
      ? [
          ["Name the two most common gases in Earth's atmosphere.", "Nitrogen and oxygen"],
          ["Which gas makes up most of Earth's atmosphere?", "Nitrogen"],
          ["Which gas is needed for fuels to combust?", "Oxygen"],
          ["What is produced when a fuel containing carbon burns completely?", "Carbon dioxide"],
          ["What does carbon dioxide contain?", "Carbon and oxygen atoms"],
          ["What is a greenhouse gas?", "A gas that absorbs infrared radiation and helps warm the atmosphere"],
          ["Give one example of a greenhouse gas.", "Carbon dioxide"],
          ["What is global warming?", "A long-term rise in Earth's average temperature"],
          ["How can human activity increase carbon dioxide in the atmosphere?", "By burning fossil fuels"],
          ["Name one fossil fuel.", "Coal, oil or natural gas"],
          ["Why does burning fossil fuels affect the carbon cycle?", "It moves stored carbon into the atmosphere as carbon dioxide"],
          ["What happens to infrared radiation when greenhouse gases absorb it?", "Some energy is retained in the atmosphere"],
          ["What is climate change?", "Long-term change in weather patterns and average conditions"],
          ["Why is carbon dioxide described as a compound?", "It contains more than one type of atom chemically joined"],
          ["What word describes a substance made from only one type of atom?", "Element"],
          ["What is combustion?", "A chemical reaction with oxygen that releases energy"],
          ["Why can more greenhouse gases warm Earth?", "They increase how much infrared radiation is absorbed by the atmosphere"],
          ["Give one human activity that releases carbon dioxide.", "Burning fuel for transport, heating, electricity or industry"],
          ["What evidence would show carbon dioxide concentration has changed?", "Measurements showing carbon dioxide levels over time"],
          ["State one way to reduce carbon dioxide emissions.", "Use less fossil fuel or use renewable energy"],
        ]
      : [
          [`Which option is the selected objective for this question round?`, focus, [focus, objective.strand, "A different strand from the course", "A revision topic chosen at random"]],
          [`Which strand should these generated questions stay inside?`, objective.strand, [objective.strand, "Number facts only", "A lower-year prerequisite", "Any related topic"]],
          [`Which option is the safest rule for this practice round?`, "Stay inside the selected objective and strand", ["Stay inside the selected objective and strand", "Switch to an easier unrelated topic", "Ask for a written explanation only", "Use any topic with similar vocabulary"]],
          [`Which answer type should a generated student question use here?`, "Multiple choice", ["Multiple choice", "Long written explanation", "Unmarked free text", "Tutor-only note"]],
          [`Which option best describes a good check question for this objective?`, "It directly practises the selected objective", ["It directly practises the selected objective", "It asks about the whole subject", "It checks a different year group", "It asks for a personal opinion"]],
          [`Which option would be off-scope for this objective?`, "A question from a different strand", ["A question from a different strand", "A question using the same objective vocabulary", "A question with one correct answer", "A question with plausible distractors"]],
          [`Which source should decide the objective scope?`, "The selected Oak objective", ["The selected Oak objective", "The generated wording", "The easiest available question", "The student's favourite topic"]],
          [`Which option makes a distractor useful?`, "It is plausible but incorrect for this objective", ["It is plausible but incorrect for this objective", "It is obviously silly", "It is the same as the answer", "It belongs to a different subject"]],
          [`Which option should every generated question preserve?`, "The selected objective and strand", ["The selected objective and strand", "A generic summary prompt", "A different key stage", "An unrelated prerequisite"]],
          [`Which item belongs in the answer options?`, "One correct answer and plausible distractors", ["One correct answer and plausible distractors", "Only a blank text box", "Hints mixed with answers", "No correct answer"]],
          [`Which option is most useful for a learner during practice?`, "A focused question with clear choices", ["A focused question with clear choices", "A broad essay question", "A vague reflection prompt", "A tutor planning note"]],
          [`What should a generated fallback never pretend to be?`, "An Oak canonical question", ["An Oak canonical question", "Tutor-reviewed support", "Generated practice", "A non-Oak top-up"]],
          [`Which option best matches objective-led practice?`, "Use the objective statement to decide the skill", ["Use the objective statement to decide the skill", "Choose a random easier skill", "Ask about general confidence", "Ignore the strand"]],
          [`Which option keeps the learner screen usable?`, "Show answer choices as buttons", ["Show answer choices as buttons", "Require long typed answers", "Show tutor notes as questions", "Hide the answer choices"]],
          [`Which option should happen when Oak questions are thin?`, "Use clearly generated MCQ top-ups scoped to the same objective", ["Use clearly generated MCQ top-ups scoped to the same objective", "Backfill from another strand", "Use short-answer summary prompts", "Change the selected objective"]],
          [`Which option describes the correct generated-question boundary?`, "Same subject, strand, and objective", ["Same subject, strand, and objective", "Same broad subject only", "Any objective in the key stage", "Any question with matching words"]],
          [`Which option is a poor generated question?`, "Name a key word and explain it", ["Name a key word and explain it", "Choose the correct method from four choices", "Pick the correct answer from plausible options", "Select the statement matching the objective"]],
          [`Which option is a good generated question?`, "A focused multiple-choice check with one correct answer", ["A focused multiple-choice check with one correct answer", "A free-text objective summary", "A question from another strand", "A prompt with no markable answer"]],
          [`Which option should the tutor be able to trust?`, "Generated items are tagged and scoped", ["Generated items are tagged and scoped", "Generated items are labelled as Oak", "Generated items can change strand", "Generated items can be unmarkable"]],
          [`Which option is the selected practice focus?`, focus, [focus, "A generic key-word explanation", "A different objective", "A lower-year warm-up only"]],
        ];

  const source = isMathsGeometryObjective(objective)
    ? "deterministic-maths-geometry-top-up"
    : isScienceAtmosphereClimateObjective(objective)
      ? "deterministic-science-atmosphere-climate-top-up"
      : "deterministic-objective-strand-top-up";
  const generatorVersion = isMathsGeometryObjective(objective)
    ? "mylisa-maths-geometry-top-up-v2"
    : isScienceAtmosphereClimateObjective(objective)
      ? "mylisa-science-atmosphere-climate-top-up-v1"
      : "mylisa-objective-strand-top-up-v1";

  return prompts.map(([promptText, answerText, choices], index) => {
    const question = makeGeneratedQuestion({
      objective,
      sequence: existingCount + index + 1,
      promptText: String(promptText),
      answerText: String(answerText),
      choices: Array.isArray(choices) ? choices.map(String) : undefined,
    });
    return {
      ...question,
      difficulty: index < 12 ? "EASY" : "MEDIUM",
      contentJson: {
        ...(question.contentJson as Record<string, unknown>),
        source,
        objectiveCode: objective.code,
        subject: objective.subject,
        strand: objective.strand,
        pedagogy: "Multiple-choice retrieval/check question matched to the selected objective and strand.",
      },
      generatorVersion,
      generatorMeta: {
        source,
        reason: "Unique Oak question pool was below the target minimum; generated questions must stay inside the selected objective, subject and strand.",
      },
    };
  });
}

async function fetchOakLiveEvidence(objective: LessonObjective): Promise<{
  chunks: DeliveryObjectiveRow["chunks"];
  questions: DeliveryObjectiveRow["canonicalQuestions"];
  notes: string[];
}> {
  const unitSlug = objectiveUnitSlug(objective.code);
  if (!unitSlug) return { chunks: [], questions: [], notes: ["No Oak unit slug could be derived from the objective code."] };

  try {
    const { oakGet } = await import("../lib/oakClient.js");
    const unit = await oakGet<any>(`/units/${unitSlug}/summary`);
    const lessons = Array.isArray(unit?.lessons)
      ? unit.lessons
      : Array.isArray(unit?.lessonTitles)
        ? unit.lessonTitles.map((lessonTitle: string) => ({ lessonTitle }))
        : [];
    const targetTokens = makeTokenSet([
      objective.title,
      objective.statement,
      objective.strand,
      ...objective.keywords,
    ]);
    const scoredLessons = lessons
      .filter((lesson: any) => clean(lesson?.lessonSlug))
      .map((lesson: any) => ({
        lesson,
        score: overlapCount(makeTokenSet([lesson.lessonTitle, lesson.pupilLessonOutcome]), targetTokens),
      }))
      .sort((a: any, b: any) => b.score - a.score)
      .slice(0, 3);

    const chunks: DeliveryObjectiveRow["chunks"] = [];
    const questions: DeliveryObjectiveRow["canonicalQuestions"] = [];
    for (const { lesson } of scoredLessons) {
      const lessonSlug = clean(lesson.lessonSlug);
      const [summary, quiz] = await Promise.all([
        oakGet<any>(`/lessons/${lessonSlug}/summary`).catch(() => null),
        oakGet<any>(`/lessons/${lessonSlug}/quiz`).catch(() => null),
      ]);

      const summaryLines = [
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
      ].filter(Boolean);
      if (summaryLines.length > 1) {
        chunks.push(makeGeneratedChunk({
          objective,
          type: "EXPLANATION",
          suffix: `oak-live-summary-${lessonSlug}`,
          content: summaryLines.join("\n"),
          citations: [`/units/${unitSlug}/summary`, `/lessons/${lessonSlug}/summary`],
          tags: ["oak-live", "summary"],
        }));
      }

      const quizItems = [
        ...(Array.isArray(quiz?.starterQuiz) ? quiz.starterQuiz : []),
        ...(Array.isArray(quiz?.exitQuiz) ? quiz.exitQuiz : []),
      ];
      for (const item of quizItems.slice(0, 6)) {
        const prompt = clean(item?.question ?? item?.questionStem?.text ?? item?.questionStem ?? item?.prompt);
        const answer = clean(
          item?.answer ??
            item?.correctAnswer ??
            item?.answers?.find?.((answerItem: any) => answerItem?.answerIsCorrect)?.answer ??
            item?.answers?.[0]?.answer,
        );
        if (!prompt || !answer) continue;
        const choices = Array.isArray(item?.answers)
          ? item.answers
              .map((answerItem: any) =>
                clean(answerItem?.answer ?? answerItem?.text ?? answerItem?.label ?? answerItem?.value),
              )
              .filter(Boolean)
          : undefined;
        const question = makeGeneratedQuestion({
          objective,
          sequence: questions.length + 1,
          promptText: prompt,
          answerText: answer,
          choices,
        });
        questions.push({
          ...question,
          contentJson: {
            ...(question.contentJson as Record<string, unknown>),
            generated: false,
            source: "oak-live",
            oak: {
              ...((question.contentJson as any)?.oak ?? {}),
              lessonSlug,
              unitSlug,
              rawQuestion: item,
            },
          },
          generatorVersion: "oak-live-runtime-v1",
          generatorMeta: {
            source: "oak-live",
            lessonSlug,
            unitSlug,
          },
        });
      }
    }

    return {
      chunks,
      questions,
      notes: [`Checked Oak live API for unit ${unitSlug}.`],
    };
  } catch (error) {
    return {
      chunks: [],
      questions: [],
      notes: [`Oak live API check failed: ${error instanceof Error ? error.message : "unknown error"}`],
    };
  }
}

function fallbackGeneratedEvidence(objective: LessonObjective): GeneratedEvidence {
  const focus = objective.title || objective.statement || objective.strand;
  return {
    notes: ["Used deterministic generated evidence because the LLM was unavailable."],
    chunks: [
      makeGeneratedChunk({
        objective,
        type: "EXPLANATION",
        suffix: "explanation",
        content: [
          `Objective: ${focus}`,
          "Teach the exact objective with a visible worked example, not a loose topic summary.",
          "Start by naming the representation the learner must use: diagram, table, graph, formula, vocabulary, or calculation.",
          "Model one complete example in small steps: read the prompt, identify known information, choose the method, carry out the method, then check the answer against the question.",
          "Keep every important number, label, unit, symbol, or category visible while learners practise.",
        ].join("\n"),
      }),
      makeGeneratedChunk({
        objective,
        type: "WORKED_EXAMPLE",
        suffix: "worked-example",
        content: [
          `Worked example for ${focus}`,
          "1. Read the question and underline exactly what must be found or explained.",
          "2. List the facts or values already given.",
          "3. Choose the representation or method that matches those facts.",
          "4. Complete the method one line at a time.",
          "5. Say why the answer fits the objective vocabulary.",
          "6. Check for units, labels, accuracy, and reasonableness.",
        ].join("\n"),
      }),
      makeGeneratedChunk({
        objective,
        type: "MISCONCEPTION",
        suffix: "misconception",
        content: "Learners may copy a procedure without matching it to the question. Repair by returning to the exact words in the objective, then asking what representation or method those words require.",
      }),
    ],
    canonicalQuestions: deterministicTopUpQuestions(objective, 0),
  };
}

async function callEvidenceFallbackLlm(input: {
  objective: LessonObjective;
  needsChunks: boolean;
  needsQuestions: boolean;
  oakNotes: string[];
}): Promise<GeneratedEvidence> {
  const endpoint = azureEndpointBase();
  const deployment = clean(process.env.AZURE_OPENAI_DEPLOYMENT);
  const apiVersion = clean(process.env.AZURE_OPENAI_API_VERSION) || "2025-01-01-preview";
  const response = await fetch(
    `${endpoint}/openai/deployments/${encodeURIComponent(deployment)}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": clean(process.env.AZURE_OPENAI_API_KEY),
      },
      body: JSON.stringify({
        max_completion_tokens: 8000,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: [
              "You generate missing lesson evidence for MyLisa when Oak has no local chunks or canonical questions.",
              "Create objective-specific, tutor-usable content with substance, not generic prose.",
              "If the objective needs a chart, table, diagram, formula, graph, timeline, code trace, or science model, state the exact representation and the data/labels to show.",
              "For neurodiverse learners, include small steps, explicit vocabulary, checks, misconception repair, and one complete worked example.",
              "Return JSON only.",
            ].join("\n"),
          },
          {
            role: "user",
            content: JSON.stringify({
              objective: input.objective,
              needsChunks: input.needsChunks,
              needsQuestions: input.needsQuestions,
              oakLiveApiNotes: input.oakNotes,
              outputContract: {
                chunks: "3-5 objects { type: EXPLANATION|WORKED_EXAMPLE|MISCONCEPTION|PRACTICE|GLOSSARY, content: detailed string }",
                canonicalQuestions: isSequenceObjective(input.objective)
                  ? "At least 20 multiple-choice objects { promptText, answerText, choices: 4 strings }, covering next terms, sequence rule, nth term, and using nth term where relevant."
                  : "At least 20 multiple-choice objects { promptText, answerText, choices: 4 strings }, all tightly aligned to the selected objective and strand, varied in wording and representation, with no duplicate prompts.",
              },
            }),
          },
        ],
      }),
    },
  );

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`Evidence fallback LLM failed: ${response.status} ${response.statusText} ${text}`.slice(0, 500));
  }

  const data = (await response.json()) as any;
  const content = data?.choices?.[0]?.message?.content;
  if (!content || typeof content !== "string") throw new Error("Evidence fallback LLM returned empty content");
  const parsed = JSON.parse(stripJsonFence(content)) as {
    chunks?: Array<{ type?: ChunkType; content?: string }>;
    canonicalQuestions?: Array<{ promptText?: string; answerText?: string; choices?: string[] }>;
  };

  const chunkTypes = new Set<ChunkType>(["OBJECTIVE", "EXPLANATION", "WORKED_EXAMPLE", "MISCONCEPTION", "PRACTICE", "COMMAND_WORDS", "GLOSSARY"]);
  return {
    notes: ["Generated missing evidence with LLM fallback."],
    chunks: (parsed.chunks ?? [])
      .map((chunk, index) => {
        const type = chunkTypes.has(chunk.type as ChunkType) ? (chunk.type as ChunkType) : "EXPLANATION";
        const content = clean(chunk.content);
        return content
          ? makeGeneratedChunk({
              objective: input.objective,
              type,
              suffix: `llm-${index}`,
              content,
            })
          : null;
      })
      .filter((chunk): chunk is DeliveryObjectiveRow["chunks"][number] => Boolean(chunk))
      .slice(0, 6),
    canonicalQuestions: (parsed.canonicalQuestions ?? [])
      .map((question, index) => {
        const rawQuestion = question as typeof question & {
          question?: unknown;
          prompt?: unknown;
          answer?: unknown;
          correctAnswer?: unknown;
          options?: unknown;
        };
        const promptText = clean(
          question.promptText ??
            (typeof rawQuestion.question === "string" ? rawQuestion.question : undefined) ??
            (typeof rawQuestion.prompt === "string" ? rawQuestion.prompt : undefined),
        );
        const answerText = clean(
          question.answerText ??
            (typeof rawQuestion.answer === "string" ? rawQuestion.answer : undefined) ??
            (typeof rawQuestion.correctAnswer === "string" ? rawQuestion.correctAnswer : undefined),
        );
        const choices = Array.isArray(question.choices)
          ? question.choices.map(String)
          : Array.isArray(rawQuestion.options)
            ? rawQuestion.options.map(String)
            : undefined;
        const repaired = repairGeneratedQuestionShape({ promptText, answerText, choices });
        return repaired.promptText && repaired.answerText
          ? makeGeneratedQuestion({
              objective: input.objective,
              sequence: index + 1,
              promptText: repaired.promptText,
              answerText: repaired.answerText,
              choices: repaired.choices,
            })
          : null;
      })
      .filter((question): question is DeliveryObjectiveRow["canonicalQuestions"][number] => Boolean(question))
      .slice(0, 30),
  };
}

async function completeMissingLessonEvidence(objective: DeliveryObjectiveRow): Promise<DeliveryObjectiveRow> {
  const needsChunks = objective.chunks.length === 0;
  const minimumQuestions = minimumGeneratedQuestionCount(objective);
  const existingRenderableQuestionCount = uniqueRenderableQuestionCount(objective.canonicalQuestions);
  const needsQuestions = existingRenderableQuestionCount < minimumQuestions;
  if (!needsChunks && !needsQuestions) return objective;

  const oakLive = await fetchOakLiveEvidence(objective);
  let chunks = needsChunks ? oakLive.chunks : [];
  let canonicalQuestions = needsQuestions ? oakLive.questions : [];
  const stillNeedsChunks = needsChunks && chunks.length === 0;
  const stillNeedsQuestions =
    needsQuestions &&
    uniqueRenderableQuestionCount([...objective.canonicalQuestions, ...canonicalQuestions]) < minimumQuestions;

  if (stillNeedsChunks || stillNeedsQuestions) {
    let generated: GeneratedEvidence;
    if (hasLlmConfig()) {
      try {
        generated = await callEvidenceFallbackLlm({
          objective,
          needsChunks: stillNeedsChunks,
          needsQuestions: stillNeedsQuestions,
          oakNotes: oakLive.notes,
        });
      } catch (error) {
        console.warn(
          `[lesson-delivery] Evidence fallback LLM failed for objective ${objective.id}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
        generated = fallbackGeneratedEvidence(objective);
      }
    } else {
      generated = fallbackGeneratedEvidence(objective);
    }
    if (stillNeedsChunks) chunks = generated.chunks;
    if (stillNeedsQuestions) canonicalQuestions = [...canonicalQuestions, ...generated.canonicalQuestions];
  }

  if (
    needsQuestions &&
    uniqueRenderableQuestionCount([...objective.canonicalQuestions, ...canonicalQuestions]) < minimumQuestions
  ) {
    canonicalQuestions = [
      ...canonicalQuestions,
      ...deterministicTopUpQuestions(
        objective,
        existingRenderableQuestionCount + canonicalQuestions.length,
      ),
    ];
  }

  const seenQuestionPrompts = new Set(
    objective.canonicalQuestions.map((question) => questionUniquenessKey(question)),
  );
  const seenSubstantialAnswers = new Set(
    objective.canonicalQuestions
      .map((question) => answerUniquenessKey(question))
      .filter((answer) => answer.length >= 12 && /\d/.test(answer)),
  );
  const seenStructuralQuestions = new Set(
    objective.canonicalQuestions
      .map((question) => structuralQuestionKey(question))
      .filter(Boolean),
  );
  const dedupedGeneratedQuestions = canonicalQuestions.filter((question) => {
    const key = questionUniquenessKey(question);
    const answerKey = answerUniquenessKey(question);
    const structuralKey = structuralQuestionKey(question);
    if (!key || seenQuestionPrompts.has(key) || !isStudentRenderableQuestion(question)) return false;
    if (answerKey.length >= 12 && /\d/.test(answerKey) && seenSubstantialAnswers.has(answerKey)) return false;
    if (structuralKey && seenStructuralQuestions.has(structuralKey)) return false;
    seenQuestionPrompts.add(key);
    if (answerKey.length >= 12 && /\d/.test(answerKey)) seenSubstantialAnswers.add(answerKey);
    if (structuralKey) seenStructuralQuestions.add(structuralKey);
    return true;
  });

  return {
    ...objective,
    chunks: [...objective.chunks, ...chunks],
    canonicalQuestions: [
      ...objective.canonicalQuestions,
      ...dedupedGeneratedQuestions.slice(0, Math.max(0, minimumQuestions - existingRenderableQuestionCount)).map((question, index) => ({
        ...question,
        sequence: objective.canonicalQuestions.length + index + 1,
      })),
    ],
  };
}

export async function buildLessonDeliveryPlan(params: LessonDeliveryParams) {
  const student = await prisma.student.findUnique({
    where: { id: params.studentId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      age: true,
      keyStage: true,
      preferences: {
        select: {
          tutoringMode: true,
          verbosity: true,
          stepSize: true,
          lowStimulus: true,
          avoidMetaphors: true,
          useBullets: true,
          moreExamples: true,
          frequentCheckIns: true,
          readingLevel: true,
          attentionSpanMins: true,
        },
      },
    },
  });

  if (!student) {
    throw new Error("Student not found");
  }

  const objectiveRow = await prisma.curriculumObjective.findUnique({
    where: { id: params.objectiveId },
    select: {
      id: true,
      organisationId: true,
      code: true,
      subject: true,
      keyStage: true,
      yearGroup: true,
      strand: true,
      title: true,
      statement: true,
      keywords: true,
      source: {
        select: {
          slug: true,
          name: true,
          url: true,
        },
      },
      chunks: {
        where: {
          isActive: true,
        },
        orderBy: [{ type: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          type: true,
          difficulty: true,
          content: true,
          citations: true,
          tags: true,
        },
      },
      canonicalQuestions: {
        where: {
          status: "ACTIVE",
        },
        orderBy: [{ sequence: "asc" }],
        select: {
          id: true,
          sequence: true,
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
          generatorVersion: true,
          generatorMeta: true,
        },
      },
    },
  });

  if (!objectiveRow) {
    throw new Error("Objective not found");
  }

  const objective = await completeMissingLessonEvidence(objectiveRow as DeliveryObjectiveRow);

  const childProfile = await buildCombinedChildProfile({
    studentId: params.studentId,
    subject: objective.subject as Subject,
    assessmentSessionId: params.assessmentSessionId,
    ndscreenSessionId: params.ndscreenSessionId,
  });

  const organisation = await prisma.organisation.findUnique({
    where: { id: objective.organisationId },
    select: { id: true, slug: true, name: true },
  });
  if (!organisation) {
    throw new Error("Organisation not found");
  }

  const objectiveSignals = childProfile.recommendations.objectives.filter(
    (item) => item.objectiveId === objective.id,
  );
  const strandSignals = childProfile.recommendations.strands.filter(
    (item) => normaliseText(item.strand) === normaliseText(objective.strand),
  );
  const interests = buildChildInterests(childProfile);
  const presentationControls = buildPresentationControls(
    childProfile,
    student.preferences,
  );
  const lessonObjectives = await buildLessonObjectiveBundle({
    objective,
    childProfile,
  });
  const matchedSupport = await selectMatchedSupportChunks({
    objective,
    lessonObjectives,
    childProfile,
    selectedChunkIds: params.selectedChunkIds,
  });
  const vectoredQuestionRounds = await buildVectoredQuestionRounds({
    objective,
    lessonObjectives,
    childProfile,
  });
  const vectorTitles = childProfile.wrapperVectors.map((vector) => vector.title);
  const selectedObjectiveChunks = matchedSupport.selected.filter(
    (chunk) => lessonObjectives.some((lessonObjective) => lessonObjective.id === chunk.objectiveId)
  );
  const lessonBlocks = buildLessonSessionBlocks({
    selectedChunks: selectedObjectiveChunks.length > 0 ? selectedObjectiveChunks : matchedSupport.selected,
    vectoredRounds: vectoredQuestionRounds,
    vectorTitles,
    lessonObjectives,
  });
  const lessonSections: LessonSection[] = lessonBlocks.map((block) => ({
    key: block.key,
    title: block.title,
    purpose: block.purpose,
    durationMinutes: block.durationMinutes,
    audience: block.audience,
    mode: block.mode,
    chunkIds: block.chunkIds,
    canonicalQuestionIds: block.canonicalQuestionIds,
  }));

  return {
    organisation,
    child: {
      id: childProfile.child.id,
      displayName: childProfile.child.displayName,
      age: childProfile.child.age,
      schoolYear: childProfile.child.schoolYear,
      keyStage: childProfile.child.keyStage,
      interests,
    },
    curriculum: {
      objective: {
        id: objective.id,
        code: objective.code,
        subject: objective.subject,
        keyStage: objective.keyStage,
        yearGroup: objective.yearGroup,
        strand: objective.strand,
        title: objective.title,
        statement: objective.statement,
        keywords: objective.keywords,
      },
      objectives: lessonObjectives.map((lessonObjective, index) => ({
        id: lessonObjective.id,
        code: lessonObjective.code,
        subject: lessonObjective.subject,
        keyStage: lessonObjective.keyStage,
        yearGroup: lessonObjective.yearGroup,
        strand: lessonObjective.strand,
        title: lessonObjective.title,
        statement: lessonObjective.statement,
        keywords: lessonObjective.keywords,
        role: index === 0 ? "ANCHOR" : "WORKED_EXAMPLE",
      })),
      source: objective.source,
    },
    canonical: {
      sourceOfTruth: true,
      questionCount: objective.canonicalQuestions.length,
      questions: objective.canonicalQuestions,
    },
    oakSupport: {
      chunkCount: matchedSupport.selected.length,
      chunksByType: matchedSupport.byType,
      matchedChunks: matchedSupport.selected,
      candidateChunks: matchedSupport.candidates,
      selectedChunkIds: matchedSupport.selected.map((chunk) => chunk.id),
      autoSelectedChunkIds: matchedSupport.autoSelectedIds,
      isCustomSelection:
        matchedSupport.requestedChunkIds.length > 0 &&
        matchedSupport.selected.length > 0,
    },
    lessonFlow: {
      sectionCount: lessonSections.length,
      sections: lessonSections,
      totalMinutes: lessonBlocks.reduce((sum, block) => sum + block.durationMinutes, 0),
      sessionBlocks: lessonBlocks,
      personalisedQuestionRounds: vectoredQuestionRounds,
    },
    personalization: {
      presentationControls,
      objectiveSignals,
      strandSignals,
      assessment: childProfile.assessment,
      screening: childProfile.screening,
      wrapperVectors: childProfile.wrapperVectors,
    },
    llmContract: {
      invariant: "Canonical subject content stays fixed for every child.",
      wrapper: "The LLM adapts explanation, pacing, confidence support, and familiar context around the canonical items.",
      guardrails: buildLlmGuardrails({
        displayName: childProfile.child.displayName,
        interests,
        presentationControls,
      }),
    },
  };
}

export async function buildLessonDeliveryPlanFromSelection(
  params: LessonDeliverySelectionParams,
) {
  const resolved = await resolveOakCurriculumObjective({
    organisationSlug: params.organisationSlug,
    subject: params.subject,
    keyStage: params.keyStage,
    yearGroup: params.yearGroup,
    strand: params.strand,
    objectiveCode: params.objectiveCode,
    search: params.search,
    requireCanonical: true,
    requireContent: true,
  });

  const delivery = await buildLessonDeliveryPlan({
    studentId: params.studentId,
    objectiveId: resolved.selectedObjective.id,
    assessmentSessionId: params.assessmentSessionId,
    ndscreenSessionId: params.ndscreenSessionId,
    selectedChunkIds: params.selectedChunkIds,
  });

  return {
    resolution: resolved,
    delivery,
  };
}
