import type { CanonicalProfile } from "./types";
import { getProfileForObjective as getKs1ProfileForObjective } from "./KS1/getProfileForObjective";

type ObjectiveLike = {
  code?: string;
  subject?: string;
  keyStage?: string;
  yearGroup?: number | null;
  title?: string;
  statement?: string;
  strand?: string;
  keywords?: string[];
};

function hasAny(text: string, terms: string[]): boolean {
  return terms.some((term) => text.includes(term));
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function hasWholeWord(text: string, terms: string[]): boolean {
  return terms.some((term) => {
    const pattern = new RegExp(`\\b${escapeRegExp(term)}\\b`);
    return pattern.test(text);
  });
}

function normalise(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function normaliseObjectiveText(objective: ObjectiveLike): string {
  return [
    objective.code,
    objective.title,
    objective.statement,
    objective.strand,
    ...(objective.keywords ?? []),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

function buildDirectProfile(
  name: string,
  directGenerator: string,
  targetCount = 10
): CanonicalProfile {
  return {
    name,
    directGenerator,
    targetCount,
    diversity: {
      enforceVariety: true,
    },
  };
}

function classifyYear3MathsDirectGenerator(objective: ObjectiveLike): string | null {
  if (objective.subject !== "MATHS") return null;
  if (objective.yearGroup !== 3) return null;

  const text = normaliseObjectiveText(objective);

  if (
    hasAny(text, [
      "recall and use multiplication and division facts for the 3, 4 and 8 multiplication tables",
      "3, 4 and 8 multiplication tables",
    ])
  ) {
    return "Y3_TIMES_TABLES";
  }

  if (
    hasAny(text, [
      "count from 0 in multiples of 4, 8, 50 and 100",
      "find 10 or 100 more or less than a given number",
    ])
  ) {
    return hasAny(text, ["10 or 100 more or less"])
      ? "Y3_MORE_LESS_10_100"
      : "Y3_COUNT_MULTIPLES";
  }

  if (
    hasAny(text, [
      "multiplication and division using the multiplication tables that they know",
      "two-digit numbers times one-digit numbers",
      "missing number problems, involving multiplication and division",
      "positive integer scaling problems",
      "correspondence problems",
    ])
  ) {
    return "Y3_MULTIPLY_DIVIDE";
  }

  if (
    hasAny(text, [
      "recognise the place value of each digit in a 3-digit number",
      "read and write numbers up to 1,000",
      "identify, represent and estimate numbers",
    ])
  ) {
    return "Y3_PLACE_VALUE_3_DIGIT";
  }

  if (hasAny(text, ["compare and order numbers up to 1,000"])) {
    return "Y3_COMPARE_1000";
  }

  if (
    hasAny(text, [
      "add and subtract numbers mentally",
      "more complex addition and subtraction",
      "rearrange equations",
    ])
  ) {
    return "Y3_ADD_SUBTRACT_MENTAL";
  }

  if (
    hasAny(text, [
      "formal written methods of columnar addition and subtraction",
      "columnar addition and subtraction",
      "estimate the answer to a calculation and use inverse operations to check answers",
    ])
  ) {
    return "Y3_ADD_SUBTRACT_COLUMN";
  }

  if (
    hasAny(text, [
      "recognise and use fractions as numbers",
      "unit fractions and non-unit fractions with small denominators",
      "unit fractions as part of a whole",
    ])
  ) {
    return "Y3_FRACTIONS_BASIC";
  }

  if (hasAny(text, ["compare and order unit fractions, and fractions with the same denominators"])) {
    return "Y3_FRACTIONS_COMPARE";
  }

  if (
    hasAny(text, [
      "equivalent fractions with small denominators",
      "recognise and show, using diagrams, equivalent fractions",
    ])
  ) {
    return "Y3_FRACTIONS_EQUIVALENT";
  }

  if (
    hasAny(text, [
      "find and write fractions of a discrete set of objects",
      "fractions as operators",
      "calculate the value of a part",
      "calculate-the-value-of-a-part-fractions-as-operators",
    ])
  ) {
    return "Y3_FRACTION_OF_QUANTITY";
  }

  if (
    hasAny(text, [
      "add and subtract fractions with the same denominator within one whole",
    ])
  ) {
    return "Y3_FRACTIONS_BASIC";
  }

  if (
    hasAny(text, [
      "measure, compare, add and subtract: lengths",
      "mass (kg/g)",
      "volume/capacity (l/ml)",
      "measure, compare, add and subtract",
      "measures-mass-and-capacity",
      "measuring-length-and-recording-in-tables",
    ])
  ) {
    return "Y3_MEASURES";
  }

  if (
    hasAny(text, [
      "compare-and-order-unit-fractions",
      "composition-of-non-unit-fractions",
      "identify-parts-and-wholes-in-different-contexts",
      "non-unit-fractions",
      "unit-fractions-as-part-of-a-whole",
    ])
  ) {
    if (hasAny(text, ["compare-and-order-unit-fractions"])) {
      return "Y3_FRACTIONS_COMPARE";
    }
    if (hasAny(text, ["equivalent"])) {
      return "Y3_FRACTIONS_EQUIVALENT";
    }
    if (hasAny(text, ["calculate-the-value-of-a-part-fractions-as-operators"])) {
      return "Y3_FRACTION_OF_QUANTITY";
    }
    return "Y3_FRACTIONS_BASIC";
  }

  if (
    hasAny(text, [
      "interpret and present data using bar charts, pictograms and tables",
      "scaled bar charts and pictograms and tables",
    ])
  ) {
    return "Y3_DATA_INTERPRETATION";
  }

  if (
    hasAny(text, [
      "measure the perimeter of simple 2-d shapes",
      "perimeter of simple 2-d shapes",
    ])
  ) {
    return "Y3_PERIMETER";
  }

  if (
    hasAny(text, [
      "identify right angles",
      "angles as a property of shape",
      "greater than or less than a right angle",
    ])
  ) {
    return "Y3_ANGLES";
  }

  if (
    hasAny(text, [
      "horizontal and vertical lines",
      "perpendicular and parallel lines",
      "draw 2-d shapes",
      "recognise 3-d shapes",
    ])
  ) {
    return "Y3_LINES_AND_SHAPES";
  }

  if (
    hasAny(text, [
      "tell and write the time from an analogue clock",
      "estimate and read time with increasing accuracy to the nearest minute",
      "compare durations of events",
      "seconds in a minute",
      "24-hour clocks",
      "12-hour and 24-hour clocks",
    ])
  ) {
    return "Y3_TIME";
  }

  if (
    hasAny(text, [
      "bridging-100",
      "understand-additive-relationships-and-apply-them-to-rearrange-equations",
    ])
  ) {
    return "Y3_ADD_SUBTRACT_MENTAL";
  }

  if (
    hasAny(text, [
      "representing-3-digit-numbers-comparing-and-positioning-on-number-lines",
      "securing-place-value-to-100-and-applying-to-addition-and-subtraction",
    ])
  ) {
    return "Y3_PLACE_VALUE_3_DIGIT";
  }

  return null;
}

function classifyYear4MathsDirectGenerator(objective: ObjectiveLike): string | null {
  if (objective.subject !== "MATHS") return null;
  if (objective.yearGroup !== 4) return null;

  const text = normaliseObjectiveText(objective);

  if (
    hasAny(text, [
      "recall multiplication and division facts",
      "12 × 12",
      "12 x 12",
    ])
  ) {
    return "Y4_TIMES_TABLES";
  }

  if (hasAny(text, ["count in multiples of 6, 7, 9, 25 and 1,000"])) {
    return "Y4_COUNT_MULTIPLES";
  }

  if (
    hasAny(text, [
      "multiply and divide mentally",
      "multiplying by 0 and 1",
      "dividing by 1",
      "multiplying together 3 numbers",
      "factor pairs",
      "commutativity",
      "multiplying and adding",
      "distributive law",
    ])
  ) {
    return "Y4_MENTAL_MULTIPLY_DIVIDE";
  }

  if (
    hasAny(text, [
      "place value of each digit in a four-digit number",
      "identify, represent and estimate numbers",
      "different representations",
    ])
  ) {
    return "Y4_PLACE_VALUE_4_DIGIT";
  }

  if (hasAny(text, ["find 1,000 more or less"])) {
    return "Y4_THOUSAND_MORE_LESS";
  }

  if (hasAny(text, ["round any number to the nearest 10, 100 or 1,000"])) {
    return "Y4_ROUNDING";
  }

  if (hasAny(text, ["order and compare numbers beyond 1,000"])) {
    return "Y4_COMPARE_1000";
  }

  if (
    hasAny(text, [
      "add and subtract numbers with up to 4 digits",
      "addition and subtraction two-step problems",
      "inverse operations to check answers",
      "column addition and subtraction with 4-digit numbers",
      "apply to addition and subtraction: multiples of 100",
      "secure-place-value-to-1000-apply-to-addition-and-subtraction-multiples-of-100",
    ])
  ) {
    return "Y4_ADD_SUBTRACT_4_DIGIT";
  }

  if (
    hasAny(text, [
      "multiplied or divided by 10 and 100",
      "multiplied or divided by 10",
      "multiplied or divided by 100",
    ])
  ) {
    return "Y4_MULTIPLY_DIVIDE_10_100";
  }

  if (
    hasAny(text, [
      "equivalent fractions",
      "families of common equivalent fractions",
    ])
  ) {
    return "Y4_EQUIVALENT_FRACTIONS";
  }

  if (hasAny(text, ["add and subtract fractions with the same denominator"])) {
    return "Y4_FRACTIONS_SAME_DENOMINATOR";
  }

  if (
    hasAny(text, [
      "fractions to calculate quantities",
      "fractions to divide quantities",
      "non-unit fractions",
    ])
  ) {
    return "Y4_FRACTION_OF_QUANTITY";
  }

  if (
    hasAny(text, [
      "describe positions on a 2-d grid as coordinates in the first quadrant",
      "describe movements between positions as translations",
      "plot specified points",
      "coordinates in the first quadrant",
      "oak:maths:ks2:coordinates:",
      " coordinates ",
    ])
  ) {
    return "Y4_COORDINATES";
  }

  if (
    hasAny(text, [
      "measure and calculate the perimeter of a rectilinear figure",
      "perimeter of a rectilinear figure",
    ])
  ) {
    return "Y4_PERIMETER";
  }

  if (
    hasAny(text, [
      "identify lines of symmetry",
      "complete a simple symmetric figure",
      "lines of symmetry",
      "symmetry-in-2d-shapes",
      "properties of 2d and 3d shapes and symmetry",
    ])
  ) {
    return "Y4_SYMMETRY";
  }

  if (
    hasAny(text, [
      "convert time between analogue and digital 12- and 24-hour clocks",
      "12- and 24-hour clocks",
      "12 and 24-hour clocks",
    ])
  ) {
    return "Y4_TIME_24_HOUR";
  }

  if (
    hasAny(text, [
      "convert between different units of measure",
      "hours to minutes",
      "minutes to seconds",
      "years to months",
      "weeks to days",
    ])
  ) {
    return "Y4_UNIT_CONVERSION";
  }

  if (
    hasAny(text, [
      "bar charts",
      "pictograms",
      "tables and other graphs",
      "time graphs",
      "interpret and present discrete and continuous data",
      "solve comparison, sum and difference problems using information presented",
    ])
  ) {
    return "Y4_DATA_INTERPRETATION";
  }

  if (
    hasAny(text, [
      "money in pounds and pence",
      "money problems involving fractions and decimals to 2 decimal places",
    ])
  ) {
    return "Y4_MONEY";
  }

  return null;
}

function classifySecondaryMathsDirectGenerator(
  objective: ObjectiveLike
): string | null {
  if (objective.subject !== "MATHS") return null;
  if (![7, 8, 9, 10, 11].includes(objective.yearGroup ?? -1)) return null;

  const text = normaliseObjectiveText(objective);
  const code = normalise(objective.code).toLowerCase();

  if (
    code ===
    "oak:maths:ks3:geometrical-properties-polygons:e23f6b0249fd85bb211822d53c026091fc03e24d"
  ) {
    return "SCALE_DRAWINGS_FOUNDATION";
  }

  if (
    code ===
    "oak:maths:ks4:algebraic-manipulation:f52e1bc374ca91c238cf07b7bd1121a36f283409"
  ) {
    return "SOLVE_QUADRATIC_FOUNDATION";
  }

  if (
    code ===
    "oak:maths:ks4:inequalities:a1c65100282e20b6f2b2c313fdec8fdf73b99703"
  ) {
    return "SOLVE_INEQUALITY_FOUNDATION";
  }

  if (
    code ===
      "oak:maths:ks3:sequences:032d60bb5f2e31b63e5745f31838a9fb526e7106" ||
    code ===
      "oak:maths:ks3:expressions-and-equations:10564bd0f94bb64de5f9f59be425433a47cea65e"
  ) {
    return null;
  }

  if (objective.yearGroup === 11) {
    if (code.includes("conditional-probability")) {
      return "PROBABILITY_FOUNDATION";
    }
    if (code.includes("direct-and-inverse-proportion")) {
      return "RATIO_SCALE";
    }
    if (code.includes("further-sequences:84cac314bad82f488f964e17519933affd724bc2")) {
      return "PERCENTAGE_CHANGE_FOUNDATION";
    }
    if (
      code.includes("further-sequences:bd81efb41ec6ec7cc0a17b65237079e31ba039fe") ||
      code.includes("further-sequences:c3b68f71202c970152cf16f50e8e1aa3b5a7cb96")
    ) {
      return "LINEAR_SEQUENCE_TERM";
    }
    if (code.includes("graphical-representations-of-data-cumulative-frequency-and-histograms")) {
      return "MEAN_MEDIAN_MODE_RANGE";
    }
    if (code.includes("2d-and-3d-shape-surface-area-and-volume-pyramids-spheres-and-cones")) {
      return "AREA_PERIMETER_FOUNDATION";
    }
    if (code.includes("algebraic-fractions:449df9fa17a06d0c79c57def5d69558387c4f942")) {
      return "FRACTION_OPERATIONS_FOUNDATION";
    }
    if (code.includes("iteration:f7f3ef5f0ee48c4517bab52d931b51fa5baff0b0")) {
      return null;
    }
    if (code.includes("non-right-angled-trigonometry:49811d1ee45816f5b54a97f73ddf05976144e494")) {
      return null;
    }
  }

  if (
    hasAny(text, [
      "numerical summaries of data",
      "observed distributions of a single variable",
      "measures of central tendency",
      "mean, mode, median",
      "spread (range",
      "outliers",
    ])
    || hasWholeWord(text, ["mean", "median", "mode", "range", "average", "outliers"])
  ) {
    return "MEAN_MEDIAN_MODE_RANGE";
  }

  if (
    hasAny(text, [
      "graphical representations of data",
      "frequency tables",
      "bar charts",
      "pie charts",
      "pictograms",
      "charts, and diagrams",
      "grouped numerical data",
      "construct and interpret appropriate tables",
    ])
  ) {
    return null;
  }

  if (hasAny(text, ["substitute", "substitution"])) {
    return "SUBSTITUTE_INTO_EXPRESSION";
  }

  if (hasAny(text, ["expand", "expanding", "single bracket", "brackets"])) {
    return "EXPAND_SINGLE_BRACKET";
  }

  if (
    hasAny(text, [
      "simplify expressions",
      "collect like terms",
      "like terms",
      "simplify algebra",
    ])
  ) {
    return "SIMPLIFY_EXPRESSION";
  }

  if (hasAny(text, ["solve two-step", "solve equations with two", "2-step", "two-step equations"])) {
    return "SOLVE_LINEAR_TWO_STEP";
  }

  if (
    hasAny(text, [
      "one-step equations",
      "solve one-step",
      "find the unknown",
      "find the value of the unknown",
    ]) ||
    (hasWholeWord(text, ["equation", "equations", "unknown"]) &&
      hasWholeWord(text, ["solve", "solving"]))
  ) {
    return "SOLVE_LINEAR_ONE_STEP";
  }

  if (
    hasAny(text, ["sequence", "nth term", "term-to-term", "linear sequence"])
  ) {
    return "LINEAR_SEQUENCE_TERM";
  }

  if (hasAny(text, ["decimal", "place value", "rounding decimal"])) {
    return "DECIMAL_OPERATIONS_FOUNDATION";
  }

  if (hasAny(text, ["fraction", "fractions"])) {
    return "FRACTION_OPERATIONS_FOUNDATION";
  }

  if (
    hasAny(text, [
      "percentage increase",
      "percentage decrease",
      "percentage change",
    ])
  ) {
    return "PERCENTAGE_CHANGE_FOUNDATION";
  }

  if (hasAny(text, ["percentage", "percentages"])) {
    return "PERCENTAGE_OF_AMOUNT";
  }

  if (hasAny(text, ["ratio", "share in a ratio", "divide in a ratio"])) {
    return "RATIO_SHARE";
  }

  if (
    hasAny(text, [
      "proportion",
      "scale",
      "scale factor",
      "recipe",
      "best value",
    ])
  ) {
    return "RATIO_SCALE";
  }

  if (hasAny(text, ["pythagoras", "pythagorean"])) {
    return "PYTHAGORAS_FOUNDATION";
  }

  if (hasAny(text, ["circle", "circumference", "area of a circle"])) {
    return "CIRCUMFERENCE_AREA_CIRCLE_FOUNDATION";
  }

  if (
    hasAny(text, [
      "area",
      "perimeter",
      "triangle area",
      "parallelogram",
    ])
  ) {
    return "AREA_PERIMETER_FOUNDATION";
  }

  if (
    hasAny(text, [
      "angle",
      "angles",
      "straight line",
      "around a point",
      "vertically opposite",
      "isosceles",
    ])
  ) {
    return "ANGLE_FACTS_FOUNDATION";
  }

  if (hasWholeWord(text, ["probability", "chance"])) {
    return "PROBABILITY_FOUNDATION";
  }

  if (hasAny(text, ["number", "negative", "integer", "decimal", "place value"])) {
    return "DECIMAL_OPERATIONS_FOUNDATION";
  }

  return null;
}

export function getProfileForObjective(
  objective: ObjectiveLike | string
): CanonicalProfile | null {
  const ks1Profile = getKs1ProfileForObjective(objective);
  if (ks1Profile) {
    return ks1Profile as CanonicalProfile;
  }

  if (typeof objective === "string") {
    return null;
  }

  const year3DirectGenerator = classifyYear3MathsDirectGenerator(objective);
  if (year3DirectGenerator) {
    return buildDirectProfile(
      `ks2_y3_${year3DirectGenerator.toLowerCase()}`,
      year3DirectGenerator
    );
  }

  const year4DirectGenerator = classifyYear4MathsDirectGenerator(objective);
  if (year4DirectGenerator) {
    return buildDirectProfile(
      `ks2_y4_${year4DirectGenerator.toLowerCase()}`,
      year4DirectGenerator
    );
  }

  const secondaryDirectGenerator = classifySecondaryMathsDirectGenerator(objective);
  if (secondaryDirectGenerator) {
    return buildDirectProfile(
      `secondary_${secondaryDirectGenerator.toLowerCase()}`,
      secondaryDirectGenerator
    );
  }

  return null;
}
