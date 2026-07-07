import { DifficultyBand, Subject } from "@prisma/client";
import { answerMaskMatches } from "../lib/answerMask.js";

export type AssessmentStrand = string;

export type AnswerMode = "numeric" | "fraction" | "algebra" | "text" | "multi_part";

export type AssessmentChoiceKey = string;

export type AssessmentChoice = {
  key: AssessmentChoiceKey;
  label: string;
};

export type AssessmentResponseKind =
  | "single_choice"
  | "multi_select"
  | "short_answer"
  | "match"
  | "order";

export type AssessmentMatchPair = {
  left: string;
  right: string;
};

export type AssessmentPoolRow = {
  id: string;
  objectiveId: string;
  itemType?: string | null;
  subject?: Subject | string | null;
  code: string;
  title: string;
  statement?: string | null;
  yearGroup: number | null;
  strand?: string | null;

  promptText: string;
  answerText: string;
  difficulty: DifficultyBand;
  contentJson?: Record<string, unknown> | null;
};

export type RuntimeQuestion = {
  id: string;
  objectiveId: string;
  code: string;
  title: string;
  statement?: string | null;
  yearGroup: number;
  strand: AssessmentStrand;

  promptText: string;
  answerText: string;
  difficulty: DifficultyBand;

  answerMode: AnswerMode;
  answerContract?: string;
  responseKind: AssessmentResponseKind;
  calculatorAllowed: boolean;
  inputHelp?: string;
  choices: AssessmentChoice[];
  correctChoiceKey: AssessmentChoiceKey;
  correctChoiceKeys?: AssessmentChoiceKey[];
  matchPairs?: AssessmentMatchPair[];
  orderedAnswers?: string[];

  contentJson?: Record<string, unknown> | null;
};

export type SkippedAssessmentQuestion = {
  questionId: string;
  reason: string;
  skippedAt: string;
  source: "llm" | "fallback";
};

export type AssessmentResponse = {
  questionId: string;
  rawAnswer: string;
  isCorrect: boolean;
  submittedAt: string;
  selectedChoiceKey?: AssessmentChoiceKey;
  selectedChoiceKeys?: AssessmentChoiceKey[];
  matchPairs?: AssessmentMatchPair[];
  orderedAnswers?: string[];

  yearGroup: number;
  strand: AssessmentStrand;
  difficulty: DifficultyBand;
};

export type StrandStats = {
  strand: AssessmentStrand;

  asked: number;
  correct: number;

  byYear: Record<number, { asked: number; correct: number }>;
  byDifficulty: Record<DifficultyBand, { asked: number; correct: number }>;

  currentTargetYear: number;
  secureYear: number | null;
  emergingYear: number | null;
  confidence: number;
};

export type AssessmentSession = {
  sessionId: string;

  subject: Subject;
  childCurrentYear: number;
  entryYear: number;
  minimumYear: number;
  maximumYear: number;
  activeStrands: AssessmentStrand[];

  maxQuestions: number;
  extensionMaxQuestions: number;

  startedAt: string;
  completedAt?: string;

  questions: RuntimeQuestion[];
  askedQuestionIds: string[];
  responses: AssessmentResponse[];
  skippedQuestions: SkippedAssessmentQuestion[];
  currentBandYear: number;
  minimumBandYear: number;
  maximumBandYear: number;
  bandStartedAtResponseCount: number;

  strands: Record<AssessmentStrand, StrandStats>;
  initialQueue: string[];

  isComplete: boolean;
  completionReason?:
    | "CONFIDENCE_REACHED"
    | "MAX_REACHED"
    | "EXTENSION_MAX_REACHED"
    | "INTERVENTION_NEEDED"
    | "NO_MORE_QUESTIONS";

  overallConfidence: number;
  overallWorkingBand:
    | "BELOW_ENTRY"
    | "ENTRY_SECURE"
    | "ENTRY_SECURE_NEXT_EMERGING"
    | "NEXT_DEVELOPING"
    | "NEXT_SECURE"
    | "INSUFFICIENT_EVIDENCE";
};

export type AssessmentResult = {
  overallWorkingBand: AssessmentSession["overallWorkingBand"];
  overallConfidence: number;
  questionCount: number;
  completionReason?: AssessmentSession["completionReason"];

  strands: Array<{
    strand: AssessmentStrand;
    secureYear: number | null;
    emergingYear: number | null;
    confidence: number;
    asked: number;
    correct: number;
    accuracy: number;
  }>;

  summary: string;
  report?: AssessmentNarrativeReport;
};

export type AssessmentNarrativeReport = {
  displayBandLabel: string;
  displayBandSummary: string;
  parentNarrative: string;
  tutorNarrative: string;
  whatThisMeans: string;
  strengths: string[];
  focusAreas: string[];
  nextSteps: string[];
  tutorActions: string[];
  confidenceNote: string;
};

const MATHS_CORE_STRANDS: AssessmentStrand[] = [
  "NUMBER",
  "ALGEBRA",
  "RATIO",
  "GEOMETRY",
  "DATA",
];

function makeId(): string {
  return `assess_${Math.random().toString(36).slice(2, 10)}_${Date.now()}`;
}

function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function stableSort<T>(items: T[], keyFn: (item: T) => string): T[] {
  return [...items].sort((a, b) => keyFn(a).localeCompare(keyFn(b)));
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function shuffle<T>(items: T[]): T[] {
  const out = [...items];

  for (let i = out.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }

  return out;
}

function safeYear(yearGroup: number | null | undefined): number {
  if (
    typeof yearGroup !== "number" ||
    Number.isNaN(yearGroup) ||
    !Number.isInteger(yearGroup) ||
    yearGroup < 1
  ) {
    throw new Error("Canonical assessment question is missing a valid year group.");
  }
  return yearGroup;
}

function getActiveStrandsFromQuestions(
  questions: RuntimeQuestion[]
): AssessmentStrand[] {
  const seen = new Set<AssessmentStrand>();

  for (const question of questions) {
    seen.add(question.strand);
  }

  return seen.size > 0 ? Array.from(seen) : ["GENERAL"];
}

function getEffectiveStrands(session: AssessmentSession): AssessmentStrand[] {
  return session.activeStrands.length > 0 ? session.activeStrands : ["GENERAL"];
}

function getReportableStrands(session: AssessmentSession): AssessmentStrand[] {
  const effectiveStrands = getEffectiveStrands(session);
  const answeredStrands = effectiveStrands.filter(
    (strand) => (session.strands[strand]?.asked ?? 0) > 0
  );

  return answeredStrands.length > 0 ? answeredStrands : effectiveStrands;
}

function getYearBounds(questions: RuntimeQuestion[], entryYear: number): {
  minimumYear: number;
  maximumYear: number;
} {
  const years = questions
    .map((question) => question.yearGroup)
    .filter((year) => Number.isFinite(year))
    .sort((a, b) => a - b);

  return {
    minimumYear: years[0] ?? entryYear,
    maximumYear: years[years.length - 1] ?? entryYear,
  };
}

function determineEntryYear(
  questions: RuntimeQuestion[],
  childCurrentYear: number
): number {
  const desiredEntryYear = Math.max(1, childCurrentYear - 1);
  return desiredEntryYear;
}

function inferStrand(params: {
  subject?: Subject | string | null;
  title: string;
  code: string;
  statement?: string | null;
  strand?: string | null;
  contentJson?: Record<string, unknown> | null;
}): AssessmentStrand {
  const subject = String(params.subject ?? "").toUpperCase();
  if (subject === Subject.SCIENCE || params.code.toLowerCase().includes(":science:")) {
    return normaliseAssessmentStrand(params.strand ?? params.title ?? "GENERAL_SCIENCE");
  }

  const contentDomain =
    typeof params.contentJson?.domain === "string"
      ? params.contentJson.domain.toLowerCase()
      : "";

  if (
    hasAny(contentDomain, [
      "data",
      "bar_chart",
      "pictogram",
    ])
  ) {
    return "DATA";
  }

  if (
    hasAny(contentDomain, [
      "coordinates",
      "perimeter",
      "symmetry",
      "angles",
      "lines_shapes",
      "shape",
      "geometry",
    ])
  ) {
    return "GEOMETRY";
  }

  if (
    hasAny(contentDomain, [
      "fraction",
      "ratio",
      "proportion",
      "scale",
    ])
  ) {
    return "RATIO";
  }

  if (
    hasAny(contentDomain, [
      "times_tables",
      "count_multiples",
      "multiply_divide",
      "place_value",
      "more_less",
      "compare",
      "add_subtract",
      "measure",
      "money",
      "time",
      "rounding",
      "thousand_more_less",
    ])
  ) {
    return "NUMBER";
  }

  const text = [
    params.title,
    params.code,
    params.statement ?? "",
    params.strand ?? "",
    contentDomain,
  ]
    .join(" ")
    .toLowerCase();

  if (
    hasAny(text, [
      "algebra",
      "equation",
      "substitute",
      "expand",
      "simplify",
      "factorise",
      "expression",
    ])
  ) {
    return "ALGEBRA";
  }

  if (
    hasAny(text, [
      "ratio",
      "proportion",
      "scale",
      "best value",
      "recipe",
      "share in a ratio",
      "divide in a ratio",
    ])
  ) {
    return "RATIO";
  }

  if (
    hasAny(text, [
      "angle",
      "area",
      "perimeter",
      "circle",
      "triangle",
      "shape",
      "geometry",
      "pythagoras",
      "parallelogram",
      "circumference",
      "quadrilateral",
      "isosceles",
    ])
  ) {
    return "GEOMETRY";
  }

  if (
    hasAny(text, [
      "probability",
      "mean",
      "median",
      "mode",
      "range",
      "statistics",
      "data",
      "average",
      "chart",
      "graph",
    ])
  ) {
    return "DATA";
  }

  return "NUMBER";
}

function normaliseAssessmentStrand(value: string): AssessmentStrand {
  const cleaned = value
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) return "GENERAL";

  const upper = cleaned.toUpperCase();
  if (MATHS_CORE_STRANDS.includes(upper)) return upper;

  return cleaned;
}

function cleanAssessmentStrand(value: string | null | undefined): string {
  return (value ?? "").replace(/[_-]+/g, " ").replace(/\s+/g, " ").trim();
}

function inferAnswerMode(
  promptText: string,
  answerText: string,
  itemType?: string | null
): AnswerMode {
  const prompt = promptText.toLowerCase();
  const answer = answerText.trim().toLowerCase();
  const normalizedItemType = String(itemType ?? "").toUpperCase();
  const answerLooksNumeric = /^£?\d+(?:\.\d+)?(?:\s?[a-z°²]+)?$/i.test(answer);
  const isYesNoPrompt = prompt.includes("yes or no");

  if (answer.includes(" and ") || answer.includes(",")) return "multi_part";
  if (answer.includes("/")) return "fraction";
  if (
    ["<", ">", "=", "!=", "≤", "≥"].includes(answer) ||
    prompt.includes("put <") ||
    prompt.includes("put >") ||
    prompt.includes("put =") ||
    (prompt.includes("between") &&
      (prompt.includes("<") || prompt.includes(">") || prompt.includes("=")))
  ) {
    return "text";
  }

  if (
    isYesNoPrompt ||
    prompt.includes("called what")
  ) {
    return "text";
  }

  if (normalizedItemType === "TURN_DIRECTION" && !answerLooksNumeric) {
    return "text";
  }

  if (normalizedItemType === "SHAPE_NAME" && !answerLooksNumeric) {
    return "text";
  }

  if (hasAny(prompt, ["simplify", "expand", "substitute", "formula", "expression"])) {
    return "algebra";
  }

  if (/[a-z]/i.test(answer) && !/^£?\d+(\.\d+)?(cm|m|km|g|kg|p|°|cm²|m²)?$/i.test(answer)) {
    return "text";
  }

  return "numeric";
}

function getCanonicalTruth(contentJson?: Record<string, unknown> | null): Record<string, unknown> | null {
  const truth = contentJson?.canonicalTruth;
  return truth && typeof truth === "object" ? (truth as Record<string, unknown>) : null;
}

function getAnswerContract(contentJson?: Record<string, unknown> | null): string | null {
  if (typeof contentJson?.answerContract === "string") return contentJson.answerContract;
  const truth = getCanonicalTruth(contentJson);
  return typeof truth?.answerContract === "string" ? String(truth.answerContract) : null;
}

function getImmutableAnswers(contentJson?: Record<string, unknown> | null): string[] {
  const answers = getCanonicalTruth(contentJson)?.immutableAnswers;
  if (!Array.isArray(answers)) return [];

  return answers
    .map((answer) => String(answer ?? "").trim())
    .filter((answer) => answer.length > 0);
}

function getPrimaryImmutableAnswer(contentJson?: Record<string, unknown> | null): string | null {
  return getImmutableAnswers(contentJson)[0] ?? null;
}

function getAssessmentAnswerText(
  answerText: string,
  contentJson?: Record<string, unknown> | null
): string {
  const contract = getAnswerContract(contentJson);

  if (contract === "short_answer_alias") {
    return getPrimaryImmutableAnswer(contentJson) ?? answerText.split(" / ")[0]?.trim() ?? answerText;
  }

  return answerText;
}

function getResponseKind(params: {
  itemType?: string | null;
  contentJson?: Record<string, unknown> | null;
}): AssessmentResponseKind {
  const itemType = String(params.itemType ?? "").toUpperCase();
  const contract = getAnswerContract(params.contentJson);

  if (itemType === "OAK_MATCH" || contract === "match") return "match";
  if (itemType === "OAK_ORDER" || contract === "order") return "order";
  if (itemType === "OAK_MULTI_BLANK_CHOICE" || contract === "multi_blank_choice") {
    return "multi_select";
  }
  if (contract === "single_choice") return "single_choice";
  if (contract === "short_answer_alias") return "short_answer";

  return "single_choice";
}

function choiceKey(index: number): AssessmentChoiceKey {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ";
  return alphabet[index] ?? String(index + 1);
}

function choicesFromLabels(labels: string[]): AssessmentChoice[] {
  return labels.map((label, index) => ({ key: choiceKey(index), label }));
}

function getOptionBank(contentJson?: Record<string, unknown> | null): string[] {
  const optionBank = getCanonicalTruth(contentJson)?.optionBank;
  if (!Array.isArray(optionBank)) return [];

  return dedupe(
    optionBank
      .map((option) => String(option ?? "").trim())
      .filter((option) => option.length > 0)
  );
}

function getCorrectChoiceKeys(
  choices: AssessmentChoice[],
  correctAnswers: string[]
): AssessmentChoiceKey[] {
  const correct = new Set(correctAnswers.map(normalizeText));
  return choices
    .filter((choice) => correct.has(normalizeText(choice.label)))
    .map((choice) => choice.key);
}

function getMatchPairs(contentJson?: Record<string, unknown> | null): AssessmentMatchPair[] {
  const pairs = getCanonicalTruth(contentJson)?.matchPairs;
  if (!Array.isArray(pairs)) return [];

  return pairs
    .map((pair) => {
      if (!pair || typeof pair !== "object") return null;
      const left = String((pair as { left?: unknown }).left ?? "").trim();
      const right = String((pair as { right?: unknown }).right ?? "").trim();
      return left && right ? { left, right } : null;
    })
    .filter((pair): pair is AssessmentMatchPair => pair !== null);
}

function getOrderedAnswers(contentJson?: Record<string, unknown> | null): string[] {
  const answers = getCanonicalTruth(contentJson)?.orderedAnswers;
  if (!Array.isArray(answers)) return [];

  return answers
    .map((answer) => String(answer ?? "").trim())
    .filter((answer) => answer.length > 0);
}

function normalizePromptForAssessment(promptText: string): string {
  return promptText
    .replace(/\{\{\s*\}\}/g, "____")
    .replace(/\s+/g, " ")
    .trim();
}

function inferCalculatorAllowed(question: {
  promptText: string;
  yearGroup: number;
  difficulty: DifficultyBand;
}): boolean {
  const text = question.promptText.toLowerCase();

  if (
    hasAny(text, [
      "circle",
      "circumference",
      "π",
      "3.14",
      "decimal",
      "round",
      "1 decimal place",
      "2 decimal places",
      "pythagoras",
    ])
  ) {
    return true;
  }

  if (question.yearGroup >= 9 && question.difficulty === DifficultyBand.HARD) {
    return true;
  }

  return false;
}

function inferInputHelp(question: {
  answerMode: AnswerMode;
  promptText: string;
  calculatorAllowed: boolean;
}): string | undefined {
  const text = question.promptText.toLowerCase();

  if (question.answerMode === "fraction") {
    return "Type fractions like 3/4.";
  }

  if (question.answerMode === "algebra") {
    if (text.includes("solve")) return "Enter just the value of the variable unless told otherwise.";
    return "Type your expression using normal algebra notation.";
  }

  if (question.answerMode === "text") {
    return undefined;
  }

  if (hasAny(text, ["1 decimal place"])) {
    return "Give your answer to 1 decimal place.";
  }

  if (hasAny(text, ["2 decimal places"])) {
    return "Give your answer to 2 decimal places.";
  }

  if (question.answerMode === "multi_part") {
    return "Enter all parts clearly, separated by commas.";
  }

  if (question.calculatorAllowed) {
    return "Use a calculator if needed.";
  }

  return undefined;
}

function parseNumericAnswer(answerText: string): {
  value: number | null;
  suffix: string;
} {
  const trimmed = answerText.trim();
  const match = trimmed.match(/^\s*(-?\d+(?:\.\d+)?)(.*)$/);
  if (!match) {
    return { value: null, suffix: "" };
  }

  const value = Number(match[1]);
  return {
    value: Number.isFinite(value) ? value : null,
    suffix: match[2]?.trim() ?? "",
  };
}

function formatNumericChoice(value: number, suffix = ""): string {
  const base = Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
  return suffix ? `${base}${suffix.startsWith(":") ? suffix : ` ${suffix}`}`.trim() : base;
}

function parseTimeAnswer(answerText: string): { hour: number; minute: number } | null {
  const match = answerText.trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  return { hour, minute };
}

function formatTimeAnswer(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function parseClockTextAnswer(answerText: string): {
  hour: number;
  minute: number;
  suffix: "am" | "pm" | "o'clock" | "";
} | null {
  const normalized = answerText.trim().toLowerCase();
  const match = normalized.match(/^(\d{1,2})(?::(\d{2}))?\s*(am|pm|o'clock)?$/);
  if (!match) return null;

  const hour = Number(match[1]);
  const minute = match[2] != null ? Number(match[2]) : 0;
  const suffix = (match[3] as "am" | "pm" | "o'clock" | undefined) ?? "";

  if (!Number.isFinite(hour) || !Number.isFinite(minute)) return null;
  if (hour < 0 || hour > 12 || minute < 0 || minute > 59) return null;

  return { hour, minute, suffix };
}

function formatClockTextAnswer(input: {
  hour: number;
  minute: number;
  suffix: "am" | "pm" | "o'clock" | "";
}): string {
  if (input.suffix === "o'clock") {
    return `${input.hour} o'clock`;
  }

  if (input.suffix === "am" || input.suffix === "pm") {
    return `${input.hour}:${String(input.minute).padStart(2, "0")} ${input.suffix}`;
  }

  return `${input.hour}:${String(input.minute).padStart(2, "0")}`;
}

function wrapClockHour(hour: number): number {
  const normalized = ((hour - 1 + 12) % 12) + 1;
  return normalized === 0 ? 12 : normalized;
}

function buildClockTextDistractors(answerText: string): string[] {
  const parsed = parseClockTextAnswer(answerText);
  if (!parsed) return [];

  const candidates = [
    formatClockTextAnswer({
      hour: parsed.hour,
      minute: (parsed.minute + 30) % 60,
      suffix: parsed.suffix,
    }),
    formatClockTextAnswer({
      hour: wrapClockHour(parsed.minute + 30 >= 60 ? parsed.hour + 1 : parsed.hour),
      minute: (parsed.minute + 30) % 60,
      suffix: parsed.suffix,
    }),
    formatClockTextAnswer({
      hour: wrapClockHour(parsed.hour + 1),
      minute: parsed.minute,
      suffix: parsed.suffix,
    }),
    formatClockTextAnswer({
      hour: wrapClockHour(parsed.hour - 1),
      minute: parsed.minute,
      suffix: parsed.suffix,
    }),
    formatClockTextAnswer({
      hour: parsed.hour,
      minute: (parsed.minute + 10) % 60,
      suffix: parsed.suffix,
    }),
    formatClockTextAnswer({
      hour: parsed.hour,
      minute: Math.max(0, parsed.minute - 10),
      suffix: parsed.suffix,
    }),
    parsed.suffix === "am"
      ? formatClockTextAnswer({ hour: parsed.hour, minute: parsed.minute, suffix: "pm" })
      : parsed.suffix === "pm"
      ? formatClockTextAnswer({ hour: parsed.hour, minute: parsed.minute, suffix: "am" })
      : "",
  ];

  return dedupe(
    candidates.filter((candidate) => candidate && candidate.toLowerCase() !== answerText.trim().toLowerCase())
  ).slice(0, 3);
}

function buildTimeDistractors(answerText: string): string[] {
  const parsed = parseTimeAnswer(answerText);
  if (!parsed) return [];

  const candidates = [
    formatTimeAnswer((parsed.hour + 12) % 24, parsed.minute),
    formatTimeAnswer(parsed.hour, (parsed.minute + 30) % 60),
    formatTimeAnswer((parsed.hour + 1) % 24, parsed.minute),
    formatTimeAnswer(parsed.hour, (parsed.minute + 5) % 60),
  ];

  return dedupe(candidates.filter((candidate) => candidate !== answerText)).slice(0, 3);
}

function buildFractionDistractors(answerText: string): string[] {
  const parsed = parseFraction(answerText);
  if (!parsed) return [];

  const candidates = [
    `${parsed.num + 1}/${parsed.den}`,
    `${Math.max(1, parsed.num - 1)}/${parsed.den}`,
    `${parsed.num}/${parsed.den + 1}`,
    `${parsed.den}/${parsed.num || 1}`,
  ];

  return dedupe(
    candidates.filter(
      (candidate) =>
        candidate !== answerText &&
        candidate !== `${parsed.num}/${parsed.den}`
    )
  ).slice(0, 3);
}

function buildNumericDistractors(question: {
  promptText: string;
  answerText: string;
}): string[] {
  if (question.answerText.includes(":")) {
    return buildTimeDistractors(question.answerText);
  }

  const parsed = parseNumericAnswer(question.answerText);
  if (parsed.value == null) return [];

  const step =
    Math.abs(parsed.value) >= 100
      ? 10
      : Math.abs(parsed.value) >= 20
      ? 5
      : 1;

  const candidates = [
    parsed.value + step,
    parsed.value - step,
    parsed.value + step * 2,
    parsed.value - step * 2,
    parsed.value + 10,
    parsed.value - 10,
  ]
    .filter((value) => Number.isFinite(value))
    .map((value) => formatNumericChoice(value, parsed.suffix));

  return dedupe(candidates.filter((candidate) => candidate !== question.answerText)).slice(0, 3);
}

function buildYesNoDistractors(answerText: string): string[] {
  const normalized = answerText.trim().toLowerCase();
  if (normalized !== "yes" && normalized !== "no") return [];
  return normalized === "yes" ? ["no", "both", "neither"] : ["yes", "both", "neither"];
}

function buildSymbolDistractors(question: {
  promptText: string;
  answerText: string;
  itemType?: string | null;
}): string[] {
  const prompt = question.promptText.toLowerCase();
  const answer = question.answerText.trim();
  const itemType = String(question.itemType ?? "").toUpperCase();

  const comparisonPool = ["<", ">", "=", "!="];
  if (
    itemType === "COMPARISON" ||
    comparisonPool.includes(answer) ||
    prompt.includes("put <") ||
    prompt.includes("put >") ||
    prompt.includes("put =") ||
    prompt.includes("between") && (prompt.includes("<") || prompt.includes(">") || prompt.includes("=")) ||
    prompt.includes("less than") ||
    prompt.includes("greater than")
  ) {
    return comparisonPool.filter((item) => item !== answer).slice(0, 3);
  }

  const operatorPool = ["+", "-", "x", "÷"];
  if (
    itemType === "EQUATION" ||
    operatorPool.includes(answer) ||
    prompt.includes("which operation") ||
    prompt.includes("what operation") ||
    prompt.includes("which symbol")
  ) {
    return operatorPool.filter((item) => item !== answer).slice(0, 3);
  }

  return [];
}

function buildTextDistractors(question: {
  promptText: string;
  answerText: string;
  itemType?: string | null;
  contentJson?: Record<string, unknown> | null;
}): string[] {
  const prompt = question.promptText.toLowerCase();
  const answer = question.answerText.trim();
  const answerLower = answer.toLowerCase();
  const itemType = String(question.itemType ?? "").toUpperCase();
  const contentDomain =
    typeof question.contentJson?.domain === "string"
      ? question.contentJson.domain.toLowerCase()
      : "";

  const yesNo = buildYesNoDistractors(answer);
  if (yesNo.length > 0) return yesNo;

  const symbolDistractors = buildSymbolDistractors(question);
  if (symbolDistractors.length > 0) return symbolDistractors;

  if (
    itemType === "TURN_DIRECTION" ||
    prompt.includes("turn") ||
    answerLower.includes("clockwise") ||
    answerLower.includes("anticlockwise") ||
    answerLower === "left" ||
    answerLower === "right" ||
    answerLower.includes("full turn") ||
    answerLower.includes("half turn") ||
    answerLower.includes("quarter turn") ||
    answerLower.includes("three-quarter turn")
  ) {
    const pool = [
      "left",
      "right",
      "clockwise",
      "anticlockwise",
      "half turn",
      "quarter turn",
      "three-quarter turn",
      "full turn",
    ];
    return pool.filter((item) => item !== answerLower).slice(0, 3);
  }

  if (
    prompt.includes("line") ||
    answerLower === "parallel" ||
    answerLower === "perpendicular" ||
    answerLower === "horizontal" ||
    answerLower === "vertical"
  ) {
    const pool = [
      "parallel",
      "perpendicular",
      "horizontal",
      "vertical",
      "diagonal",
    ];
    return pool.filter((item) => item !== answerLower).slice(0, 3);
  }

  if (
    itemType === "SHAPE_NAME" ||
    prompt.includes("shape") ||
    prompt.includes("sides") ||
    prompt.includes("symmetry") ||
    contentDomain.includes("shape")
  ) {
    const pool = [
      "triangle",
      "square",
      "rectangle",
      "circle",
      "pentagon",
      "hexagon",
      "octagon",
      "cube",
      "cone",
    ];
    return pool.filter((item) => item !== answerLower).slice(0, 3);
  }

  if (
    itemType === "TIME_MATCH" ||
    prompt.includes("clock") ||
    prompt.includes("in words") ||
    answerLower.includes("past") ||
    contentDomain.includes("time")
  ) {
    const exactClockDistractors = buildClockTextDistractors(question.answerText);
    if (exactClockDistractors.length > 0) {
      return exactClockDistractors;
    }

    const pool = answerLower.includes("o'clock")
      ? [
          "1 o'clock",
          "2 o'clock",
          "3 o'clock",
          "4 o'clock",
          "5 o'clock",
          "6 o'clock",
          "7 o'clock",
          "8 o'clock",
          "9 o'clock",
          "10 o'clock",
          "11 o'clock",
          "12 o'clock",
        ]
      : [
          "quarter past 3",
          "half past 6",
          "quarter to 9",
          "12:00",
          "2:00",
        ];
    return pool.filter((item) => item.toLowerCase() !== answerLower).slice(0, 3);
  }

  if (
    prompt.includes("called") ||
    prompt.includes("what do we call") ||
    prompt.includes("what is this called")
  ) {
    const pool = ["parallel", "perpendicular", "horizontal", "vertical"];
    return pool.filter((item) => item !== answerLower).slice(0, 3);
  }

  if (
    prompt.includes("day") ||
    prompt.includes("month") ||
    prompt.includes("yesterday") ||
    prompt.includes("tomorrow")
  ) {
    const pool = [
      "monday",
      "tuesday",
      "wednesday",
      "thursday",
      "friday",
      "saturday",
      "sunday",
      "january",
      "february",
      "march",
      "april",
    ];
    return pool.filter((item) => item !== answerLower).slice(0, 3);
  }

  const genericMathPool = [
    "triangle",
    "square",
    "rectangle",
    "circle",
    "parallel",
    "perpendicular",
    "left",
    "right",
  ];
  return genericMathPool.filter((item) => item !== answerLower).slice(0, 3);
}

function buildAlgebraDistractors(answerText: string): string[] {
  const normalized = normalizeAlgebra(answerText);
  const candidates = [
    normalized.replace(/\+/g, "-"),
    normalized.replace(/-/g, "+"),
    normalized.replace(/^(-?\d+)/, (match) => String(Number(match) + 1)),
    normalized.replace(/^(-?\d+)/, (match) => String(Number(match) - 1)),
  ];

  return dedupe(candidates.filter((candidate) => candidate && candidate !== normalized)).slice(0, 3);
}

function buildPromptNumberDistractors(question: {
  promptText: string;
  answerText: string;
}): string[] {
  const parsedAnswer = parseNumericAnswer(question.answerText);
  const promptNumbers = extractAllNumbers(question.promptText);
  const candidates = new Set<string>();

  for (const number of promptNumbers) {
    candidates.add(formatNumericChoice(number));
    candidates.add(formatNumericChoice(number + 1));
    candidates.add(formatNumericChoice(number - 1));
    candidates.add(formatNumericChoice(number * 2));
  }

  if (parsedAnswer.value != null) {
    candidates.add(formatNumericChoice(parsedAnswer.value + 2, parsedAnswer.suffix));
    candidates.add(formatNumericChoice(parsedAnswer.value - 2, parsedAnswer.suffix));
    candidates.add(formatNumericChoice(parsedAnswer.value * 2, parsedAnswer.suffix));
  }

  return [...candidates].filter((candidate) => candidate !== question.answerText);
}

function supplementDistractors(
  question: {
    promptText: string;
    answerText: string;
    answerMode: AnswerMode;
    itemType?: string | null;
    contentJson?: Record<string, unknown> | null;
  },
  distractors: string[]
): string[] {
  const supplemented = [...distractors];
  const parsedAnswer = parseNumericAnswer(question.answerText);

  const addCandidates = (values: string[]) => {
    for (const value of values) {
      if (
        supplemented.length < 3 &&
        value &&
        value !== question.answerText &&
        !supplemented.includes(value)
      ) {
        supplemented.push(value);
      }
    }
  };

  if (supplemented.length < 3 && parsedAnswer.value != null) {
    addCandidates([
      formatNumericChoice(parsedAnswer.value + 3, parsedAnswer.suffix),
      formatNumericChoice(parsedAnswer.value - 3, parsedAnswer.suffix),
      formatNumericChoice(parsedAnswer.value + 4, parsedAnswer.suffix),
      formatNumericChoice(Math.max(0, parsedAnswer.value - 4), parsedAnswer.suffix),
    ]);
  }

  if (supplemented.length < 3 && question.answerMode !== "text") {
    addCandidates(buildPromptNumberDistractors(question));
  }

  if (supplemented.length < 3 && question.answerMode === "algebra") {
    addCandidates(["0", "1", "2", "x", "x + 1", "2x"]);
  }

  if (supplemented.length < 3 && question.answerMode === "text") {
    addCandidates(
      buildTextDistractors({
        promptText: question.promptText,
        answerText: question.answerText,
        itemType: question.itemType,
        contentJson: question.contentJson,
      })
    );
  }

  return supplemented.slice(0, 3);
}

function buildMultipleChoiceChoices(question: {
  promptText: string;
  answerText: string;
  answerMode: AnswerMode;
  itemType?: string | null;
  contentJson?: Record<string, unknown> | null;
}): { choices: AssessmentChoice[]; correctChoiceKey: AssessmentChoiceKey } {
  const authoredChoices = getAuthoredMultipleChoiceChoices(question);
  if (authoredChoices) return authoredChoices;

  let distractors: string[] = [];

  switch (question.answerMode) {
    case "fraction":
      distractors = buildFractionDistractors(question.answerText);
      break;
    case "algebra":
      distractors =
        parseNumericAnswer(question.answerText).value != null
          ? buildNumericDistractors(question)
          : buildAlgebraDistractors(question.answerText);
      break;
    case "text":
      distractors = buildTextDistractors(question);
      break;
    case "numeric":
    case "multi_part":
    default:
      distractors = buildNumericDistractors(question);
      break;
  }

  distractors = supplementDistractors(question, distractors);

  const allOptions = [question.answerText, ...distractors.slice(0, 3)];
  const seed = hashText(`${question.promptText}|${question.answerText}`);
  const correctIndex = seed % 4;
  const ordered = Array.from({ length: 4 }, (_, index) => {
    const sourceIndex = index === correctIndex ? 0 : 1 + (index > correctIndex ? index - 1 : index);
    return allOptions[sourceIndex] ?? question.answerText;
  });

  return {
    choices: ordered.map((label, index) => ({
      key: choiceKey(index),
      label,
    })),
    correctChoiceKey: choiceKey(correctIndex),
  };
}

function getAuthoredMultipleChoiceChoices(question: {
  promptText: string;
  answerText: string;
  contentJson?: Record<string, unknown> | null;
}): { choices: AssessmentChoice[]; correctChoiceKey: AssessmentChoiceKey } | null {
  const oak = question.contentJson?.oak;
  if (!oak || typeof oak !== "object") return null;

  const choicesRaw = (oak as { choices?: unknown }).choices;
  if (!Array.isArray(choicesRaw)) return null;

  const choices = choicesRaw
    .map((choice) => {
      if (!choice || typeof choice !== "object") return null;
      const label = String((choice as { label?: unknown }).label ?? "").trim();
      const isCorrect = (choice as { isCorrect?: unknown }).isCorrect === true;
      return label ? { label, isCorrect } : null;
    })
    .filter((choice): choice is { label: string; isCorrect: boolean } => choice !== null);

  const correct = choices.filter((choice) => choice.isCorrect);
  if (choices.length < 2 || correct.length !== 1) return null;

  const uniqueChoices = dedupe(choices.map((choice) => choice.label));
  if (
    uniqueChoices.length < 2 ||
    !uniqueChoices.some((label) => normalizeText(label) === normalizeText(correct[0]!.label))
  ) {
    return null;
  }

  const seed = hashText(`${question.promptText}|${question.answerText}|oak`);
  const rotated = rotateToSeed(uniqueChoices, seed);
  const padded = rotated.length >= 2 ? rotated : padAuthoredChoices(rotated, correct[0]!.label);
  const correctIndex = padded.findIndex(
    (label) => normalizeText(label) === normalizeText(correct[0]!.label)
  );

  return {
    choices: padded.map((label, index) => ({ key: choiceKey(index), label })),
    correctChoiceKey: choiceKey(Math.max(0, correctIndex)),
  };
}

function rotateToSeed<T>(items: T[], seed: number): T[] {
  if (!items.length) return items;
  const offset = seed % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}

function padAuthoredChoices(choices: string[], correctAnswer: string): string[] {
  const out = [...choices];
  const fallback = ["I am not sure", "None of these", "All of these", correctAnswer];
  for (const item of fallback) {
    if (out.length >= 4) break;
    if (!out.some((choice) => normalizeText(choice) === normalizeText(item))) {
      out.push(item);
    }
  }
  return out.slice(0, 4);
}

export function ensureMultipleChoiceQuestion(question: RuntimeQuestion): RuntimeQuestion {
  if (
    typeof (question as any).responseKind === "string" &&
    Array.isArray((question as any).choices) &&
    typeof (question as any).correctChoiceKey === "string"
  ) {
    return question;
  }

  const multipleChoice = buildMultipleChoiceChoices({
    promptText: question.promptText,
    answerText: question.answerText,
    answerMode: question.answerMode,
    itemType:
      typeof question.contentJson?.itemType === "string"
        ? String(question.contentJson.itemType)
        : null,
    contentJson: question.contentJson,
  });

  return {
    ...question,
    choices: multipleChoice.choices,
    correctChoiceKey: multipleChoice.correctChoiceKey,
  };
}

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
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

  return Object.keys(value)
    .filter((key) => !ignoredKeys.has(key))
    .sort()
    .map((key) => `${key}:${String(value[key])}`)
    .join("|");
}

function questionSignature(question: RuntimeQuestion): string {
  const contentJson =
    question.contentJson && typeof question.contentJson === "object"
      ? question.contentJson
      : null;

  const operator =
    contentJson && typeof contentJson.operator === "string"
      ? contentJson.operator
      : typeof contentJson?.canonicalOperator === "string"
      ? String(contentJson.canonicalOperator)
      : "";

  const lhsA =
    contentJson && typeof contentJson.lhsA === "number"
      ? contentJson.lhsA
      : typeof contentJson?.a === "number"
      ? Number(contentJson.a)
      : "";

  const lhsB =
    contentJson && typeof contentJson.lhsB === "number"
      ? contentJson.lhsB
      : typeof contentJson?.b === "number"
      ? Number(contentJson.b)
      : "";

  const rhs =
    contentJson && typeof contentJson.rhs === "number"
      ? contentJson.rhs
      : typeof contentJson?.result === "number"
      ? Number(contentJson.result)
      : "";

  return [
    `mode:${question.answerMode}`,
    `prompt:${normalizeText(question.promptText)}`,
    `answer:${normalizeText(question.answerText)}`,
    `json:${normalizeJsonForSignature(contentJson)}`,
    `shape:${String(operator)}:${String(lhsA)}:${String(lhsB)}:${String(rhs)}`,
  ].join("|");
}

function getAskedSignatures(session: AssessmentSession): Set<string> {
  const questionMap = new Map(session.questions.map((q) => [q.id, q]));
  const signatures = new Set<string>();

  for (const questionId of session.askedQuestionIds) {
    const question = questionMap.get(questionId);
    if (question) signatures.add(questionSignature(question));
  }

  return signatures;
}

function objectiveAskedCount(session: AssessmentSession, objectiveId: string): number {
  const questionMap = new Map(session.questions.map((q) => [q.id, q]));
  let count = 0;

  for (const response of session.responses) {
    const q = questionMap.get(response.questionId);
    if (q?.objectiveId === objectiveId) count += 1;
  }

  return count;
}

function signatureAskedCount(session: AssessmentSession, signature: string): number {
  const questionMap = new Map(session.questions.map((q) => [q.id, q]));
  let count = 0;

  for (const response of session.responses) {
    const q = questionMap.get(response.questionId);
    if (q && questionSignature(q) === signature) count += 1;
  }

  return count;
}

function sameObjectiveRecentPenalty(
  session: AssessmentSession,
  objectiveId: string,
  lookback = 5
): number {
  const questionMap = new Map(session.questions.map((q) => [q.id, q]));
  const recentResponses = session.responses.slice(-lookback);

  let penalty = 0;
  for (const response of recentResponses) {
    const q = questionMap.get(response.questionId);
    if (q?.objectiveId === objectiveId) {
      penalty += 1.2;
    }
  }

  return penalty;
}

function sameStrandRecentPenalty(
  session: AssessmentSession,
  strand: AssessmentStrand,
  lookback = 4
): number {
  const recentResponses = session.responses.slice(-lookback);
  let penalty = 0;

  for (const response of recentResponses) {
    if (response.strand === strand) {
      penalty += 1.35;
    }
  }

  return penalty;
}

function topicKey(question: RuntimeQuestion): string {
  const contentJson =
    question.contentJson && typeof question.contentJson === "object"
      ? question.contentJson
      : null;

  if (typeof contentJson?.domain === "string" && contentJson.domain.trim()) {
    return contentJson.domain.trim().toLowerCase();
  }

  return `${question.strand}:${question.objectiveId}`.toLowerCase();
}

function sameTopicRecentPenalty(
  session: AssessmentSession,
  key: string,
  lookback = 6
): number {
  const questionMap = new Map(session.questions.map((q) => [q.id, q]));
  const recentResponses = session.responses.slice(-lookback);
  let penalty = 0;

  for (const response of recentResponses) {
    const question = questionMap.get(response.questionId);
    if (question && topicKey(question) === key) {
      penalty += 1.6;
    }
  }

  return penalty;
}

function sameSignatureRecentPenalty(
  session: AssessmentSession,
  signature: string,
  lookback = 6
): number {
  const questionMap = new Map(session.questions.map((q) => [q.id, q]));
  const recentResponses = session.responses.slice(-lookback);

  let penalty = 0;
  for (const response of recentResponses) {
    const q = questionMap.get(response.questionId);
    if (q && questionSignature(q) === signature) {
      penalty += 2.5;
    }
  }

  return penalty;
}

function pickRandom<T>(items: T[]): T | null {
  if (items.length === 0) return null;
  const index = Math.floor(Math.random() * items.length);
  return items[index] ?? null;
}

function chooseRandomFromTopScored<T>(
  items: T[],
  scoreFn: (item: T) => number,
  topWindow = 4
): T | null {
  if (items.length === 0) return null;

  const scored = shuffle(items)
    .map((item) => ({ item, score: scoreFn(item) }))
    .sort((a, b) => b.score - a.score);

  const bestScore = scored[0]?.score ?? 0;
  const top = scored.filter((entry) => entry.score >= bestScore - topWindow);

  return pickRandom(top.map((entry) => entry.item));
}

function objectiveCoverageScore(
  session: AssessmentSession,
  question: RuntimeQuestion
): number {
  const objectiveCount = objectiveAskedCount(session, question.objectiveId);
  const signatureCount = signatureAskedCount(session, questionSignature(question));
  const sameObjectivePenalty = sameObjectiveRecentPenalty(session, question.objectiveId);
  const sameSignaturePenalty = sameSignatureRecentPenalty(session, questionSignature(question));
  const sameTopicPenalty = sameTopicRecentPenalty(session, topicKey(question));

  let score = 100;

  score -= objectiveCount * 24;
  score -= signatureCount * 34;
  score -= sameObjectivePenalty * 14;
  score -= sameSignaturePenalty * 14;
  score -= sameTopicPenalty * 12;

  return score;
}

function chooseQuestionFromBucket(
  session: AssessmentSession,
  candidates: RuntimeQuestion[]
): RuntimeQuestion | null {
  if (candidates.length === 0) return null;

  const byObjective = new Map<string, RuntimeQuestion[]>();

  for (const question of candidates) {
    const bucket = byObjective.get(question.objectiveId) ?? [];
    bucket.push(question);
    byObjective.set(question.objectiveId, bucket);
  }

  const objectives = Array.from(byObjective.entries()).map(([objectiveId, questions]) => {
    const askedCount = objectiveAskedCount(session, objectiveId);
    const recentPenalty = sameObjectiveRecentPenalty(session, objectiveId);

    return {
      objectiveId,
      questions,
      score: 100 - askedCount * 20 - recentPenalty * 10,
    };
  });

  const chosenObjective = chooseRandomFromTopScored(objectives, (entry) => entry.score, 8);
  if (!chosenObjective) return null;

  return chooseRandomFromTopScored(
    chosenObjective.questions,
    (question) => objectiveCoverageScore(session, question),
    8
  );
}

function difficultyDistance(a: DifficultyBand, b: DifficultyBand): number {
  const rank = (value: DifficultyBand): number => {
    switch (value) {
      case DifficultyBand.EASY:
        return 1;
      case DifficultyBand.MEDIUM:
        return 2;
      case DifficultyBand.HARD:
        return 3;
      default:
        return 99;
    }
  };

  return Math.abs(rank(a) - rank(b));
}

function yearDistance(a: number, b: number): number {
  return Math.abs(a - b);
}

export function buildRuntimeQuestion(row: AssessmentPoolRow): RuntimeQuestion {
  const yearGroup = safeYear(row.yearGroup);
  const promptText = normalizePromptForAssessment(row.promptText);
  const answerText = getAssessmentAnswerText(row.answerText, row.contentJson);
  const responseKind = getResponseKind({
    itemType: row.itemType,
    contentJson: row.contentJson,
  });
  const answerContract = getAnswerContract(row.contentJson) ?? undefined;
  const immutableAnswers = getImmutableAnswers(row.contentJson);
  const strand = cleanAssessmentStrand(row.strand)
    ? normaliseAssessmentStrand(row.strand!)
    : inferStrand({
        subject: row.subject,
        title: row.title,
        code: row.code,
        statement: row.statement,
        strand: row.strand,
        contentJson: row.contentJson,
      });
  const answerMode = inferAnswerMode(promptText, answerText, row.itemType);
  const calculatorAllowed = inferCalculatorAllowed({
    promptText,
    yearGroup,
    difficulty: row.difficulty,
  });
  const optionBank = getOptionBank(row.contentJson);
  const matchPairs = getMatchPairs(row.contentJson);
  const orderedAnswers = getOrderedAnswers(row.contentJson);
  const multipleChoice =
    responseKind === "single_choice"
      ? buildMultipleChoiceChoices({
          promptText,
          answerText,
          answerMode,
          itemType: row.itemType,
          contentJson: row.contentJson,
        })
      : {
          choices: choicesFromLabels(
            responseKind === "order" ? optionBank : responseKind === "multi_select" ? optionBank : []
          ),
          correctChoiceKey: "",
        };
  const correctChoiceKeys = getCorrectChoiceKeys(
    multipleChoice.choices,
    immutableAnswers.length > 0 ? immutableAnswers : [answerText]
  );

  return {
    id: row.id,
    objectiveId: row.objectiveId,
    code: row.code,
    title: row.title,
    statement: row.statement,
    yearGroup,
    strand,
    promptText,
    answerText,
    difficulty: row.difficulty,
    answerMode,
    answerContract,
    responseKind,
    calculatorAllowed,
    inputHelp: inferInputHelp({
      answerMode,
      promptText,
      calculatorAllowed,
    }),
    choices: multipleChoice.choices,
    correctChoiceKey: multipleChoice.correctChoiceKey || correctChoiceKeys[0] || "",
    correctChoiceKeys,
    matchPairs,
    orderedAnswers,
    contentJson: row.contentJson,
  };
}

export function buildRuntimeQuestionPool(rows: AssessmentPoolRow[]): RuntimeQuestion[] {
  return stableSort(rows.map(buildRuntimeQuestion), (q) => {
    return [
      q.yearGroup,
      q.strand,
      q.difficulty,
      q.code,
      q.promptText,
      q.id,
    ].join("|");
  });
}

function makeEmptyStrandStats(
  entryYear: number,
  activeStrands: AssessmentStrand[] = MATHS_CORE_STRANDS
): Record<AssessmentStrand, StrandStats> {
  return Object.fromEntries(
    activeStrands.map((strand) => [strand, emptySingleStrand(strand, entryYear)])
  ) as Record<AssessmentStrand, StrandStats>;
}

function emptySingleStrand(strand: AssessmentStrand, entryYear: number): StrandStats {
  return {
    strand,
    asked: 0,
    correct: 0,
    byYear: {},
    byDifficulty: {
      EASY: { asked: 0, correct: 0 },
      MEDIUM: { asked: 0, correct: 0 },
      HARD: { asked: 0, correct: 0 },
    },
    currentTargetYear: entryYear,
    secureYear: null,
    emergingYear: null,
    confidence: 0,
  };
}

function buildInitialQueue(
  questions: RuntimeQuestion[],
  entryYear: number,
  activeStrands: AssessmentStrand[]
): string[] {
  const queue: string[] = [];
  const usedObjectiveIds = new Set<string>();
  const usedSignatures = new Set<string>();
  const strandOrder = shuffle(activeStrands);

  const pickForStrand = (
    strand: AssessmentStrand,
    difficulty: DifficultyBand
  ): RuntimeQuestion | null =>
    chooseRandomFromTopScored(
      questions.filter(
        (q) =>
          q.yearGroup === entryYear &&
          q.strand === strand &&
          q.difficulty === difficulty &&
          !usedObjectiveIds.has(q.objectiveId) &&
          !usedSignatures.has(questionSignature(q))
      ),
      () => 100,
      0
    ) ??
    pickRandom(
      questions.filter(
        (q) =>
          q.yearGroup === entryYear &&
          q.strand === strand &&
          q.difficulty === difficulty &&
          !usedSignatures.has(questionSignature(q))
      )
    );

  for (const strand of strandOrder) {
    const easy = pickForStrand(strand, DifficultyBand.EASY);
    if (!easy) continue;
    queue.push(easy.id);
    usedObjectiveIds.add(easy.objectiveId);
    usedSignatures.add(questionSignature(easy));
  }

  for (const strand of strandOrder) {
    if (queue.length >= 6) break;
    const medium = pickForStrand(strand, DifficultyBand.MEDIUM);
    if (!medium) continue;
    queue.push(medium.id);
    usedObjectiveIds.add(medium.objectiveId);
    usedSignatures.add(questionSignature(medium));
  }

  return dedupe(queue).slice(0, 6);
}

function dedupe<T>(items: T[]): T[] {
  return [...new Set(items)];
}

export function createAssessmentSession(params: {
  subject?: Subject;
  childCurrentYear: number;
  questions: RuntimeQuestion[];
  maxQuestions?: number;
  extensionMaxQuestions?: number;
}): AssessmentSession {
  const entryYear = determineEntryYear(params.questions, params.childCurrentYear);

  const activeStrands = getActiveStrandsFromQuestions(params.questions);
  const { minimumYear, maximumYear } = getYearBounds(params.questions, entryYear);

  const session: AssessmentSession = {
    sessionId: makeId(),
    subject: params.subject ?? Subject.MATHS,
    childCurrentYear: params.childCurrentYear,
    entryYear,
    minimumYear,
    maximumYear,
    activeStrands,
    maxQuestions: params.maxQuestions ?? 25,
    extensionMaxQuestions: params.extensionMaxQuestions ?? 30,
    startedAt: new Date().toISOString(),
    questions: params.questions,
    askedQuestionIds: [],
    responses: [],
    skippedQuestions: [],
    currentBandYear: entryYear,
    minimumBandYear: Math.max(1, entryYear - 1),
    maximumBandYear: Math.min(params.childCurrentYear, maximumYear),
    bandStartedAtResponseCount: 0,
    strands: makeEmptyStrandStats(entryYear, activeStrands),
    initialQueue: buildInitialQueue(params.questions, entryYear, activeStrands),
    isComplete: false,
    overallConfidence: 0,
    overallWorkingBand: "INSUFFICIENT_EVIDENCE",
  };

  recalculateAssessmentSession(session);
  return session;
}

export function getNextQuestion(
  session: AssessmentSession
): RuntimeQuestion | null {
  if (session.isComplete) return null;

  const asked = new Set(session.askedQuestionIds);
  const askedSignatures = getAskedSignatures(session);

  for (const qid of session.initialQueue) {
    if (asked.has(qid)) continue;

    const queued = session.questions.find((q) => q.id === qid) ?? null;
    if (queued && !askedSignatures.has(questionSignature(queued))) {
      return queued;
    }
  }

  const remainingById = session.questions.filter((q) => !asked.has(q.id));
  const remaining =
    remainingById.filter((q) => !askedSignatures.has(questionSignature(q)));

  const candidatePool = remaining.length > 0 ? remaining : remainingById;
  const windowedCandidatePool = candidatePool.filter(
    (q) =>
      q.yearGroup >= session.minimumBandYear &&
      q.yearGroup <= session.maximumBandYear
  );

  if (windowedCandidatePool.length === 0) {
    session.isComplete = true;
    session.completionReason = "NO_MORE_QUESTIONS";
    session.completedAt = new Date().toISOString();
    return null;
  }

  const targetStrand = chooseTargetStrand(session);
  const targetYear = session.currentBandYear;
  const targetDifficulty = chooseTargetDifficulty(
    session.strands[targetStrand],
    targetYear
  );
  const targetYearStats = session.strands[targetStrand].byYear[targetYear] ?? {
    asked: 0,
    correct: 0,
  };
  const targetYearAccuracy =
    targetYearStats.asked > 0 ? targetYearStats.correct / targetYearStats.asked : 0;
  const weakAtCurrentBand =
    targetYearStats.asked >= 2 && targetYearAccuracy < 0.5;
  const strongAtCurrentBand =
    targetYearStats.asked >= 3 && targetYearAccuracy >= 0.75;
  const preferredAdjacentYear = weakAtCurrentBand
    ? getAdjacentAvailableYear(session, "down")
    : strongAtCurrentBand
    ? getAdjacentAvailableYear(session, "up")
    : null;

  const strictBucket = windowedCandidatePool.filter(
    (q) =>
      q.strand === targetStrand &&
      q.yearGroup === targetYear &&
      q.difficulty === targetDifficulty
  );

  const relaxedDifficultyBucket = windowedCandidatePool.filter(
    (q) =>
      q.strand === targetStrand &&
      q.yearGroup === targetYear &&
      difficultyDistance(q.difficulty, targetDifficulty) <= 1
  );

  const targetYearBucket = windowedCandidatePool.filter(
    (q) => q.strand === targetStrand && q.yearGroup === targetYear
  );

  const preferredAdjacentBucket =
    preferredAdjacentYear == null
      ? []
      : windowedCandidatePool.filter(
          (q) => q.strand === targetStrand && q.yearGroup === preferredAdjacentYear
        );

  const relaxedYearBucket = windowedCandidatePool.filter(
    (q) =>
      q.strand === targetStrand &&
      yearDistance(q.yearGroup, targetYear) <= 1
  );

  const strandBucket = windowedCandidatePool.filter((q) => q.strand === targetStrand);

  return (
    chooseQuestionFromBucket(session, strictBucket) ??
    chooseQuestionFromBucket(session, relaxedDifficultyBucket) ??
    chooseQuestionFromBucket(session, targetYearBucket) ??
    chooseQuestionFromBucket(session, preferredAdjacentBucket) ??
    chooseQuestionFromBucket(session, relaxedYearBucket) ??
    chooseQuestionFromBucket(session, strandBucket) ??
    chooseQuestionFromBucket(
      session,
      windowedCandidatePool.filter((q) => q.yearGroup === targetYear)
    ) ??
    chooseQuestionFromBucket(session, windowedCandidatePool)
  );
}

function chooseTargetStrand(session: AssessmentSession): AssessmentStrand {
  const bandYear = session.currentBandYear;
  const ranked = getEffectiveStrands(session)
    .map((strand) => {
      const stats = session.strands[strand];
      const targetYearStats = stats.byYear[bandYear] ?? {
        asked: 0,
        correct: 0,
      };
      const targetAccuracy =
        targetYearStats.asked > 0 ? targetYearStats.correct / targetYearStats.asked : 0;
      const baseCoverageNeed = stats.asked < 3 ? 120 - stats.asked * 24 : 0;
      const targetYearCoverageNeed =
        targetYearStats.asked < 2 ? 80 - targetYearStats.asked * 30 : 0;
      const uncertaintyNeed = (1 - stats.confidence) * 40;
      const weakNeed =
        targetYearStats.asked > 0 && targetAccuracy < 0.65
          ? 32 + (0.65 - targetAccuracy) * 30
          : 0;
      const belowEntryNeed = bandYear < session.entryYear ? 24 : 0;
      const recentPenalty = sameStrandRecentPenalty(session, strand) * 18;

      return {
        strand,
        score:
          baseCoverageNeed +
          targetYearCoverageNeed +
          uncertaintyNeed +
          weakNeed +
          belowEntryNeed -
          recentPenalty,
      };
    })
    .sort((a, b) => b.score - a.score);

  const bestScore = ranked[0]?.score ?? 0;
  const top = ranked.filter((entry) => entry.score >= bestScore - 6);

  return pickRandom(top.map((entry) => entry.strand)) ?? ranked[0].strand;
}

function chooseTargetDifficulty(stats: StrandStats, bandYear: number): DifficultyBand {
  const targetYearStats = stats.byYear[bandYear] ?? {
    asked: 0,
    correct: 0,
  };
  const totalAsked = targetYearStats.asked;
  const accuracy = totalAsked === 0 ? 0 : targetYearStats.correct / totalAsked;

  if (totalAsked < 2) return DifficultyBand.EASY;
  if (accuracy >= 0.8) return DifficultyBand.HARD;
  if (accuracy >= 0.55) return DifficultyBand.MEDIUM;
  return DifficultyBand.EASY;
}

function shouldStopForYearOneIntervention(session: AssessmentSession): boolean {
  if (session.currentBandYear !== 1) return false;
  if (session.responses.length < 10) return false;

  const effectiveStrands = getEffectiveStrands(session);
  const allAtFloor = effectiveStrands.every(
    (strand) => session.strands[strand].currentTargetYear <= 1
  );
  const noSecureBase = effectiveStrands.every(
    (strand) => session.strands[strand].secureYear == null
  );

  return allAtFloor && noSecureBase;
}

function getAvailableSessionYears(session: AssessmentSession): number[] {
  return [...new Set(session.questions.map((question) => question.yearGroup))]
    .filter((year) => Number.isFinite(year))
    .sort((a, b) => a - b);
}

function getAdjacentAvailableYear(
  session: AssessmentSession,
  direction: "up" | "down"
): number | null {
  const years = getAvailableSessionYears(session);
  if (direction === "up") {
    return (
      years.find(
        (year) =>
          year > session.currentBandYear && year <= session.maximumBandYear
      ) ?? null
    );
  }

  const lower = years.filter(
    (year) =>
      year < session.currentBandYear && year >= session.minimumBandYear
  );
  return lower.length > 0 ? lower[lower.length - 1] : null;
}

function getBandResponses(session: AssessmentSession): AssessmentResponse[] {
  return session.responses.slice(session.bandStartedAtResponseCount);
}

function getBandAccuracy(session: AssessmentSession): number {
  const bandResponses = getBandResponses(session);
  if (bandResponses.length === 0) return 0;
  const correct = bandResponses.filter((response) => response.isCorrect).length;
  return correct / bandResponses.length;
}

function getConsecutiveWrongBandResponses(session: AssessmentSession): number {
  const bandResponses = getBandResponses(session);
  let count = 0;

  for (let index = bandResponses.length - 1; index >= 0; index -= 1) {
    if (bandResponses[index]?.isCorrect) break;
    count += 1;
  }

  return count;
}

function questionsNeededForCurrentBand(session: AssessmentSession): number {
  return session.currentBandYear === session.entryYear ? 8 : 4;
}

function moveToBandYear(session: AssessmentSession, nextYear: number) {
  session.currentBandYear = clamp(
    nextYear,
    session.minimumBandYear,
    session.maximumBandYear
  );
  session.bandStartedAtResponseCount = session.responses.length;
}

function minimumQuestionsForConfidenceStop(session: AssessmentSession): number {
  return Math.max(12, getEffectiveStrands(session).length * 2 + 2);
}

function applyBandProgression(session: AssessmentSession) {
  const bandResponses = getBandResponses(session);
  const consecutiveWrong = getConsecutiveWrongBandResponses(session);

  if (consecutiveWrong >= 4) {
    const lower = getAdjacentAvailableYear(session, "down");
    if (lower != null) {
      moveToBandYear(session, lower);
    }
    return;
  }

  if (bandResponses.length < questionsNeededForCurrentBand(session)) {
    return;
  }

  const accuracy = getBandAccuracy(session);

  if (accuracy < 0.5) {
    const lower = getAdjacentAvailableYear(session, "down");
    if (lower != null) {
      moveToBandYear(session, lower);
    }
    return;
  }

  if (accuracy >= 0.75) {
    const higher = getAdjacentAvailableYear(session, "up");
    if (higher != null) {
      moveToBandYear(session, higher);
    }
  }
}

export function submitAnswer(
  session: AssessmentSession,
  params: {
    questionId: string;
    rawAnswer?: string;
    selectedChoiceKey?: AssessmentChoiceKey;
    selectedChoiceKeys?: AssessmentChoiceKey[];
    matchPairs?: AssessmentMatchPair[];
    orderedAnswers?: string[];
  }
): {
  isCorrect: boolean;
  correctAnswer: string;
  nextQuestion: RuntimeQuestion | null;
  isComplete: boolean;
  result?: AssessmentResult;
} {
  if (session.isComplete) {
    return {
      isCorrect: false,
      correctAnswer: "",
      nextQuestion: null,
      isComplete: true,
      result: buildAssessmentResult(session),
    };
  }

  const question = session.questions.find((q) => q.id === params.questionId);
  if (!question) {
    throw new Error(`Question not found: ${params.questionId}`);
  }

  if (session.askedQuestionIds.includes(question.id)) {
    throw new Error(`Question already answered: ${question.id}`);
  }

  const selectedChoice =
    params.selectedChoiceKey != null
      ? question.choices.find((choice) => choice.key === params.selectedChoiceKey) ?? null
      : null;
  const selectedChoices =
    params.selectedChoiceKeys
      ?.map((key) => question.choices.find((choice) => choice.key === key) ?? null)
      .filter((choice): choice is AssessmentChoice => choice !== null) ?? [];
  const derivedAnswer =
    selectedChoices.map((choice) => choice.label).join(" | ") ||
    selectedChoice?.label ||
    params.matchPairs?.map((pair) => `${pair.left} -> ${pair.right}`).join("; ") ||
    params.orderedAnswers?.join(" -> ") ||
    "";
  const rawAnswer = params.rawAnswer ?? derivedAnswer;
  const isCorrect = markAnswer(question, rawAnswer, {
    selectedChoiceKey: params.selectedChoiceKey,
    selectedChoiceKeys: params.selectedChoiceKeys,
    matchPairs: params.matchPairs,
    orderedAnswers: params.orderedAnswers,
  });

  session.askedQuestionIds.push(question.id);
  session.responses.push({
    questionId: question.id,
    rawAnswer,
    isCorrect,
    submittedAt: new Date().toISOString(),
    selectedChoiceKey: params.selectedChoiceKey,
    selectedChoiceKeys: params.selectedChoiceKeys,
    matchPairs: params.matchPairs,
    orderedAnswers: params.orderedAnswers,
    yearGroup: question.yearGroup,
    strand: question.strand,
    difficulty: question.difficulty,
  });

  recalculateAssessmentSession(session);
  applyBandProgression(session);

  if (!session.isComplete) {
    const total = session.responses.length;
    if (shouldStopForYearOneIntervention(session)) {
      session.isComplete = true;
      session.completionReason = "INTERVENTION_NEEDED";
      session.completedAt = new Date().toISOString();
    } else if (total >= session.extensionMaxQuestions) {
      session.isComplete = true;
      session.completionReason = "EXTENSION_MAX_REACHED";
      session.completedAt = new Date().toISOString();
    } else if (total >= session.maxQuestions) {
      if (
        total >= minimumQuestionsForConfidenceStop(session) &&
        session.overallConfidence >= 0.8 &&
        allCoreStrandsMeasured(session)
      ) {
        session.isComplete = true;
        session.completionReason = "CONFIDENCE_REACHED";
        session.completedAt = new Date().toISOString();
      } else if (!needsExtension(session)) {
        session.isComplete = true;
        session.completionReason = "MAX_REACHED";
        session.completedAt = new Date().toISOString();
      }
    } else if (
      total >= minimumQuestionsForConfidenceStop(session) &&
      session.overallConfidence >= 0.86 &&
      allCoreStrandsMeasured(session)
    ) {
      session.isComplete = true;
      session.completionReason = "CONFIDENCE_REACHED";
      session.completedAt = new Date().toISOString();
    }
  }

  const nextQuestion = session.isComplete ? null : getNextQuestion(session);

  return {
    isCorrect,
    correctAnswer: question.answerText,
    nextQuestion,
    isComplete: session.isComplete,
    result: session.isComplete ? buildAssessmentResult(session) : undefined,
  };
}

function allCoreStrandsMeasured(session: AssessmentSession): boolean {
  return getEffectiveStrands(session).every(
    (strand) => session.strands[strand].asked >= 2
  );
}

function needsExtension(session: AssessmentSession): boolean {
  const unresolved = getEffectiveStrands(session).filter((strand) => {
    const s = session.strands[strand];
    return s.asked < 3 || s.confidence < 0.7;
  });

  return unresolved.length > 0;
}

export function recalculateAssessmentSession(session: AssessmentSession): void {
  const activeStrands = getActiveStrandsFromQuestions(session.questions);
  session.activeStrands = activeStrands;
  session.strands = makeEmptyStrandStats(session.entryYear, activeStrands);

  const questionMap = new Map(session.questions.map((q) => [q.id, q]));

  for (const response of session.responses) {
    const question = questionMap.get(response.questionId);
    if (!question) continue;

    const s =
      session.strands[question.strand] ??
      (session.strands[question.strand] = emptySingleStrand(question.strand, session.entryYear));
    s.asked += 1;
    if (response.isCorrect) s.correct += 1;

    if (!s.byYear[question.yearGroup]) {
      s.byYear[question.yearGroup] = { asked: 0, correct: 0 };
    }
    s.byYear[question.yearGroup].asked += 1;
    if (response.isCorrect) s.byYear[question.yearGroup].correct += 1;

    s.byDifficulty[question.difficulty].asked += 1;
    if (response.isCorrect) s.byDifficulty[question.difficulty].correct += 1;
  }

  for (const strand of getEffectiveStrands(session)) {
    updateStrandEstimate(
      session.strands[strand],
      session.entryYear,
      session.minimumYear,
      session.maximumYear
    );
  }

  if (session.subject === Subject.SCIENCE && session.responses.length > 0) {
    session.overallConfidence =
      session.responses.filter((response) => response.isCorrect).length /
      session.responses.length;
  } else {
    const reportableStrands = getReportableStrands(session);
    const confidences = reportableStrands.map(
      (strand) => session.strands[strand].confidence
    );
    session.overallConfidence =
      confidences.length > 0
        ? confidences.reduce((sum, c) => sum + c, 0) / confidences.length
        : 0;
  }

  session.overallWorkingBand = inferOverallWorkingBand(session);
}

function updateStrandEstimate(
  stats: StrandStats,
  entryYear: number,
  minimumYear: number,
  maximumYear: number
): void {
  let targetYear = clamp(entryYear, minimumYear, maximumYear);

  while (targetYear > minimumYear) {
    const yearStats = stats.byYear[targetYear] ?? { asked: 0, correct: 0 };
    const accuracy = yearStats.asked > 0 ? yearStats.correct / yearStats.asked : 0;

    if (yearStats.asked >= 3 && accuracy < 0.5) {
      targetYear -= 1;
      continue;
    }

    break;
  }

  while (targetYear < maximumYear) {
    const yearStats = stats.byYear[targetYear] ?? { asked: 0, correct: 0 };
    const accuracy = yearStats.asked > 0 ? yearStats.correct / yearStats.asked : 0;

    if (
      (yearStats.asked >= 3 && accuracy >= 0.8) ||
      (yearStats.asked >= 4 && accuracy >= 0.75)
    ) {
      targetYear += 1;
      continue;
    }

    break;
  }

  stats.currentTargetYear = clamp(targetYear, minimumYear, maximumYear);

  let secureYear: number | null = null;
  let emergingYear: number | null = null;

  for (let year = minimumYear; year <= maximumYear; year += 1) {
    const yearStats = stats.byYear[year] ?? { asked: 0, correct: 0 };
    const accuracy = yearStats.asked > 0 ? yearStats.correct / yearStats.asked : 0;

    if (yearStats.asked >= 2 && accuracy >= 0.75) {
      secureYear = year;
    }

    if (yearStats.asked >= 2 && accuracy >= 0.6) {
      emergingYear = year;
    }
  }

  stats.secureYear = secureYear;
  stats.emergingYear =
    emergingYear != null && emergingYear > (stats.secureYear ?? minimumYear - 1)
      ? emergingYear
      : null;

  const volumeFactor = clamp(stats.asked / 5, 0, 1);
  const accuracy = stats.asked > 0 ? stats.correct / stats.asked : 0;
  stats.confidence = clamp(volumeFactor * accuracy, 0, 1);
}

function inferOverallWorkingBand(
  session: AssessmentSession
): AssessmentSession["overallWorkingBand"] {
  if (session.subject === Subject.SCIENCE) {
    return inferScienceOverallWorkingBand(session);
  }

  const entryYear = session.entryYear;
  const effectiveStrands = getReportableStrands(session);
  const strands = effectiveStrands.map((s) => session.strands[s]);
  const strandCount = strands.length;

  if (session.responses.length < 6) {
    return "INSUFFICIENT_EVIDENCE";
  }

  const entrySecureCount = strands.filter(
    (s) => (s.secureYear ?? Number.NEGATIVE_INFINITY) >= entryYear
  ).length;
  const nextEmergingCount = strands.filter(
    (s) =>
      (s.emergingYear ?? Number.NEGATIVE_INFINITY) >= entryYear + 1 ||
      (s.secureYear ?? Number.NEGATIVE_INFINITY) >= entryYear + 1
  ).length;
  const nextStrongCount = strands.filter(
    (s) => (s.secureYear ?? Number.NEGATIVE_INFINITY) >= entryYear + 1
  ).length;

  const belowEntryThreshold = Math.max(1, Math.ceil(strandCount * 0.4));
  const entrySecureThreshold = Math.max(1, Math.ceil(strandCount * 0.6));
  const strongEntryThreshold = Math.max(
    entrySecureThreshold,
    Math.ceil(strandCount * 0.8)
  );
  const nextEmergingThreshold = Math.max(1, Math.ceil(strandCount * 0.4));
  const nextStrongThreshold = Math.max(1, Math.ceil(strandCount * 0.6));

  if (entrySecureCount < belowEntryThreshold) return "BELOW_ENTRY";
  if (
    entrySecureCount >= strongEntryThreshold &&
    nextStrongCount >= nextStrongThreshold
  ) {
    return "NEXT_SECURE";
  }
  if (
    entrySecureCount >= strongEntryThreshold &&
    nextEmergingCount >= nextStrongThreshold
  ) {
    return "NEXT_DEVELOPING";
  }
  if (
    entrySecureCount >= strongEntryThreshold &&
    nextEmergingCount >= nextEmergingThreshold
  ) {
    return "ENTRY_SECURE_NEXT_EMERGING";
  }
  if (entrySecureCount >= entrySecureThreshold) {
    return "ENTRY_SECURE";
  }

  return "INSUFFICIENT_EVIDENCE";
}

function inferScienceOverallWorkingBand(
  session: AssessmentSession
): AssessmentSession["overallWorkingBand"] {
  if (session.responses.length < 6) {
    return "INSUFFICIENT_EVIDENCE";
  }

  const byYear = new Map<number, { asked: number; correct: number }>();
  let correct = 0;

  for (const response of session.responses) {
    const yearStats = byYear.get(response.yearGroup) ?? { asked: 0, correct: 0 };
    yearStats.asked += 1;
    if (response.isCorrect) {
      yearStats.correct += 1;
      correct += 1;
    }
    byYear.set(response.yearGroup, yearStats);
  }

  const totalAccuracy = correct / session.responses.length;
  const entryStats = byYear.get(session.entryYear) ?? { asked: 0, correct: 0 };
  const nextStats = byYear.get(session.entryYear + 1) ?? { asked: 0, correct: 0 };
  const entryAccuracy =
    entryStats.asked > 0 ? entryStats.correct / entryStats.asked : totalAccuracy;
  const nextAccuracy = nextStats.asked > 0 ? nextStats.correct / nextStats.asked : 0;
  const entryOrAbove = Array.from(byYear.entries()).reduce(
    (acc, [year, stats]) => {
      if (year >= session.entryYear) {
        acc.asked += stats.asked;
        acc.correct += stats.correct;
      }
      return acc;
    },
    { asked: 0, correct: 0 }
  );
  const entryOrAboveAccuracy =
    entryOrAbove.asked > 0 ? entryOrAbove.correct / entryOrAbove.asked : totalAccuracy;

  if (totalAccuracy < 0.45 || entryOrAboveAccuracy < 0.5) return "BELOW_ENTRY";
  if (nextStats.asked >= 4 && nextAccuracy >= 0.8) return "NEXT_SECURE";
  if (nextStats.asked >= 4 && nextAccuracy >= 0.65 && totalAccuracy >= 0.65) {
    return "NEXT_DEVELOPING";
  }
  if (
    entryStats.asked >= 4 &&
    entryAccuracy >= 0.65 &&
    nextStats.asked > 0
  ) {
    return "ENTRY_SECURE_NEXT_EMERGING";
  }
  if (entryOrAbove.asked >= 6 && entryOrAboveAccuracy >= 0.65) {
    return "ENTRY_SECURE";
  }

  return "BELOW_ENTRY";
}

function normalizeBasic(s: string): string {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, "")
    .replace(/−/g, "-")
    .replace(/×/g, "*")
    .replace(/÷/g, "/")
    .replace(/£/g, "")
    .replace(/,/g, "");
}

function extractLeadingNumber(s: string): number | null {
  const cleaned = s
    .toLowerCase()
    .replace(/cm²|m²|cm|mm|km|kg|g|ml|l|p|°/g, "")
    .replace(/£/g, "")
    .replace(/\s+/g, "")
    .replace(/,/g, "");

  const match = cleaned.match(/-?\d+(\.\d+)?/);
  if (!match) return null;
  const n = Number(match[0]);
  return Number.isFinite(n) ? n : null;
}

function extractAllNumbers(s: string): number[] {
  const cleaned = s
    .toLowerCase()
    .replace(/cm²|m²|cm|mm|km|kg|g|ml|l|p|°/g, "")
    .replace(/£/g, "")
    .replace(/,/g, " ");

  const matches = cleaned.match(/-?\d+(\.\d+)?/g) ?? [];
  return matches
    .map((value) => Number(value))
    .filter((value) => Number.isFinite(value));
}

function matchesRangeWorkingResponse(question: RuntimeQuestion, rawAnswer: string): boolean {
  const prompt = question.promptText.toLowerCase();
  if (!prompt.includes("find the range of")) return false;

  const expected = extractLeadingNumber(question.answerText);
  if (expected === null) return false;

  const numbers = extractAllNumbers(rawAnswer);
  if (numbers.length < 2) return false;

  const [a, b] = numbers;
  return Math.abs(Math.abs(a - b) - expected) < 0.000001;
}

function parseFraction(s: string): { num: number; den: number } | null {
  const cleaned = normalizeBasic(s);
  const match = cleaned.match(/^(-?\d+)\/(-?\d+)$/);
  if (!match) return null;

  const num = Number(match[1]);
  const den = Number(match[2]);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;

  const g = gcd(Math.abs(num), Math.abs(den));
  const normalizedDen = den < 0 ? -den / g : den / g;
  const normalizedNum = den < 0 ? -num / g : num / g;

  return { num: normalizedNum, den: normalizedDen };
}

function gcd(a: number, b: number): number {
  let x = a;
  let y = b;
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function normalizeAlgebra(s: string): string {
  return normalizeBasic(s)
    .replace(/\*\*/g, "^")
    .replace(/1x/g, "x")
    .replace(/\+\-/g, "-");
}

function sameNormalizedSet(left: string[], right: string[]): boolean {
  const a = left.map(normalizeText).sort();
  const b = right.map(normalizeText).sort();
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function markAnswer(
  question: RuntimeQuestion,
  rawAnswer: string,
  structured?: {
    selectedChoiceKey?: AssessmentChoiceKey;
    selectedChoiceKeys?: AssessmentChoiceKey[];
    matchPairs?: AssessmentMatchPair[];
    orderedAnswers?: string[];
  }
): boolean {
  if (question.responseKind === "single_choice" && structured?.selectedChoiceKey != null) {
    return structured.selectedChoiceKey === question.correctChoiceKey;
  }

  if (question.responseKind === "multi_select") {
    return sameNormalizedSet(
      structured?.selectedChoiceKeys ?? [],
      question.correctChoiceKeys ?? []
    );
  }

  if (question.responseKind === "match") {
    const expectedPairs = question.matchPairs ?? [];
    const submittedPairs = structured?.matchPairs ?? [];

    return sameNormalizedSet(
      submittedPairs.map((pair) => `${pair.left}->${pair.right}`),
      expectedPairs.map((pair) => `${pair.left}->${pair.right}`)
    );
  }

  if (question.responseKind === "order") {
    const expected = question.orderedAnswers ?? [];
    const submitted = structured?.orderedAnswers ?? [];

    return (
      submitted.length === expected.length &&
      submitted.every((answer, index) => normalizeText(answer) === normalizeText(expected[index]))
    );
  }

  const immutableAnswers = getImmutableAnswers(question.contentJson);
  if (question.responseKind === "short_answer" && immutableAnswers.length > 0) {
    return immutableAnswers.some((answer) => answerMaskMatches(answer, rawAnswer));
  }

  const expected = question.answerText;

  switch (question.answerMode) {
    case "fraction": {
      const a = parseFraction(rawAnswer);
      const b = parseFraction(expected);
      if (a && b) {
        return a.num === b.num && a.den === b.den;
      }
      return normalizeBasic(rawAnswer) === normalizeBasic(expected);
    }

    case "numeric": {
      if (matchesRangeWorkingResponse(question, rawAnswer)) {
        return true;
      }

      const rawN = extractLeadingNumber(rawAnswer);
      const expN = extractLeadingNumber(expected);

      if (rawN !== null && expN !== null) {
        return Math.abs(rawN - expN) < 0.000001;
      }

      if (answerMaskMatches(expected, rawAnswer)) return true;

      return normalizeBasic(rawAnswer) === normalizeBasic(expected);
    }

    case "algebra": {
      const rawNorm = normalizeAlgebra(rawAnswer);
      const expNorm = normalizeAlgebra(expected);

      if (rawNorm === expNorm) return true;

      const rawN = extractLeadingNumber(rawAnswer);
      const expN = extractLeadingNumber(expected);
      if (rawN !== null && expN !== null) {
        return Math.abs(rawN - expN) < 0.000001;
      }

      return false;
    }

    case "multi_part": {
      const raw = normalizeBasic(rawAnswer).replace(/and/g, ",");
      const exp = normalizeBasic(expected).replace(/and/g, ",");
      return raw === exp;
    }

    default:
      if (answerMaskMatches(expected, rawAnswer)) return true;
      return normalizeBasic(rawAnswer) === normalizeBasic(expected);
  }
}

export function buildAssessmentResult(
  session: AssessmentSession
): AssessmentResult {
  const strandResults = getReportableStrands(session).map((strand) => {
    const s = session.strands[strand];
    return {
      strand,
      secureYear: s.secureYear,
      emergingYear: s.emergingYear,
      confidence: Number(s.confidence.toFixed(2)),
      asked: s.asked,
      correct: s.correct,
      accuracy: s.asked ? Number((s.correct / s.asked).toFixed(2)) : 0,
    };
  });

  return {
    overallWorkingBand: session.overallWorkingBand,
    overallConfidence: Number(session.overallConfidence.toFixed(2)),
    questionCount: session.responses.length,
    completionReason: session.completionReason,
    strands: strandResults,
    summary: buildSummary(session),
  };
}

function buildSummary(session: AssessmentSession): string {
  const parts: string[] = [];
  const effectiveStrands = getReportableStrands(session);

  switch (session.overallWorkingBand) {
    case "BELOW_ENTRY":
      parts.push(
        `Assessment suggests the pupil is not yet secure at Year ${session.entryYear}.`
      );
      break;
    case "ENTRY_SECURE":
      parts.push(
        `Assessment suggests the pupil is broadly secure at Year ${session.entryYear}.`
      );
      break;
    case "ENTRY_SECURE_NEXT_EMERGING":
      parts.push(
        `Assessment suggests the pupil is secure at Year ${session.entryYear} with emerging performance at Year ${session.entryYear + 1}.`
      );
      break;
    case "NEXT_DEVELOPING":
      parts.push(
        `Assessment suggests the pupil is developing at Year ${session.entryYear + 1} across several strands.`
      );
      break;
    case "NEXT_SECURE":
      parts.push(
        `Assessment suggests the pupil is secure at Year ${session.entryYear + 1}.`
      );
      break;
    default:
      parts.push(`Assessment has not yet gathered enough evidence for a stable overall judgement.`);
  }

  const weakest = effectiveStrands
    .map((strand) => session.strands[strand])
    .sort((a, b) => {
      const aa = a.asked ? a.correct / a.asked : 0;
      const bb = b.asked ? b.correct / b.asked : 0;
      return aa - bb;
    })[0];

  const strongest = effectiveStrands
    .map((strand) => session.strands[strand])
    .sort((a, b) => {
      const aa = a.asked ? a.correct / a.asked : 0;
      const bb = b.asked ? b.correct / b.asked : 0;
      return bb - aa;
    })[0];

  if (strongest && strongest.asked > 0) {
    parts.push(`Strongest evidence was in ${strongest.strand.toLowerCase()}.`);
  }

  if (weakest && weakest.asked > 0 && weakest.strand !== strongest?.strand) {
    parts.push(`Weakest evidence was in ${weakest.strand.toLowerCase()}.`);
  }

  parts.push(`Overall confidence: ${Math.round(session.overallConfidence * 100)}%.`);

  return parts.join(" ");
}
