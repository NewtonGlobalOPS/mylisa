import type { CanonicalItemType, CanonicalOperator } from "@prisma/client";
import type { CanonicalCandidate, RenderedCanonicalCandidate } from "./types";

/**
 * =========================================================
 * INTERNAL HELPERS
 * =========================================================
 */

type MissingNumberContent = {
  kind: "missing_number";
  template?: string;
  operator: CanonicalOperator;
  missing: "lhsA" | "lhsB" | "rhs";
  lhsA?: number;
  lhsB?: number;
  rhs?: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isCanonicalOperator(value: unknown): value is CanonicalOperator {
  return (
    value === "ADD" ||
    value === "SUBTRACT" ||
    value === "MULTIPLY" ||
    value === "DIVIDE" ||
    value === "EQUALS"
  );
}

function formatOperator(operator: CanonicalOperator): string {
  switch (operator) {
    case "ADD":
      return "+";
    case "SUBTRACT":
      return "−";
    case "MULTIPLY":
      return "×";
    case "DIVIDE":
      return "÷";
    case "EQUALS":
      return "=";
    default:
      return "?";
  }
}

function buildEquationString(
  operator: CanonicalOperator,
  lhsA: number | string,
  lhsB: number | string,
  rhs: number | string
): string {
  return `${lhsA} ${formatOperator(operator)} ${lhsB} = ${rhs}`;
}

function toContentJson(
  content: Record<string, unknown> | undefined
): Record<string, unknown> | undefined {
  if (!content) return undefined;
  return { ...content };
}

function getPromptPartsPrompt(promptParts: unknown): string | null {
  if (typeof promptParts === "string") {
    return promptParts.trim() || null;
  }

  if (Array.isArray(promptParts)) {
    const text = promptParts
      .map((part) => {
        if (typeof part === "string") return part;
        if (isRecord(part) && typeof part.text === "string") return part.text;
        return "";
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return text || null;
  }

  if (isRecord(promptParts) && typeof promptParts.text === "string") {
    return promptParts.text.trim() || null;
  }

  return null;
}

function getAnswerText(answer: unknown): string | null {
  if (typeof answer === "string") {
    return answer.trim() || null;
  }

  if (typeof answer === "number") {
    return String(answer);
  }

  if (Array.isArray(answer)) {
    const text = answer
      .map((part) => {
        if (typeof part === "string") return part;
        if (typeof part === "number") return String(part);
        if (isRecord(part) && typeof part.text === "string") return part.text;
        return "";
      })
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();

    return text || null;
  }

  if (isRecord(answer) && typeof answer.text === "string") {
    return answer.text.trim() || null;
  }

  return null;
}

function normalizeItemType(
  value: unknown,
  fallback: CanonicalItemType = "EQUATION"
): CanonicalItemType {
  switch (value) {
    case "EQUATION":
    case "MISSING_NUMBER":
    case "COMPARISON":
    case "ONE_MORE_ONE_LESS":
    case "NUMBER_SEQUENCE":
    case "NUMBER_LINE":
    case "MEASUREMENT_COMPARE":
    case "FRACTION_OF_QUANTITY":
    case "TURN_DIRECTION":
    case "TIME_MATCH":
    case "DATE_SEQUENCE":
    case "COIN_VALUE":
    case "SHAPE_NAME":
      return value;
    default:
      return fallback;
  }
}

function renderEquationCandidate(
  candidate: CanonicalCandidate
): RenderedCanonicalCandidate | null {
  if (
    !candidate.itemType ||
    candidate.itemType !== "EQUATION" ||
    !isCanonicalOperator(candidate.operator) ||
    typeof candidate.lhsA !== "number" ||
    typeof candidate.lhsB !== "number" ||
    typeof candidate.rhs !== "number"
  ) {
    return null;
  }

  const equation = buildEquationString(
    candidate.operator,
    candidate.lhsA,
    candidate.lhsB,
    candidate.rhs
  );

  return {
    itemType: "EQUATION",
    promptText: equation,
    answerText: String(candidate.rhs),
    operator: candidate.operator,
    lhsA: candidate.lhsA,
    lhsB: candidate.lhsB,
    rhs: candidate.rhs,
    equation,
    contentJson: toContentJson(candidate.content),
  };
}

function isMissingNumberContent(value: unknown): value is MissingNumberContent {
  return (
    isRecord(value) &&
    value.kind === "missing_number" &&
    isCanonicalOperator(value.operator) &&
    (value.missing === "lhsA" ||
      value.missing === "lhsB" ||
      value.missing === "rhs")
  );
}

function renderMissingNumberCandidate(
  candidate: CanonicalCandidate
): RenderedCanonicalCandidate | null {
  if (!isMissingNumberContent(candidate.content)) {
    return null;
  }

  const itemType = normalizeItemType(candidate.itemType, "MISSING_NUMBER");
  if (itemType !== "MISSING_NUMBER") {
    return null;
  }

  const { operator, missing } = candidate.content;
  const lhsA =
    typeof candidate.content.lhsA === "number" ? candidate.content.lhsA : undefined;
  const lhsB =
    typeof candidate.content.lhsB === "number" ? candidate.content.lhsB : undefined;
  const rhs =
    typeof candidate.content.rhs === "number" ? candidate.content.rhs : undefined;

  const lhsADisplay = missing === "lhsA" ? "□" : lhsA;
  const lhsBDisplay = missing === "lhsB" ? "□" : lhsB;
  const rhsDisplay = missing === "rhs" ? "□" : rhs;

  if (
    lhsADisplay === undefined ||
    lhsBDisplay === undefined ||
    rhsDisplay === undefined
  ) {
    return null;
  }

  const equation = buildEquationString(operator, lhsADisplay, lhsBDisplay, rhsDisplay);

  let answerText: string | null = null;
  if (missing === "lhsA" && typeof lhsA === "number") answerText = String(lhsA);
  if (missing === "lhsB" && typeof lhsB === "number") answerText = String(lhsB);
  if (missing === "rhs" && typeof rhs === "number") answerText = String(rhs);

  if (!answerText) return null;

  return {
    itemType: "MISSING_NUMBER",
    promptText: equation,
    answerText,
    operator,
    lhsA,
    lhsB,
    rhs,
    equation,
    contentJson: toContentJson(candidate.content),
  };
}

function renderGenericCandidate(
  candidate: CanonicalCandidate
): RenderedCanonicalCandidate | null {
  if (!candidate.itemType) return null;

  const promptText = getPromptPartsPrompt(candidate.promptParts);
  const answerText = getAnswerText(candidate.answer);

  if (!promptText || !answerText) {
    return null;
  }

  return {
    itemType: normalizeItemType(candidate.itemType),
    promptText,
    answerText,
    contentJson: toContentJson(candidate.content),
  };
}

/**
 * =========================================================
 * PUBLIC API
 * =========================================================
 */

export function renderCanonicalCandidate(
  candidate: CanonicalCandidate
): RenderedCanonicalCandidate | null {
  const missingNumberRendered = renderMissingNumberCandidate(candidate);
  if (missingNumberRendered) return missingNumberRendered;

  const equationRendered = renderEquationCandidate(candidate);
  if (equationRendered) return equationRendered;

  return renderGenericCandidate(candidate);
}

export function renderEquation(
  operator: CanonicalOperator,
  lhsA: number,
  lhsB: number,
  rhs: number
): string {
  return buildEquationString(operator, lhsA, lhsB, rhs);
}