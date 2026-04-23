import type {
  CanonicalProfile,
  EquationGenerationProfile,
  GeneratedCanonicalQuestion,
} from "./types";
import { isCanonicalProfile } from "./types";

/**
 * =========================================================
 * VALIDATION TYPES
 * =========================================================
 */

export type ValidationIssue = {
  code: string;
  message: string;
  index?: number;
};

export type ValidationResult = {
  ok: boolean;
  issues: ValidationIssue[];
};

type GenerationProfile = CanonicalProfile | EquationGenerationProfile;

/**
 * =========================================================
 * INTERNAL HELPERS
 * =========================================================
 */

function issue(
  code: string,
  message: string,
  index?: number
): ValidationIssue {
  return { code, message, index };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function getTargetCount(profile: GenerationProfile): number {
  return isCanonicalProfile(profile) ? profile.targetCount : profile.count;
}

function normalizeText(value: string | undefined | null): string {
  return (value ?? "").trim();
}

function questionIdentityKey(question: GeneratedCanonicalQuestion): string {
  return JSON.stringify({
    itemType: question.itemType,
    promptText: normalizeText(question.promptText),
    answerText: normalizeText(question.answerText),
    operator: question.operator ?? null,
    lhsA: question.lhsA ?? null,
    lhsB: question.lhsB ?? null,
    rhs: question.rhs ?? null,
    equation: question.equation ?? null,
    contentJson: question.contentJson ?? null,
  });
}

function isMissingNumberContent(
  contentJson: Record<string, unknown> | undefined
): boolean {
  return isRecord(contentJson) && contentJson.kind === "missing_number";
}

function validateBasicFields(
  question: GeneratedCanonicalQuestion,
  index: number
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!question.itemType) {
    issues.push(issue("MISSING_ITEM_TYPE", "Question itemType is missing.", index));
  }

  if (!normalizeText(question.promptText)) {
    issues.push(issue("EMPTY_PROMPT", "Question promptText is empty.", index));
  }

  if (!normalizeText(question.answerText)) {
    issues.push(issue("EMPTY_ANSWER", "Question answerText is empty.", index));
  }

  if (!question.difficulty) {
    issues.push(issue("MISSING_DIFFICULTY", "Question difficulty is missing.", index));
  }

  return issues;
}

function validateEquationShape(
  question: GeneratedCanonicalQuestion,
  index: number
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  const isEquationItem = question.itemType === "EQUATION";
  const isMissingNumberItem = question.itemType === "MISSING_NUMBER";
  const hasEquationFields =
    typeof question.operator === "string" ||
    typeof question.lhsA === "number" ||
    typeof question.lhsB === "number" ||
    typeof question.rhs === "number" ||
    typeof question.equation === "string";

  if (!isEquationItem && !isMissingNumberItem && !hasEquationFields) {
    return issues;
  }

  if (!isEquationItem && !isMissingNumberItem && hasEquationFields) {
    issues.push(
      issue(
        "NON_MATH_ITEM_WITH_EQUATION_FIELDS",
        "Non-maths item contains equation fields.",
        index
      )
    );
    return issues;
  }

  if (question.operator !== "ADD" && question.operator !== "SUBTRACT") {
    issues.push(
      issue(
        "INVALID_OPERATOR",
        "Math item must have operator ADD or SUBTRACT.",
        index
      )
    );
  }

  const missingNumber = isMissingNumberContent(question.contentJson);

  if (isEquationItem) {
    if (missingNumber) {
      issues.push(
        issue(
          "EQUATION_WITH_MISSING_NUMBER_CONTENT",
          "Equation item should not carry missing-number content.",
          index
        )
      );
    }

    if (typeof question.lhsA !== "number") {
      issues.push(issue("MISSING_LHSA", "Equation item lhsA is missing.", index));
    }
    if (typeof question.lhsB !== "number") {
      issues.push(issue("MISSING_LHSB", "Equation item lhsB is missing.", index));
    }
    if (typeof question.rhs !== "number") {
      issues.push(issue("MISSING_RHS", "Equation item rhs is missing.", index));
    }
  }

  if (isMissingNumberItem) {
    if (!missingNumber) {
      issues.push(
        issue(
          "MISSING_NUMBER_CONTENT_REQUIRED",
          "Missing-number item must include missing-number content.",
          index
        )
      );
    } else {
      const content = question.contentJson as Record<string, unknown>;
      const missing = content.missing;

      if (missing !== "lhsA" && missing !== "lhsB" && missing !== "rhs") {
        issues.push(
          issue(
            "INVALID_MISSING_NUMBER_SHAPE",
            "Missing-number content must declare missing as lhsA, lhsB, or rhs.",
            index
          )
        );
      }

      if (
        typeof content.operator !== "string" ||
        (content.operator !== "ADD" && content.operator !== "SUBTRACT")
      ) {
        issues.push(
          issue(
            "INVALID_MISSING_NUMBER_OPERATOR",
            "Missing-number content must include a valid operator.",
            index
          )
        );
      }

      if (typeof content.lhsA !== "number") {
        issues.push(
          issue(
            "INVALID_MISSING_NUMBER_LHSA",
            "Missing-number content must include lhsA.",
            index
          )
        );
      }

      if (typeof content.lhsB !== "number") {
        issues.push(
          issue(
            "INVALID_MISSING_NUMBER_LHSB",
            "Missing-number content must include lhsB.",
            index
          )
        );
      }

      if (typeof content.rhs !== "number") {
        issues.push(
          issue(
            "INVALID_MISSING_NUMBER_RHS",
            "Missing-number content must include rhs.",
            index
          )
        );
      }
    }
  }

  if ((isEquationItem || isMissingNumberItem) && !normalizeText(question.equation)) {
    issues.push(
      issue(
        "MISSING_EQUATION_TEXT",
        "Math item should include equation text.",
        index
      )
    );
  }

  return issues;
}

function validateEquationMath(
  question: GeneratedCanonicalQuestion,
  index: number
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];
  const isEquationItem = question.itemType === "EQUATION";
  const isMissingNumberItem = question.itemType === "MISSING_NUMBER";

  if (!isEquationItem && !isMissingNumberItem) {
    return issues;
  }

  if (isMissingNumberItem) {
    if (!isMissingNumberContent(question.contentJson)) {
      return issues;
    }

    const content = question.contentJson as Record<string, unknown>;
    const operator = content.operator;
    const lhsA = typeof content.lhsA === "number" ? content.lhsA : undefined;
    const lhsB = typeof content.lhsB === "number" ? content.lhsB : undefined;
    const rhs = typeof content.rhs === "number" ? content.rhs : undefined;
    const missing = content.missing;

    if (
      operator === "ADD" &&
      typeof lhsA === "number" &&
      typeof lhsB === "number" &&
      typeof rhs === "number" &&
      lhsA + lhsB !== rhs
    ) {
      issues.push(
        issue(
          "INVALID_MISSING_NUMBER_ADD_MATH",
          "Missing-number addition content is mathematically inconsistent.",
          index
        )
      );
    }

    if (
      operator === "SUBTRACT" &&
      typeof lhsA === "number" &&
      typeof lhsB === "number" &&
      typeof rhs === "number" &&
      lhsA - lhsB !== rhs
    ) {
      issues.push(
        issue(
          "INVALID_MISSING_NUMBER_SUBTRACT_MATH",
          "Missing-number subtraction content is mathematically inconsistent.",
          index
        )
      );
    }

    if (
      (missing === "lhsA" || missing === "lhsB" || missing === "rhs") &&
      !normalizeText(question.answerText)
    ) {
      issues.push(
        issue(
          "MISSING_NUMBER_EMPTY_ANSWER",
          "Missing-number question must have a non-empty answer.",
          index
        )
      );
    }

    return issues;
  }

  if (
    typeof question.lhsA !== "number" ||
    typeof question.lhsB !== "number" ||
    typeof question.rhs !== "number"
  ) {
    return issues;
  }

  if (question.operator === "ADD" && question.lhsA + question.lhsB !== question.rhs) {
    issues.push(
      issue(
        "INVALID_ADD_MATH",
        "Addition equation is mathematically inconsistent.",
        index
      )
    );
  }

  if (
    question.operator === "SUBTRACT" &&
    question.lhsA - question.lhsB !== question.rhs
  ) {
    issues.push(
      issue(
        "INVALID_SUBTRACT_MATH",
        "Subtraction equation is mathematically inconsistent.",
        index
      )
    );
  }

  return issues;
}

function validateDifficultyAgainstProfile(
  question: GeneratedCanonicalQuestion,
  profile: GenerationProfile,
  index: number
): ValidationIssue[] {
  const issues: ValidationIssue[] = [];

  if (!isCanonicalProfile(profile)) {
    return issues;
  }

  const maxConstraint = profile.constraints?.max;
  const minConstraint = profile.constraints?.min;

  const values = [question.lhsA, question.lhsB, question.rhs].filter(
    (v): v is number => typeof v === "number"
  );

  const contentValues = isRecord(question.contentJson)
    ? [question.contentJson.lhsA, question.contentJson.lhsB, question.contentJson.rhs].filter(
        (v): v is number => typeof v === "number"
      )
    : [];

  const allValues = [...values, ...contentValues];

  if (typeof minConstraint === "number") {
    for (const value of allValues) {
      if (value < minConstraint) {
        issues.push(
          issue(
            "BELOW_MIN_CONSTRAINT",
            `Question contains value ${value} below profile minimum ${minConstraint}.`,
            index
          )
        );
        break;
      }
    }
  }

  if (typeof maxConstraint === "number") {
    for (const value of allValues) {
      if (value > maxConstraint) {
        issues.push(
          issue(
            "ABOVE_MAX_CONSTRAINT",
            `Question contains value ${value} above profile maximum ${maxConstraint}.`,
            index
          )
        );
        break;
      }
    }
  }

  return issues;
}

/**
 * =========================================================
 * PUBLIC API
 * =========================================================
 */

export function validateGeneratedQuestions(
  questions: GeneratedCanonicalQuestion[],
  profile?: GenerationProfile
): ValidationResult {
  const issues: ValidationIssue[] = [];

  if (!Array.isArray(questions)) {
    return {
      ok: false,
      issues: [issue("INVALID_INPUT", "Questions must be an array.")],
    };
  }

  if (questions.length === 0) {
    issues.push(issue("EMPTY_SET", "No questions were generated."));
  }

  const seen = new Set<string>();

  questions.forEach((question, index) => {
    issues.push(...validateBasicFields(question, index));
    issues.push(...validateEquationShape(question, index));
    issues.push(...validateEquationMath(question, index));

    if (profile) {
      issues.push(...validateDifficultyAgainstProfile(question, profile, index));
    }

    const key = questionIdentityKey(question);
    if (seen.has(key)) {
      issues.push(
        issue("DUPLICATE_QUESTION", "Duplicate generated question detected.", index)
      );
    } else {
      seen.add(key);
    }
  });

  if (profile) {
    const targetCount = getTargetCount(profile);
    if (questions.length !== targetCount) {
      issues.push(
        issue(
          "COUNT_MISMATCH",
          `Generated ${questions.length} questions, expected ${targetCount}.`
        )
      );
    }
  }

  return {
    ok: issues.length === 0,
    issues,
  };
}

export function assertValidGeneratedQuestions(
  questions: GeneratedCanonicalQuestion[],
  profile?: GenerationProfile
): void {
  const result = validateGeneratedQuestions(questions, profile);

  if (!result.ok) {
    const message = result.issues
      .map((entry) =>
        typeof entry.index === "number"
          ? `[${entry.code}] item ${entry.index}: ${entry.message}`
          : `[${entry.code}] ${entry.message}`
      )
      .join("\n");

    throw new Error(`Generated question validation failed:\n${message}`);
  }
}