import type {
  CanonicalItemType,
  CanonicalOperator,
  DifficultyBand,
} from "@prisma/client";

/**
 * =========================================================
 * CORE GENERATED / RENDERED ITEM TYPES
 * =========================================================
 */

export type GeneratedCanonicalQuestion = {
  itemType: CanonicalItemType;

  promptText: string;
  answerText: string;
  difficulty: DifficultyBand;

  contentJson?: Record<string, unknown>;
  generatorVersion?: string;
  generatorMeta?: Record<string, unknown>;

  operator?: CanonicalOperator;
  lhsA?: number;
  lhsB?: number;
  rhs?: number;
  equation?: string;
};

export type GeneratedCanonicalQuestionWithSequence =
  GeneratedCanonicalQuestion & {
    sequence: number;
  };

export type RenderedCanonicalCandidate = {
  itemType: CanonicalItemType;
  promptText: string;
  answerText: string;

  operator?: CanonicalOperator;
  lhsA?: number;
  lhsB?: number;
  rhs?: number;
  equation?: string;

  contentJson?: Record<string, unknown>;
};

/**
 * Internal candidate type used before rendering.
 * This remains broad enough to support both:
 * - the new generic canonical pipeline
 * - the legacy equation diversity helpers
 */
export type CanonicalCandidate = {
  itemType?: CanonicalItemType;

  promptParts?: unknown;
  answer?: unknown;

  content?: Record<string, unknown>;

  operator?: CanonicalOperator;
  lhsA?: number;
  lhsB?: number;
  rhs?: number;

  weight?: number;
  tags?: string[];
};

/**
 * =========================================================
 * LEGACY EQUATION PROFILE TYPES
 * =========================================================
 */

export type CandidateForm = "STANDARD_EQUATION";

export type EquationCandidateRules = {
  forbidNearIdentity?: boolean;
  forbidZeroResult?: boolean;
  minOperandSumForAdd?: number;
  minMinuendForSubtract?: number;
  forbidPlusOne?: boolean;
  forbidMinusOne?: boolean;
  minBothOperandsAtLeastForAdd?: number;
  minSubtrahend?: number;
  requireHighValueAddPairs?: boolean;
  minDifferenceForSubtract?: number;
};

export type EquationDiversityProfile = {
  minLargeOperandQuestions: number;
  minCrossTenQuestions: number;
  minTwoDigitOperandQuestions: number;
  maxZeroQuestions: number;
  minDistinctResults: number;
  maxSameResult: number;
  avoidCommutativeDuplicates: boolean;
};

export type EquationGenerationProfile = {
  name: string;
  strategy?: "POOL" | "DIRECT";
  operators: CanonicalOperator[];
  minA: number;
  maxA: number;
  minB: number;
  maxB: number;
  minResult: number;
  maxResult: number;
  allowZero: boolean;
  allowTwoDigitOperands: boolean;
  forms: CandidateForm[];
  count: number;
  targetDifficultySplit: {
    easy: number;
    medium: number;
    hard: number;
  };
  diversity: EquationDiversityProfile;
  candidateRules?: EquationCandidateRules;
  directGenerator?: DirectGeneratorName;
};

export type ObjectiveGenerationProfile = EquationGenerationProfile;

/**
 * =========================================================
 * NEW CANONICAL PROFILE TYPES
 * =========================================================
 */

export type CanonicalProfile = {
  name: string;

  pool?: string;
  directGenerator?: DirectGeneratorName | string;

  targetCount: number;

  constraints?: {
    min?: number;
    max?: number;
    allowNegative?: boolean;
  };

  difficulty?: {
    easyMax?: number;
    mediumMax?: number;
  };

  diversity?: {
    enforceVariety?: boolean;
    requiredForms?: string[];
  };
};

export type AnyGenerationProfile =
  | CanonicalProfile
  | EquationGenerationProfile;

export type ObjectiveProfileDefinition<
  TProfile extends AnyGenerationProfile = AnyGenerationProfile
> = {
  objectiveCode: string;
  profile: TProfile;
};

export type GenerationContext = {
  objectiveId: string;
  profile: CanonicalProfile;
  generatorVersion: string;
};

export type CanonicalQuestionInsert = {
  objectiveId: string;

  itemType: CanonicalItemType;
  operator?: CanonicalOperator;

  lhsA?: number;
  lhsB?: number;
  rhs?: number;
  equation?: string;

  promptText: string;
  answerText: string;

  contentJson?: Record<string, unknown>;

  sequence: number;
  difficulty: DifficultyBand;

  isGenerated: boolean;
  generatorVersion?: string;
  generatorMeta?: Record<string, unknown>;
};

/**
 * =========================================================
 * DIRECT GENERATOR / RULE TYPES
 * =========================================================
 */

export type DirectGeneratorName =
  | "MISSING_NUMBER_TO_20"
  | "MEASUREMENT_COMPARISON"
  | "ONE_MORE_ONE_LESS_TO_20"
  | "NUMBER_LINE_AND_COMPARISON_TO_20"
  | "COUNT_ACROSS_100"
  | "SKIP_COUNTING_TO_100"
  | "FRACTION_HALVES"
  | "FRACTION_QUARTERS"
  | "TURN_DIRECTION"
  | "TIME_HOUR_AND_HALF_PAST"
  | "DATE_LANGUAGE"
  | "CHRONOLOGY_LANGUAGE"
  | "COIN_VALUES"
  | "SHAPE_NAMING"
  | "MULTIPLICATION_DIVISION_FACTS"
  | "one_more_one_less_to_20"
  | "comparison_within_20"
  | "count_forwards_to_20"
  | "count_backwards_from_20"
  | "count_in_2s"
  | "count_in_5s"
  | "count_in_10s"
  | "number_line_within_20"
  | "half_of_quantity"
  | "quarter_of_quantity"
  | "measurement_compare"
  | "turn_direction"
  | "time_match_hour_half_hour"
  | "date_sequence"
  | "coin_value"
  | "shape_name"
  | "Y3_TIMES_TABLES"
  | "Y3_COUNT_MULTIPLES"
  | "Y3_MULTIPLY_DIVIDE"
  | "Y3_PLACE_VALUE_3_DIGIT"
  | "Y3_MORE_LESS_10_100"
  | "Y3_COMPARE_1000"
  | "Y3_ADD_SUBTRACT_MENTAL"
  | "Y3_ADD_SUBTRACT_COLUMN"
  | "Y3_FRACTIONS_BASIC"
  | "Y3_FRACTIONS_COMPARE"
  | "Y3_FRACTIONS_EQUIVALENT"
  | "Y3_FRACTION_OF_QUANTITY"
  | "Y3_MEASURES"
  | "Y3_DATA_INTERPRETATION"
  | "Y3_PERIMETER"
  | "Y3_ANGLES"
  | "Y3_LINES_AND_SHAPES"
  | "Y3_TIME"
  | "Y4_TIMES_TABLES"
  | "Y4_COUNT_MULTIPLES"
  | "Y4_MENTAL_MULTIPLY_DIVIDE"
  | "Y4_PLACE_VALUE_4_DIGIT"
  | "Y4_THOUSAND_MORE_LESS"
  | "Y4_ROUNDING"
  | "Y4_COMPARE_1000"
  | "Y4_ADD_SUBTRACT_4_DIGIT"
  | "Y4_MULTIPLY_DIVIDE_10_100"
  | "Y4_EQUIVALENT_FRACTIONS"
  | "Y4_FRACTIONS_SAME_DENOMINATOR"
  | "Y4_FRACTION_OF_QUANTITY"
  | "Y4_COORDINATES"
  | "Y4_PERIMETER"
  | "Y4_SYMMETRY"
  | "Y4_TIME_24_HOUR"
  | "Y4_UNIT_CONVERSION"
  | "Y4_DATA_INTERPRETATION"
  | "Y4_MONEY"
  // Secondary maths
  | "SIMPLIFY_EXPRESSION"
  | "SOLVE_LINEAR_ONE_STEP"
  | "SOLVE_LINEAR_TWO_STEP"
  | "EXPAND_SINGLE_BRACKET"
  | "SUBSTITUTE_INTO_EXPRESSION"
  | "LINEAR_SEQUENCE_TERM"
  | "FRACTION_OPERATIONS_FOUNDATION"
  | "DECIMAL_OPERATIONS_FOUNDATION"
  | "PERCENTAGE_OF_AMOUNT"
  | "PERCENTAGE_CHANGE_FOUNDATION"
  | "RATIO_SHARE"
  | "RATIO_SCALE"
  | "ANGLE_FACTS_FOUNDATION"
  | "AREA_PERIMETER_FOUNDATION"
  | "CIRCUMFERENCE_AREA_CIRCLE_FOUNDATION"
  | "PYTHAGORAS_FOUNDATION"
  | "MEAN_MEDIAN_MODE_RANGE"
  | "PROBABILITY_FOUNDATION";

/**
 * Legacy rule output shape
 */
export type LegacyGeneratedCanonicalQuestion = {
  sequence: number;
  operator: CanonicalOperator;
  lhsA: number;
  lhsB: number;
  rhs: number;
  equation: string;
  difficulty: DifficultyBand;
  generatorMeta?: Record<string, unknown>;
};

export type CanonicalRuleName =
  | "add_within_10"
  | "subtract_within_10"
  | "number_bonds_within_10";

export type CanonicalRuleGenerator = () => LegacyGeneratedCanonicalQuestion[];

export type ObjectiveRuleDefinition = {
  objectiveCode?: string;
  objectiveTitleIncludes?: string[];
  objectiveStatementIncludes?: string[];
  rule: CanonicalRuleName;
};

/**
 * =========================================================
 * TYPE GUARDS
 * =========================================================
 */

export function isEquationItem(
  item: GeneratedCanonicalQuestion
): boolean {
  return item.itemType === "EQUATION";
}

export function isSequenceItem(
  item: GeneratedCanonicalQuestion
): boolean {
  return item.itemType === "NUMBER_SEQUENCE";
}

export function isComparisonItem(
  item: GeneratedCanonicalQuestion
): boolean {
  return item.itemType === "COMPARISON";
}

export function isFractionItem(
  item: GeneratedCanonicalQuestion
): boolean {
  return item.itemType === "FRACTION_OF_QUANTITY";
}

export function isEquationGenerationProfile(
  profile: AnyGenerationProfile
): profile is EquationGenerationProfile {
  return (
    "operators" in profile &&
    "minA" in profile &&
    "maxA" in profile &&
    "count" in profile
  );
}

export function isCanonicalProfile(
  profile: AnyGenerationProfile
): profile is CanonicalProfile {
  return "targetCount" in profile;
}

/**
 * =========================================================
 * DETERMINISTIC KEYING
 * =========================================================
 */

export function buildDeterministicKey(
  item: GeneratedCanonicalQuestion
): string {
  const base = {
    itemType: item.itemType,
    operator: item.operator ?? null,
    lhsA: item.lhsA ?? null,
    lhsB: item.lhsB ?? null,
    rhs: item.rhs ?? null,
    promptText: item.promptText,
    answerText: item.answerText,
    contentJson: item.contentJson ?? null,
  };

  return JSON.stringify(base);
}
