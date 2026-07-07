import "dotenv/config";
import { Subject, type CanonicalOperator } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";

type CorrectnessFinding = {
  questionId: string;
  objectiveCode: string;
  objectiveTitle: string;
  yearGroup: number | null;
  itemType: string;
  difficulty: string;
  promptText: string;
  answerText: string;
  issue:
    | "BLANK_PROMPT"
    | "BLANK_ANSWER"
    | "STRUCTURED_VALUE_MISSING"
    | "STRUCTURED_ARITHMETIC_MISMATCH"
    | "ANSWER_RHS_MISMATCH"
    | "EQUATION_STRING_MISMATCH"
    | "COMPARISON_RESULT_MISMATCH"
    | "PROMPT_ANSWER_MISMATCH"
    | "UNVERIFIED_PATTERN";
  details: string;
};

type AuditRow = {
  id: string;
  itemType: string;
  operator: CanonicalOperator | null;
  lhsA: number | null;
  lhsB: number | null;
  rhs: number | null;
  equation: string | null;
  promptText: string;
  answerText: string;
  difficulty: string;
  objective: {
    code: string;
    title: string;
    yearGroup: number | null;
    subject: Subject;
  };
};

function normalize(value: string | null | undefined): string {
  return String(value ?? "").trim().toLowerCase();
}

function formatOperator(operator: CanonicalOperator): string {
  switch (operator) {
    case "ADD":
      return "+";
    case "SUBTRACT":
      return "-";
    case "MULTIPLY":
      return "x";
    case "DIVIDE":
      return "÷";
    case "EQUALS":
      return "=";
    default:
      return "?";
  }
}

function evaluate(operator: CanonicalOperator, lhsA: number, lhsB: number): number | null {
  switch (operator) {
    case "ADD":
      return lhsA + lhsB;
    case "SUBTRACT":
      return lhsA - lhsB;
    case "MULTIPLY":
      return lhsA * lhsB;
    case "DIVIDE":
      return lhsB === 0 ? null : lhsA / lhsB;
    case "EQUALS":
      return rhsLikeEquals(lhsA, lhsB);
    default:
      return null;
  }
}

function rhsLikeEquals(lhsA: number, lhsB: number): number {
  return lhsB;
}

function extractLeadingNumber(answerText: string): number | null {
  const match = answerText.trim().match(/^-?\d[\d,]*(?:\.\d+)?/);
  if (!match) return null;
  const value = Number(match[0].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function extractTrailingNumber(answerText: string): number | null {
  const match = answerText.trim().match(/(-?\d[\d,]*(?:\.\d+)?)\s*$/);
  if (!match) return null;
  const value = Number(match[1].replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

function buildExpectedEquation(row: AuditRow): string | null {
  if (
    row.operator == null ||
    row.lhsA == null ||
    row.lhsB == null ||
    row.rhs == null
  ) {
    return null;
  }

  return `${row.lhsA} ${formatOperator(row.operator)} ${row.lhsB} = ${row.rhs}`;
}

function compareSymbols(lhsA: number, lhsB: number): string {
  if (lhsA < lhsB) return "<";
  if (lhsA > lhsB) return ">";
  return "=";
}

function normalizeAnswer(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[£]/g, "£")
    .replace(/[×]/g, "x");
}

function gcd(a: number, b: number): number {
  let x = Math.abs(a);
  let y = Math.abs(b);
  while (y !== 0) {
    const t = y;
    y = x % y;
    x = t;
  }
  return x || 1;
}

function parseFractionValue(value: string): { num: number; den: number } | null {
  const match = value.trim().match(/^(-?\d+)\/(-?\d+)$/);
  if (!match) return null;
  const num = Number(match[1]);
  const den = Number(match[2]);
  if (!Number.isFinite(num) || !Number.isFinite(den) || den === 0) return null;
  const divisor = gcd(num, den);
  const normalizedDen = den < 0 ? -den / divisor : den / divisor;
  const normalizedNum = den < 0 ? -num / divisor : num / divisor;
  return { num: normalizedNum, den: normalizedDen };
}

function formatFraction(num: number, den: number): string {
  const divisor = gcd(num, den);
  const normalizedDen = den < 0 ? -den / divisor : den / divisor;
  const normalizedNum = den < 0 ? -num / divisor : num / divisor;
  if (normalizedDen === 1) return String(normalizedNum);
  return `${normalizedNum}/${normalizedDen}`;
}

function parseNumberList(text: string): number[] {
  const matches = text.match(/-?\d[\d,]*(?:\.\d+)?/g) ?? [];
  return matches
    .map((value) => Number(value.replace(/,/g, "")))
    .filter((value) => Number.isFinite(value));
}

function formatNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : String(Number(value.toFixed(2)));
}

function formatWithUnit(value: number, unit: string | null): string {
  const base = formatNumber(value);
  return unit ? `${base}${unit}` : base;
}

function inferUnitFromPrompt(prompt: string): string | null {
  const squareMatch = prompt.match(/(?:\d+(?:\.\d+)?\s*)?(cm|mm|m|km)\b²/i);
  if (squareMatch) return `${squareMatch[1].toLowerCase()}²`;

  const linearMatch = prompt.match(/(?:\d+(?:\.\d+)?\s*)?(cm|mm|m|km)\b/i);
  if (linearMatch) return linearMatch[1].toLowerCase();

  if (prompt.includes("£")) return "£";
  return null;
}

function compareExpectedToAnswer(expected: string, answerText: string): boolean {
  const expectedNorm = normalizeAnswer(expected);
  const answerNorm = normalizeAnswer(answerText);
  if (expectedNorm === answerNorm) return true;

  const expectedNumber = extractLeadingNumber(expected);
  const answerNumber = extractLeadingNumber(answerText);
  if (
    expectedNumber != null &&
    answerNumber != null &&
    Math.abs(expectedNumber - answerNumber) < 0.000001
  ) {
    return true;
  }

  const expectedFraction = parseFractionValue(expected);
  const answerFraction = parseFractionValue(answerText);
  if (expectedFraction && answerFraction) {
    return (
      expectedFraction.num === answerFraction.num &&
      expectedFraction.den === answerFraction.den
    );
  }

  const expectedTrailingNumber = extractTrailingNumber(expected);
  if (
    expectedTrailingNumber != null &&
    answerNumber != null &&
    Math.abs(expectedTrailingNumber - answerNumber) < 0.000001
  ) {
    return true;
  }

  const expectedNumbers = parseNumberList(expected);
  const answerNumbers = parseNumberList(answerText);
  if (
    expectedNumbers.length > 0 &&
    answerNumbers.length > 0 &&
    expectedNumbers.length === answerNumbers.length &&
    expectedNumbers.every((value, index) => Math.abs(value - answerNumbers[index]) < 0.000001)
  ) {
    return true;
  }

  if (
    expectedNumbers.length === 1 &&
    answerNumbers.length === 1 &&
    Math.abs(expectedNumbers[0] - answerNumbers[0]) < 0.051
  ) {
    return true;
  }

  return false;
}

function deriveExpectedAnswerFromPrompt(row: AuditRow): {
  expectedAnswer: string | null;
  rule: string | null;
} {
  const prompt = row.promptText.trim();
  const normalized = prompt.toLowerCase().replace(/[×]/g, "x");
  const unit = inferUnitFromPrompt(prompt);

  const fractionOfQuantityMatch = normalized.match(
    /^calculate:?\s+(\d+)\/(\d+)\s+of\s+(-?\d+(?:\.\d+)?)/i
  );
  if (fractionOfQuantityMatch) {
    const num = Number(fractionOfQuantityMatch[1]);
    const den = Number(fractionOfQuantityMatch[2]);
    const quantity = Number(fractionOfQuantityMatch[3]);
    return {
      expectedAnswer: formatNumber((num / den) * quantity),
      rule: "FRACTION_OF_QUANTITY",
    };
  }

  const fractionArithmeticMatch = normalized.match(
    /^calculate:?\s+(\d+)\/(\d+)\s*([+\-])\s*(\d+)\/(\d+)/i
  );
  if (fractionArithmeticMatch) {
    const aNum = Number(fractionArithmeticMatch[1]);
    const aDen = Number(fractionArithmeticMatch[2]);
    const op = fractionArithmeticMatch[3];
    const bNum = Number(fractionArithmeticMatch[4]);
    const bDen = Number(fractionArithmeticMatch[5]);
    const commonDen = aDen * bDen;
    const left = aNum * bDen;
    const right = bNum * aDen;
    const outNum = op === "+" ? left + right : left - right;
    return {
      expectedAnswer: formatFraction(outNum, commonDen),
      rule: "FRACTION_ARITHMETIC",
    };
  }

  const fractionMultiplyMatch = normalized.match(
    /^calculate:?\s+(\d+)\/(\d+)\s*[x*]\s*(-?\d+(?:\.\d+)?)/i
  );
  if (fractionMultiplyMatch) {
    const num = Number(fractionMultiplyMatch[1]);
    const den = Number(fractionMultiplyMatch[2]);
    const multiplier = Number(fractionMultiplyMatch[3]);
    return {
      expectedAnswer: formatNumber((num / den) * multiplier),
      rule: "FRACTION_MULTIPLY_NUMBER",
    };
  }

  const multiplyChainMatch = normalized.match(
    /^calculate:?\s+(-?\d+(?:\.\d+)?)(?:\s*[x*]\s*(-?\d+(?:\.\d+)?))+\.?$/i
  );
  if (multiplyChainMatch) {
    const values = parseNumberList(normalized);
    if (values.length >= 2) {
      return {
        expectedAnswer: formatNumber(values.reduce((product, value) => product * value, 1)),
        rule: "MULTIPLICATION_CHAIN",
      };
    }
  }

  const calcMatch = normalized.match(
    /^calculate:?\s+(-?\d+(?:\.\d+)?)\s*(x|\*|÷|\/|\+|-)\s*(-?\d+(?:\.\d+)?)/i
  );
  if (calcMatch) {
    const lhs = Number(calcMatch[1]);
    const rhs = Number(calcMatch[3]);
    const op = calcMatch[2];
    const value =
      op === "x" || op === "*"
        ? lhs * rhs
        : op === "÷" || op === "/"
        ? lhs / rhs
        : op === "+"
        ? lhs + rhs
        : lhs - rhs;
    return { expectedAnswer: formatNumber(value), rule: "CALCULATE_EXPRESSION" };
  }

  if (normalized.includes("angles on a straight line add up to")) {
    return { expectedAnswer: "180", rule: "STRAIGHT_LINE_ANGLES" };
  }

  const meanListMatch = normalized.match(/^find the mean of (.+)$/i);
  if (meanListMatch) {
    const values = parseNumberList(meanListMatch[1]);
    if (values.length > 0) {
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      return { expectedAnswer: formatNumber(mean), rule: "MEAN_LIST" };
    }
  }

  const modeListMatch = normalized.match(/^find the mode of (.+)$/i);
  if (modeListMatch) {
    const values = parseNumberList(modeListMatch[1]);
    if (values.length > 0) {
      const counts = new Map<number, number>();
      for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
      const mode = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0] - b[0])[0]?.[0];
      if (mode != null) {
        return { expectedAnswer: formatNumber(mode), rule: "MODE_LIST" };
      }
    }
  }

  const rangeListMatch = normalized.match(/^find the range of (.+)$/i);
  if (rangeListMatch) {
    const values = parseNumberList(rangeListMatch[1]);
    if (values.length > 0) {
      const range = Math.max(...values) - Math.min(...values);
      return { expectedAnswer: formatNumber(range), rule: "RANGE_LIST" };
    }
  }

  const medianListMatch = normalized.match(/^find the median of (.+)$/i);
  if (medianListMatch) {
    const values = parseNumberList(medianListMatch[1]).sort((a, b) => a - b);
    if (values.length > 0) {
      const middle = Math.floor(values.length / 2);
      const median =
        values.length % 2 === 1
          ? values[middle]
          : (values[middle - 1] + values[middle]) / 2;
      return { expectedAnswer: formatNumber(median), rule: "MEDIAN_LIST" };
    }
  }

  const meanTotalMatch = normalized.match(
    /^the mean of (\w+) numbers is (-?\d+(?:\.\d+)?).*total/i
  );
  if (meanTotalMatch) {
    const countWord = meanTotalMatch[1];
    const countMap: Record<string, number> = {
      two: 2,
      three: 3,
      four: 4,
      five: 5,
      six: 6,
      seven: 7,
      eight: 8,
      nine: 9,
      ten: 10,
    };
    const count = countMap[countWord] ?? Number(countWord);
    const mean = Number(meanTotalMatch[2]);
    if (Number.isFinite(count) && Number.isFinite(mean)) {
      return {
        expectedAnswer: formatNumber(count * mean),
        rule: "MEAN_TOTAL",
      };
    }
  }

  const ratioThreeMatch = normalized.match(/split\s*£?(\d+(?:\.\d+)?)\s+in the ratio\s+(\d+)\s*:\s*(\d+)\s*:\s*(\d+)/i);
  if (ratioThreeMatch) {
    const total = Number(ratioThreeMatch[1]);
    const a = Number(ratioThreeMatch[2]);
    const b = Number(ratioThreeMatch[3]);
    const c = Number(ratioThreeMatch[4]);
    const parts = a + b + c;
    const prefix = prompt.includes("£") ? "£" : "";
    return {
      expectedAnswer: `${prefix}${formatNumber((total * a) / parts)}, ${prefix}${formatNumber((total * b) / parts)}, ${prefix}${formatNumber((total * c) / parts)}`,
      rule: "RATIO_SPLIT_THREE",
    };
  }

  const ratioMatch = normalized.match(/split\s*£?(\d+(?:\.\d+)?)\s+in the ratio\s+(\d+)\s*:\s*(\d+)/i);
  if (ratioMatch) {
    const total = Number(ratioMatch[1]);
    const a = Number(ratioMatch[2]);
    const b = Number(ratioMatch[3]);
    const first = (total * a) / (a + b);
    const second = (total * b) / (a + b);
    const prefix = prompt.includes("£") ? "£" : "";
    return {
      expectedAnswer: `${prefix}${formatNumber(first)} and ${prefix}${formatNumber(second)}`,
      rule: "RATIO_SPLIT",
    };
  }

  const diffNamedMatch =
    normalized.match(/how many more .* chose ([a-z ]+) than ([a-z ]+)\??$/i) ||
    normalized.match(/what is the difference between ([a-z ]+) and ([a-z ]+)\??$/i) ||
    normalized.match(/how many more .* read than ([a-z ]+)\??$/i);
  if (diffNamedMatch && prompt.includes(":")) {
    const listPart = prompt.split(":").slice(1).join(":");
    const pairMatches = Array.from(listPart.matchAll(/([A-Za-z][A-Za-z ]*?)\s+(\d+(?:\.\d+)?)/g));
    const values = new Map<string, number>();
    for (const match of pairMatches) {
      values.set(match[1].trim().toLowerCase(), Number(match[2]));
    }
    const targetA = diffNamedMatch[1]?.trim().toLowerCase();
    const targetB = diffNamedMatch[2]?.trim().toLowerCase();
    if (targetA && targetB && values.has(targetA) && values.has(targetB)) {
      const diff = Math.abs((values.get(targetA) ?? 0) - (values.get(targetB) ?? 0));
      return { expectedAnswer: formatNumber(diff), rule: "NAMED_DIFFERENCE" };
    }
  }

  if (
    normalized.includes("how many more") ||
    normalized.includes("difference between")
  ) {
    const values = parseNumberList(prompt);
    if (values.length >= 2) {
      const diff = Math.abs(values[0] - values[1]);
      return { expectedAnswer: formatNumber(diff), rule: "GENERIC_DIFFERENCE" };
    }
  }

  const rectAreaMatch =
    normalized.match(/area of a rectangle with length (\d+(?:\.\d+)?)\w* and width (\d+(?:\.\d+)?)/i) ||
    normalized.match(/area of a rectangle (\d+(?:\.\d+)?)\w* by (\d+(?:\.\d+)?)/i);
  if (rectAreaMatch) {
    const a = Number(rectAreaMatch[1]);
    const b = Number(rectAreaMatch[2]);
    return {
      expectedAnswer: formatWithUnit(a * b, unit ? `${unit}²`.replace("²²", "²") : unit),
      rule: "RECTANGLE_AREA",
    };
  }

  const rectPerimeterMatch = normalized.match(/perimeter of a rectangle (\d+(?:\.\d+)?)\w* by (\d+(?:\.\d+)?)/i);
  if (rectPerimeterMatch) {
    const a = Number(rectPerimeterMatch[1]);
    const b = Number(rectPerimeterMatch[2]);
    return {
      expectedAnswer: formatWithUnit(2 * (a + b), unit),
      rule: "RECTANGLE_PERIMETER",
    };
  }

  const squarePerimeterMatch = normalized.match(/perimeter of a square with side (\d+(?:\.\d+)?)/i);
  if (squarePerimeterMatch) {
    const side = Number(squarePerimeterMatch[1]);
    return {
      expectedAnswer: formatWithUnit(side * 4, unit),
      rule: "SQUARE_PERIMETER",
    };
  }

  const triangleAreaMatch = normalized.match(/area of a triangle with base (\d+(?:\.\d+)?)\w* and height (\d+(?:\.\d+)?)/i);
  if (triangleAreaMatch) {
    const base = Number(triangleAreaMatch[1]);
    const height = Number(triangleAreaMatch[2]);
    return {
      expectedAnswer: formatWithUnit((base * height) / 2, unit ? `${unit}²`.replace("²²", "²") : unit),
      rule: "TRIANGLE_AREA",
    };
  }

  const parallelogramAreaMatch = normalized.match(/area of a parallelogram with base (\d+(?:\.\d+)?)\w* and height (\d+(?:\.\d+)?)/i);
  if (parallelogramAreaMatch) {
    const base = Number(parallelogramAreaMatch[1]);
    const height = Number(parallelogramAreaMatch[2]);
    return {
      expectedAnswer: formatWithUnit(base * height, unit ? `${unit}²`.replace("²²", "²") : unit),
      rule: "PARALLELOGRAM_AREA",
    };
  }

  const areaWidthFindLengthMatch = normalized.match(/area (\d+(?:\.\d+)?)\w*²? and width (\d+(?:\.\d+)?)\w*.*find the length/i);
  if (areaWidthFindLengthMatch) {
    const area = Number(areaWidthFindLengthMatch[1]);
    const width = Number(areaWidthFindLengthMatch[2]);
    return {
      expectedAnswer: formatWithUnit(area / width, unit),
      rule: "RECTANGLE_LENGTH_FROM_AREA",
    };
  }

  const squarePerimeterFindSideMatch = normalized.match(/square has perimeter (\d+(?:\.\d+)?)\w*.*side length/i);
  if (squarePerimeterFindSideMatch) {
    const perimeter = Number(squarePerimeterFindSideMatch[1]);
    return {
      expectedAnswer: formatWithUnit(perimeter / 4, unit),
      rule: "SQUARE_SIDE_FROM_PERIMETER",
    };
  }

  const radiusFromDiameterMatch = normalized.match(/diameter (\d+(?:\.\d+)?)\w*.*find the radius/i);
  if (radiusFromDiameterMatch) {
    const diameter = Number(radiusFromDiameterMatch[1]);
    return {
      expectedAnswer: formatWithUnit(diameter / 2, unit),
      rule: "RADIUS_FROM_DIAMETER",
    };
  }

  const circumferenceRadiusMatch = normalized.match(/circumference of a circle with radius (\d+(?:\.\d+)?)/i);
  if (circumferenceRadiusMatch) {
    const radius = Number(circumferenceRadiusMatch[1]);
    return {
      expectedAnswer: formatWithUnit(2 * 3.14 * radius, unit),
      rule: "CIRCUMFERENCE_FROM_RADIUS",
    };
  }

  const circumferenceDiameterMatch = normalized.match(/circumference of a circle with diameter (\d+(?:\.\d+)?)/i);
  if (circumferenceDiameterMatch) {
    const diameter = Number(circumferenceDiameterMatch[1]);
    return {
      expectedAnswer: formatWithUnit(3.14 * diameter, unit),
      rule: "CIRCUMFERENCE_FROM_DIAMETER",
    };
  }

  const circleAreaRadiusMatch = normalized.match(/area of a circle with radius (\d+(?:\.\d+)?)/i);
  if (circleAreaRadiusMatch) {
    const radius = Number(circleAreaRadiusMatch[1]);
    return {
      expectedAnswer: formatWithUnit(3.14 * radius * radius, unit ? `${unit}²`.replace("²²", "²") : unit),
      rule: "CIRCLE_AREA_FROM_RADIUS",
    };
  }

  const circleAreaDiameterMatch = normalized.match(/area of a circle with diameter (\d+(?:\.\d+)?)/i);
  if (circleAreaDiameterMatch) {
    const diameter = Number(circleAreaDiameterMatch[1]);
    const radius = diameter / 2;
    return {
      expectedAnswer: formatWithUnit(3.14 * radius * radius, unit ? `${unit}²`.replace("²²", "²") : unit),
      rule: "CIRCLE_AREA_FROM_DIAMETER",
    };
  }

  const scaleMatch = normalized.match(/scale\s+1cm\s*:\s*(\d+)cm.*line is (\d+)cm .*real length/i);
  if (scaleMatch) {
    const scale = Number(scaleMatch[1]);
    const length = Number(scaleMatch[2]);
    return {
      expectedAnswer: `${formatNumber(scale * length)}cm`,
      rule: "SCALE_LENGTH",
    };
  }

  const secondsInMinutesMatch = normalized.match(/how many seconds are in (\d+) minute/);
  if (secondsInMinutesMatch) {
    return {
      expectedAnswer: formatNumber(Number(secondsInMinutesMatch[1]) * 60),
      rule: "SECONDS_IN_MINUTES",
    };
  }

  const minutesInHoursMatch = normalized.match(/how many minutes are in (\d+) hour/);
  if (minutesInHoursMatch) {
    return {
      expectedAnswer: formatNumber(Number(minutesInHoursMatch[1]) * 60),
      rule: "MINUTES_IN_HOURS",
    };
  }

  if (normalized.includes("how many days are in april")) {
    return { expectedAnswer: "30", rule: "DAYS_IN_APRIL" };
  }

  if (normalized.includes("angles in a triangle add up to")) {
    return { expectedAnswer: "180", rule: "TRIANGLE_ANGLES" };
  }

  if (normalized.includes("angles around a point add up to")) {
    return { expectedAnswer: "360", rule: "ANGLES_AROUND_POINT" };
  }

  if (normalized.includes("in a quadrilateral, angles add up to")) {
    return { expectedAnswer: "360", rule: "QUADRILATERAL_ANGLES" };
  }

  const verticallyOppositeMatch = normalized.match(/vertically opposite angles .* if one is (\d+(?:\.\d+)?)°?, what is the other/i);
  if (verticallyOppositeMatch) {
    return { expectedAnswer: formatNumber(Number(verticallyOppositeMatch[1])), rule: "VERTICALLY_OPPOSITE" };
  }

  const isoscelesTopAngleMatch = normalized.match(/isosceles triangle has one angle of (\d+(?:\.\d+)?)°?.*base angle/i);
  if (isoscelesTopAngleMatch) {
    const top = Number(isoscelesTopAngleMatch[1]);
    return { expectedAnswer: formatNumber((180 - top) / 2), rule: "ISOSCELES_BASE_ANGLE" };
  }

  const durationMatch = normalized.match(/starts at (\d{1,2}):(\d{2})(?:\s?(am|pm))?.*lasts (\d+) minutes.*what time does it end/i);
  if (durationMatch) {
    let hour = Number(durationMatch[1]);
    let minute = Number(durationMatch[2]);
    const suffix = durationMatch[3] ?? "";
    const add = Number(durationMatch[4]);
    minute += add;
    hour += Math.floor(minute / 60);
    minute %= 60;
    if (suffix) {
      const normalizedHour = ((hour - 1) % 12) + 1;
      return {
        expectedAnswer: `${normalizedHour}:${String(minute).padStart(2, "0")} ${suffix}`,
        rule: "END_TIME_FROM_DURATION",
      };
    }
    return {
      expectedAnswer: `${hour}:${String(minute).padStart(2, "0")}`,
      rule: "END_TIME_FROM_DURATION",
    };
  }

  const clock12Match = normalized.match(/write (\d{1,2}):(\d{2}) on a 12-hour clock/i);
  if (clock12Match) {
    const hour24 = Number(clock12Match[1]);
    const minute = Number(clock12Match[2]);
    const suffix = hour24 >= 12 ? "pm" : "am";
    const hour12 = ((hour24 + 11) % 12) + 1;
    return {
      expectedAnswer: `${hour12}:${String(minute).padStart(2, "0")} ${suffix}`,
      rule: "CONVERT_24_TO_12",
    };
  }

  if (normalized.includes("write 12:00 midnight using am or pm")) {
    return { expectedAnswer: "12:00 am", rule: "MIDNIGHT_AM_PM" };
  }

  const lessonDurationMatch = normalized.match(/starts at (\d{1,2}):(\d{2}).*ends at (\d{1,2}):(\d{2}).*how long .* minutes/i);
  if (lessonDurationMatch) {
    const start = Number(lessonDurationMatch[1]) * 60 + Number(lessonDurationMatch[2]);
    const end = Number(lessonDurationMatch[3]) * 60 + Number(lessonDurationMatch[4]);
    return {
      expectedAnswer: formatNumber(end - start),
      rule: "DURATION_IN_MINUTES",
    };
  }

  const simpleFindXMatch = normalized.match(/^find ([a-z]):\s*(.+)=\s*(-?\d+(?:\.\d+)?)/i);
  if (simpleFindXMatch) {
    const variable = simpleFindXMatch[1];
    const lhs = simpleFindXMatch[2].trim();
    const rhs = Number(simpleFindXMatch[3]);
    const escapedVar = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const plusRight = new RegExp(`^${escapedVar}\\s*\\+\\s*(-?\\d+(?:\\.\\d+)?)$`, "i");
    const minusRight = new RegExp(`^${escapedVar}\\s*-\\s*(-?\\d+(?:\\.\\d+)?)$`, "i");
    const plusLeft = new RegExp(`^(-?\\d+(?:\\.\\d+)?)\\s*\\+\\s*${escapedVar}$`, "i");
    const coeffOnly = new RegExp(`^(-?\\d*(?:\\.\\d+)?)${escapedVar}$`, "i");
    const divideOnly = new RegExp(`^${escapedVar}\\s*(?:÷|/)\\s*(-?\\d+(?:\\.\\d+)?)$`, "i");
    const addMulti = new RegExp(`^(-?\\d+(?:\\.\\d+)?)\\s*\\+\\s*(-?\\d+(?:\\.\\d+)?)\\s*\\+\\s*${escapedVar}$`, "i");

    if (plusRight.test(lhs)) {
      const add = Number(lhs.match(plusRight)?.[1]);
      return { expectedAnswer: formatNumber(rhs - add), rule: "SOLVE_VAR_PLUS" };
    }
    if (minusRight.test(lhs)) {
      const sub = Number(lhs.match(minusRight)?.[1]);
      return { expectedAnswer: formatNumber(rhs + sub), rule: "SOLVE_VAR_MINUS" };
    }
    if (plusLeft.test(lhs)) {
      const add = Number(lhs.match(plusLeft)?.[1]);
      return { expectedAnswer: formatNumber(rhs - add), rule: "SOLVE_VAR_PLUS" };
    }
    if (coeffOnly.test(lhs)) {
      const coeff = Number(lhs.match(coeffOnly)?.[1]);
      return { expectedAnswer: formatNumber(rhs / coeff), rule: "SOLVE_COEFFICIENT_VAR" };
    }
    if (divideOnly.test(lhs)) {
      const divisor = Number(lhs.match(divideOnly)?.[1]);
      return { expectedAnswer: formatNumber(rhs * divisor), rule: "SOLVE_DIVISION_VARIABLE" };
    }
    if (addMulti.test(lhs)) {
      const parts = Array.from(lhs.matchAll(/-?\d+(?:\.\d+)?/g)).map((m) => Number(m[0]));
      return {
        expectedAnswer: formatNumber(rhs - parts.reduce((sum, value) => sum + value, 0)),
        rule: "SOLVE_VAR_ADD_MULTI",
      };
    }
  }

  if (normalized.startsWith("substitute ")) {
    const squarePlusCoeff = normalized.match(/^substitute ([a-z]) = (-?\d+(?:\.\d+)?) into ([a-z])²\s*([+\-])\s*(\d+)([a-z])$/i);
    if (squarePlusCoeff) {
      const variable = squarePlusCoeff[1];
      const value = Number(squarePlusCoeff[2]);
      const exprVar1 = squarePlusCoeff[3];
      const op = squarePlusCoeff[4];
      const coeff = Number(squarePlusCoeff[5]);
      const exprVar2 = squarePlusCoeff[6];
      if (exprVar1 === variable && exprVar2 === variable) {
        const square = value * value;
        const linear = coeff * value;
        return {
          expectedAnswer: formatNumber(op === "+" ? square + linear : square - linear),
          rule: "SUBSTITUTE_SQUARE_PLUS_LINEAR",
        };
      }
    }

    const squareFirst = normalized.match(/^substitute ([a-z]) = (-?\d+(?:\.\d+)?) into ([a-z])²\s*([+\-])\s*(\d+)$/i);
    if (squareFirst) {
      const variable = squareFirst[1];
      const value = Number(squareFirst[2]);
      const exprVar = squareFirst[3];
      const op = squareFirst[4];
      const tail = Number(squareFirst[5]);
      if (exprVar === variable) {
        const square = value * value;
        return {
          expectedAnswer: formatNumber(op === "+" ? square + tail : square - tail),
          rule: "SUBSTITUTE_SQUARE_PLUS_CONST",
        };
      }
    }

    const squareCoeff = normalized.match(/^substitute ([a-z]) = (-?\d+(?:\.\d+)?) into (\d+)([a-z])²$/i);
    if (squareCoeff) {
      const variable = squareCoeff[1];
      const value = Number(squareCoeff[2]);
      const coeff = Number(squareCoeff[3]);
      const exprVar = squareCoeff[4];
      if (exprVar === variable) {
        return {
          expectedAnswer: formatNumber(coeff * value * value),
          rule: "SUBSTITUTE_COEFF_SQUARE",
        };
      }
    }

    const linearSubstitute = normalized.match(/^substitute ([a-z]) = (-?\d+(?:\.\d+)?) into (\d+)?([a-z])(?:²)?\s*([+\-])?\s*(\d+)?$/i);
    if (linearSubstitute) {
      const variable = linearSubstitute[1];
      const value = Number(linearSubstitute[2]);
      const coeffText = linearSubstitute[3];
      const exprVar = linearSubstitute[4];
      const op = linearSubstitute[5];
      const tailText = linearSubstitute[6];
      if (exprVar === variable) {
        const coeff = coeffText ? Number(coeffText) : 1;
        let result = coeff * value;
        if (op && tailText) {
          const tail = Number(tailText);
          result = op === "+" ? result + tail : result - tail;
        }
        return {
          expectedAnswer: formatNumber(result),
          rule: "SUBSTITUTE_LINEAR",
        };
      }
    }
  }

  const circleDiameterCircumferenceMatch = normalized.match(/circle has diameter (\d+(?:\.\d+)?)\w*.*find the circumference/i);
  if (circleDiameterCircumferenceMatch) {
    const diameter = Number(circleDiameterCircumferenceMatch[1]);
    return {
      expectedAnswer: formatWithUnit(3.14 * diameter, unit),
      rule: "CIRCUMFERENCE_DIAMETER_SENTENCE",
    };
  }

  const placeValueMatch = normalized.match(/what digit is in the (hundreds|tens|ones) place in (\d+)/i);
  if (placeValueMatch) {
    const place = placeValueMatch[1];
    const digits = placeValueMatch[2];
    const cleanDigits = digits.replace(/,/g, "");
    const indexFromRight = place === "ones" ? 1 : place === "tens" ? 2 : 3;
    const digit = cleanDigits[cleanDigits.length - indexFromRight] ?? "0";
    return { expectedAnswer: digit, rule: "PLACE_VALUE_DIGIT" };
  }

  const placeValueThousandsMatch = normalized.match(/what digit is in the thousands place in ([\d,]+)/i);
  if (placeValueThousandsMatch) {
    const cleanDigits = placeValueThousandsMatch[1].replace(/,/g, "");
    return {
      expectedAnswer: cleanDigits[cleanDigits.length - 4] ?? "0",
      rule: "PLACE_VALUE_THOUSANDS",
    };
  }

  if (rowLikeFractionComparison(normalized)) {
    const fractions = Array.from(normalized.matchAll(/(\d+)\/(\d+)/g)).map((match) => ({
      num: Number(match[1]),
      den: Number(match[2]),
    }));
    if (fractions.length >= 2) {
      const [a, b] = fractions;
      const left = a.num / a.den;
      const right = b.num / b.den;
      return {
        expectedAnswer: left < right ? "<" : left > right ? ">" : "=",
        rule: "FRACTION_COMPARISON",
      };
    }
  }

  const wholeNumberComparisonMatch =
    normalized.match(/put <, >, or = between (-?\d[\d,]*(?:\.\d+)?) and (-?\d[\d,]*(?:\.\d+)?)/i) ||
    normalized.match(/compare (-?\d[\d,]*(?:\.\d+)?) and (-?\d[\d,]*(?:\.\d+)?).*use <, >, or =/i) ||
    normalized.match(/which sign makes this true:\s*(-?\d[\d,]*(?:\.\d+)?)\s*__\s*(-?\d[\d,]*(?:\.\d+)?)/i);
  if (wholeNumberComparisonMatch) {
    const left = Number(String(wholeNumberComparisonMatch[1]).replace(/,/g, ""));
    const right = Number(String(wholeNumberComparisonMatch[2]).replace(/,/g, ""));
    return {
      expectedAnswer: left < right ? "<" : left > right ? ">" : "=",
      rule: "WHOLE_NUMBER_COMPARISON",
    };
  }

  const roundMatch = normalized.match(/^round (\d[\d,]*(?:\.\d+)?) to the nearest (\d[\d,]*(?:\.\d+)?)/i);
  if (roundMatch) {
    const value = Number(roundMatch[1].replace(/,/g, ""));
    const place = Number(roundMatch[2].replace(/,/g, ""));
    return {
      expectedAnswer: formatNumber(Math.round(value / place) * place),
      rule: "ROUND_TO_NEAREST",
    };
  }

  const moreLessMatch = normalized.match(/^what is (\d[\d,]*(?:\.\d+)?) (more|less) than (\d[\d,]*(?:\.\d+)?)/i);
  if (moreLessMatch) {
    const delta = Number(moreLessMatch[1].replace(/,/g, ""));
    const direction = moreLessMatch[2];
    const value = Number(moreLessMatch[3].replace(/,/g, ""));
    return {
      expectedAnswer: formatNumber(direction === "more" ? value + delta : value - delta),
      rule: "MORE_LESS_THAN",
    };
  }

  if (
    row.itemType === "COMPARISON" &&
    !normalized.includes("/") &&
    (normalized.includes("use <, >, or =") || normalized.includes("put <, >, or ="))
  ) {
    const values = parseNumberList(normalized);
    if (values.length >= 2) {
      const [left, right] = values;
      return {
        expectedAnswer: left < right ? "<" : left > right ? ">" : "=",
        rule: "WHOLE_NUMBER_COMPARISON_FALLBACK",
      };
    }
  }

  const rectanglePerimeterSentenceMatch = normalized.match(
    /rectangle has length (\d+(?:\.\d+)?)\s*cm and width (\d+(?:\.\d+)?)\s*cm.*perimeter/i
  );
  if (rectanglePerimeterSentenceMatch) {
    const a = Number(rectanglePerimeterSentenceMatch[1]);
    const b = Number(rectanglePerimeterSentenceMatch[2]);
    return {
      expectedAnswer: formatNumber(2 * (a + b)),
      rule: "RECTANGLE_PERIMETER_SENTENCE",
    };
  }

  const nextTermMatch = normalized.match(/^find the next term:\s*(.+)\.\.\.$/i);
  if (nextTermMatch) {
    const values = parseNumberList(nextTermMatch[1]);
    if (values.length >= 3) {
      const diffs = values.slice(1).map((value, index) => value - values[index]);
      if (diffs.every((diff) => Math.abs(diff - diffs[0]) < 0.000001)) {
        return {
          expectedAnswer: formatNumber(values[values.length - 1] + diffs[0]),
          rule: "ARITHMETIC_SEQUENCE_NEXT_TERM",
        };
      }
    }
  }

  const percentOfMatch = normalized.match(/^find (\d+(?:\.\d+)?)%\s+of\s+(\d+(?:\.\d+)?)/i);
  if (percentOfMatch) {
    const percent = Number(percentOfMatch[1]);
    const value = Number(percentOfMatch[2]);
    return {
      expectedAnswer: formatNumber((percent / 100) * value),
      rule: "PERCENT_OF_NUMBER",
    };
  }

  const increaseByPercentMatch = normalized.match(/^increase (\d+(?:\.\d+)?) by (\d+(?:\.\d+)?)%/i);
  if (increaseByPercentMatch) {
    const value = Number(increaseByPercentMatch[1]);
    const percent = Number(increaseByPercentMatch[2]);
    return {
      expectedAnswer: formatNumber(value * (1 + percent / 100)),
      rule: "PERCENT_INCREASE",
    };
  }

  const decreaseByPercentMatch = normalized.match(/^decrease (\d+(?:\.\d+)?) by (\d+(?:\.\d+)?)%/i);
  if (decreaseByPercentMatch) {
    const value = Number(decreaseByPercentMatch[1]);
    const percent = Number(decreaseByPercentMatch[2]);
    return {
      expectedAnswer: formatNumber(value * (1 - percent / 100)),
      rule: "PERCENT_DECREASE",
    };
  }

  const convertKmMatch = normalized.match(/^convert (\d+(?:\.\d+)?) km to m/i);
  if (convertKmMatch) {
    return { expectedAnswer: formatNumber(Number(convertKmMatch[1]) * 1000), rule: "KM_TO_M" };
  }

  const convertHoursMatch = normalized.match(/^convert (\d+(?:\.\d+)?) hours? to minutes/i);
  if (convertHoursMatch) {
    return { expectedAnswer: formatNumber(Number(convertHoursMatch[1]) * 60), rule: "HOURS_TO_MINUTES" };
  }

  const convertMinutesMatch = normalized.match(/^convert (\d+(?:\.\d+)?) minutes? to seconds/i);
  if (convertMinutesMatch) {
    return { expectedAnswer: formatNumber(Number(convertMinutesMatch[1]) * 60), rule: "MINUTES_TO_SECONDS" };
  }

  const convertYearsMatch = normalized.match(/^convert (\d+(?:\.\d+)?) years? to months/i);
  if (convertYearsMatch) {
    return { expectedAnswer: formatNumber(Number(convertYearsMatch[1]) * 12), rule: "YEARS_TO_MONTHS" };
  }

  const scaleKmMatch = normalized.match(/map uses scale 1cm\s*:\s*(\d+(?:\.\d+)?)km.*distance is (\d+(?:\.\d+)?)cm/i);
  if (scaleKmMatch) {
    return {
      expectedAnswer: `${formatNumber(Number(scaleKmMatch[1]) * Number(scaleKmMatch[2]))}km`,
      rule: "MAP_SCALE_KM",
    };
  }

  const mapScaleGeneralKmMatch = normalized.match(/map uses scale (\d+(?:\.\d+)?)cm\s*:\s*(\d+(?:\.\d+)?)km.*distance is (\d+(?:\.\d+)?)cm/i);
  if (mapScaleGeneralKmMatch) {
    const plan = Number(mapScaleGeneralKmMatch[1]);
    const real = Number(mapScaleGeneralKmMatch[2]);
    const target = Number(mapScaleGeneralKmMatch[3]);
    return {
      expectedAnswer: `${formatNumber((target / plan) * real)}km`,
      rule: "MAP_SCALE_GENERAL_KM",
    };
  }

  const scaleMetersMatch = normalized.match(/scale drawing uses 1cm\s*:\s*(\d+(?:\.\d+)?)m.*distance is (\d+(?:\.\d+)?)cm/i);
  if (scaleMetersMatch) {
    return {
      expectedAnswer: `${formatNumber(Number(scaleMetersMatch[1]) * Number(scaleMetersMatch[2]))}m`,
      rule: "SCALE_DRAWING_M",
    };
  }

  const scaleGeneralMetersMatch = normalized.match(/scale drawing uses (\d+(?:\.\d+)?)cm\s*:\s*(\d+(?:\.\d+)?)m.*distance is (\d+(?:\.\d+)?)cm/i);
  if (scaleGeneralMetersMatch) {
    const plan = Number(scaleGeneralMetersMatch[1]);
    const real = Number(scaleGeneralMetersMatch[2]);
    const target = Number(scaleGeneralMetersMatch[3]);
    return {
      expectedAnswer: `${formatNumber((target / plan) * real)}m`,
      rule: "SCALE_DRAWING_GENERAL_M",
    };
  }

  const floorPlanScaleMatch = normalized.match(/floor plan uses scale (\d+(?:\.\d+)?)cm\s*:\s*(\d+(?:\.\d+)?)m.*wall measures (\d+(?:\.\d+)?)cm/i);
  if (floorPlanScaleMatch) {
    const plan = Number(floorPlanScaleMatch[1]);
    const real = Number(floorPlanScaleMatch[2]);
    const target = Number(floorPlanScaleMatch[3]);
    return {
      expectedAnswer: `${formatNumber((target / plan) * real)}m`,
      rule: "FLOOR_PLAN_SCALE_M",
    };
  }

  const convertMetersToKmMatch = normalized.match(/^convert (\d+(?:\.\d+)?) m to km/i);
  if (convertMetersToKmMatch) {
    return {
      expectedAnswer: formatNumber(Number(convertMetersToKmMatch[1]) / 1000),
      rule: "M_TO_KM",
    };
  }

  const convertWeeksToDaysMatch = normalized.match(/^convert (\d+(?:\.\d+)?) weeks? to days/i);
  if (convertWeeksToDaysMatch) {
    return {
      expectedAnswer: formatNumber(Number(convertWeeksToDaysMatch[1]) * 7),
      rule: "WEEKS_TO_DAYS",
    };
  }

  if (normalized === "a fair coin is tossed. what is the probability of heads?") {
    return { expectedAnswer: "1/2", rule: "FAIR_COIN_HEADS" };
  }

  const fairDieExactMatch = normalized.match(/fair six-sided die is rolled.*probability of getting a (\d+)/i);
  if (fairDieExactMatch) {
    return { expectedAnswer: "1/6", rule: "FAIR_DIE_SINGLE" };
  }

  if (normalized.includes("fair die is rolled. what is the probability of an even number?")) {
    return { expectedAnswer: "1/2", rule: "FAIR_DIE_EVEN" };
  }

  const fairDieGreaterThanMatch = normalized.match(/fair die is rolled.*probability of getting a number greater than (\d+)/i);
  if (fairDieGreaterThanMatch) {
    const cutoff = Number(fairDieGreaterThanMatch[1]);
    const favourable = Math.max(0, 6 - cutoff);
    return { expectedAnswer: formatFraction(favourable, 6), rule: "FAIR_DIE_GREATER_THAN" };
  }

  const twoGroupProbabilityMatch =
    normalized.match(/jar has (\d+) star tokens and (\d+) circle tokens.*probability of picking a circle token/i) ||
    normalized.match(/bag has (\d+) green and (\d+) yellow counters.*probability of green/i) ||
    normalized.match(/box has (\d+) striped counters and (\d+) plain counters.*probability of picking a striped counter/i);
  if (twoGroupProbabilityMatch) {
    const a = Number(twoGroupProbabilityMatch[1]);
    const b = Number(twoGroupProbabilityMatch[2]);
    const target =
      normalized.includes("circle token")
        ? b
        : normalized.includes("yellow counters")
        ? b
        : a;
    return { expectedAnswer: formatFraction(target, a + b), rule: "TWO_GROUP_PROBABILITY" };
  }

  const spinnerProbabilityMatch = normalized.match(/spinner has (\d+) equal sections\. (\d+) show a sun/i);
  if (spinnerProbabilityMatch) {
    const total = Number(spinnerProbabilityMatch[1]);
    const favourable = Number(spinnerProbabilityMatch[2]);
    return { expectedAnswer: formatFraction(favourable, total), rule: "SPINNER_PROBABILITY" };
  }

  const threeGroupProbabilityMatch = normalized.match(/bag has (\d+) black, (\d+) white and (\d+) orange counters.*probability of white/i);
  if (threeGroupProbabilityMatch) {
    const black = Number(threeGroupProbabilityMatch[1]);
    const white = Number(threeGroupProbabilityMatch[2]);
    const orange = Number(threeGroupProbabilityMatch[3]);
    return { expectedAnswer: formatFraction(white, black + white + orange), rule: "THREE_GROUP_PROBABILITY" };
  }

  const primeTileMatch = normalized.match(/number tile from (\d+) to (\d+) is picked at random.*probability of picking a prime number/i);
  if (primeTileMatch) {
    const start = Number(primeTileMatch[1]);
    const end = Number(primeTileMatch[2]);
    const isPrime = (n: number) => {
      if (n < 2) return false;
      for (let i = 2; i * i <= n; i += 1) {
        if (n % i === 0) return false;
      }
      return true;
    };
    const values = Array.from({ length: end - start + 1 }, (_, idx) => start + idx);
    const primes = values.filter(isPrime).length;
    return { expectedAnswer: formatFraction(primes, values.length), rule: "PRIME_TILE_PROBABILITY" };
  }

  const solveGenericMatch = normalized.match(/^solve:\s*(.+?)\s*(<=|>=|<|>|=)\s*(-?\d+(?:\.\d+)?)/i);
  if (solveGenericMatch) {
    const lhs = solveGenericMatch[1].trim();
    const relation = solveGenericMatch[2];
    const rhs = Number(solveGenericMatch[3]);
    const variableMatch = lhs.match(/[a-z]/i);
    const variable = variableMatch?.[0] ?? "x";
    const escapedVar = variable.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const applyRelation = (value: number, flip = false) => {
      const finalRelation = flip
        ? relation === "<"
          ? ">"
          : relation === ">"
          ? "<"
          : relation === "<="
          ? ">="
          : relation === ">="
          ? "<="
          : relation
        : relation;
      return `${variable} ${finalRelation} ${formatNumber(value)}`;
    };

    const plusRight = new RegExp(`^${escapedVar}\\s*\\+\\s*(-?\\d+(?:\\.\\d+)?)$`, "i");
    const minusRight = new RegExp(`^${escapedVar}\\s*-\\s*(-?\\d+(?:\\.\\d+)?)$`, "i");
    const plusLeft = new RegExp(`^(-?\\d+(?:\\.\\d+)?)\\s*\\+\\s*${escapedVar}$`, "i");
    const negativeBareVar = new RegExp(`^-${escapedVar}$`, "i");
    const coeffOnly = new RegExp(`^(-?\\d*(?:\\.\\d+)?)${escapedVar}$`, "i");
    const coeffPlus = new RegExp(`^(-?\\d+(?:\\.\\d+)?)${escapedVar}\\s*\\+\\s*(-?\\d+(?:\\.\\d+)?)$`, "i");
    const coeffMinus = new RegExp(`^(-?\\d+(?:\\.\\d+)?)${escapedVar}\\s*-\\s*(-?\\d+(?:\\.\\d+)?)$`, "i");
    const constMinusVar = new RegExp(`^(-?\\d+(?:\\.\\d+)?)\\s*-\\s*${escapedVar}$`, "i");
    const divideOnly = new RegExp(`^${escapedVar}\\s*(?:÷|/)\\s*(-?\\d+(?:\\.\\d+)?)$`, "i");
    const constMinusCoeffVar = new RegExp(`^(-?\\d+(?:\\.\\d+)?)\\s*-\\s*(-?\\d+(?:\\.\\d+)?)${escapedVar}$`, "i");

    if (plusRight.test(lhs)) {
      const add = Number(lhs.match(plusRight)?.[1]);
      return { expectedAnswer: applyRelation(rhs - add), rule: "SOLVE_GENERIC_PLUS" };
    }
    if (minusRight.test(lhs)) {
      const sub = Number(lhs.match(minusRight)?.[1]);
      return { expectedAnswer: applyRelation(rhs + sub), rule: "SOLVE_GENERIC_MINUS" };
    }
    if (plusLeft.test(lhs)) {
      const add = Number(lhs.match(plusLeft)?.[1]);
      return { expectedAnswer: applyRelation(rhs - add), rule: "SOLVE_GENERIC_PLUS_LEFT" };
    }
    if (negativeBareVar.test(lhs)) {
      return { expectedAnswer: applyRelation(-rhs, true), rule: "SOLVE_GENERIC_NEGATIVE_BARE_VAR" };
    }
    if (coeffOnly.test(lhs)) {
      const rawCoeff = lhs.match(coeffOnly)?.[1] ?? "";
      const coeff =
        rawCoeff === "-" ? -1 : rawCoeff === "" ? 1 : Number(rawCoeff);
      return { expectedAnswer: applyRelation(rhs / coeff, coeff < 0), rule: "SOLVE_GENERIC_COEFF" };
    }
    if (coeffPlus.test(lhs)) {
      const coeff = Number(lhs.match(coeffPlus)?.[1]);
      const add = Number(lhs.match(coeffPlus)?.[2]);
      return { expectedAnswer: applyRelation((rhs - add) / coeff, coeff < 0), rule: "SOLVE_GENERIC_COEFF_PLUS" };
    }
    if (coeffMinus.test(lhs)) {
      const coeff = Number(lhs.match(coeffMinus)?.[1]);
      const sub = Number(lhs.match(coeffMinus)?.[2]);
      return { expectedAnswer: applyRelation((rhs + sub) / coeff, coeff < 0), rule: "SOLVE_GENERIC_COEFF_MINUS" };
    }
    if (constMinusVar.test(lhs)) {
      const constant = Number(lhs.match(constMinusVar)?.[1]);
      return { expectedAnswer: applyRelation(constant - rhs, true), rule: "SOLVE_GENERIC_CONST_MINUS_VAR" };
    }
    if (constMinusCoeffVar.test(lhs)) {
      const constant = Number(lhs.match(constMinusCoeffVar)?.[1]);
      const coeff = Number(lhs.match(constMinusCoeffVar)?.[2]);
      return {
        expectedAnswer: applyRelation((constant - rhs) / coeff, true),
        rule: "SOLVE_GENERIC_CONST_MINUS_COEFF_VAR",
      };
    }
    if (divideOnly.test(lhs)) {
      const divisor = Number(lhs.match(divideOnly)?.[1]);
      return { expectedAnswer: applyRelation(rhs * divisor), rule: "SOLVE_GENERIC_DIVIDE" };
    }
  }

  const solveQuadraticSimpleMatch = normalized.match(/^solve:\s*x²\s*=\s*(-?\d+(?:\.\d+)?)/i);
  if (solveQuadraticSimpleMatch) {
    const value = Number(solveQuadraticSimpleMatch[1]);
    const root = Math.sqrt(value);
    return { expectedAnswer: `${formatNumber(root)} or -${formatNumber(root)}`, rule: "SOLVE_QUADRATIC_SIMPLE" };
  }

  const solveQuadraticNoLinearMatch = normalized.match(/^solve:\s*x²\s*-\s*(\d+(?:\.\d+)?)\s*=\s*0/i);
  if (solveQuadraticNoLinearMatch) {
    const value = Number(solveQuadraticNoLinearMatch[1]);
    const root = Math.sqrt(value);
    return { expectedAnswer: `${formatNumber(root)} or -${formatNumber(root)}`, rule: "SOLVE_QUADRATIC_DIFF_SQUARES" };
  }

  const solveQuadraticFactoredMatch = normalized.match(/^solve:\s*x²\s*([+\-])\s*(\d*)x\s*([+\-])\s*(\d+)\s*=\s*0/i);
  if (solveQuadraticFactoredMatch) {
    const signB = solveQuadraticFactoredMatch[1] === "-" ? -1 : 1;
    const bMagnitude = solveQuadraticFactoredMatch[2] === "" ? 1 : Number(solveQuadraticFactoredMatch[2]);
    const b = signB * bMagnitude;
    const signC = solveQuadraticFactoredMatch[3] === "-" ? -1 : 1;
    const c = signC * Number(solveQuadraticFactoredMatch[4]);
    for (let r1 = -50; r1 <= 50; r1 += 1) {
      for (let r2 = -50; r2 <= 50; r2 += 1) {
        if (r1 + r2 === -b && r1 * r2 === c) {
          const ordered = [r1, r2].sort((a, b) => b - a);
          return {
            expectedAnswer: `${formatNumber(ordered[0])} or ${formatNumber(ordered[1])}`,
            rule: "SOLVE_QUADRATIC_FACTORED",
          };
        }
      }
    }
  }

  const pythagHypotenuseMatch = normalized.match(/right-angled triangle has shorter sides (\d+(?:\.\d+)?)cm and (\d+(?:\.\d+)?)cm.*hypotenuse/i);
  if (pythagHypotenuseMatch) {
    const a = Number(pythagHypotenuseMatch[1]);
    const b = Number(pythagHypotenuseMatch[2]);
    return {
      expectedAnswer: formatWithUnit(Math.sqrt(a * a + b * b), unit),
      rule: "PYTHAG_HYPOTENUSE",
    };
  }

  if (normalized.includes("right-angled triangle") && normalized.includes("hypotenuse")) {
    const values = parseNumberList(normalized);
    if (normalized.includes("one shorter side") && values.length >= 2) {
      const [c, a] = values;
      return {
        expectedAnswer: `${formatNumber(Math.sqrt(c * c - a * a))}cm`,
        rule: "PYTHAG_OTHER_SIDE_GENERIC",
      };
    }
    if (normalized.includes("shorter sides") && values.length >= 2) {
      const [a, b] = values;
      return {
        expectedAnswer: `${formatNumber(Math.sqrt(a * a + b * b))}cm`,
        rule: "PYTHAG_HYPOTENUSE_GENERIC",
      };
    }
  }

  const pythagMissingSideMatch = normalized.match(/right-angled triangle has hypotenuse (\d+(?:\.\d+)?)cm and one shorter side (\d+(?:\.\d+)?)cm.*other shorter side/i);
  if (pythagMissingSideMatch) {
    const c = Number(pythagMissingSideMatch[1]);
    const a = Number(pythagMissingSideMatch[2]);
    return {
      expectedAnswer: formatWithUnit(Math.sqrt(c * c - a * a), unit),
      rule: "PYTHAG_OTHER_SIDE",
    };
  }

  const ladderMatch = normalized.match(/ladder is (\d+(?:\.\d+)?)m long and reaches (\d+(?:\.\d+)?)m up a wall.*base from the wall/i);
  if (ladderMatch) {
    const c = Number(ladderMatch[1]);
    const a = Number(ladderMatch[2]);
    return {
      expectedAnswer: `${formatNumber(Math.sqrt(c * c - a * a))}m`,
      rule: "PYTHAG_LADDER",
    };
  }

  const squareDiagonalMatch = normalized.match(/square has side (\d+(?:\.\d+)?)cm.*diagonal/i);
  if (squareDiagonalMatch) {
    const side = Number(squareDiagonalMatch[1]);
    return {
      expectedAnswer: `${formatNumber(Math.sqrt(2 * side * side))}cm`,
      rule: "SQUARE_DIAGONAL",
    };
  }

  const rectangleDiagonalMatch = normalized.match(/rectangle is (\d+(?:\.\d+)?)cm by (\d+(?:\.\d+)?)cm.*diagonal/i);
  if (rectangleDiagonalMatch) {
    const a = Number(rectangleDiagonalMatch[1]);
    const b = Number(rectangleDiagonalMatch[2]);
    return {
      expectedAnswer: `${formatNumber(Math.sqrt(a * a + b * b))}cm`,
      rule: "RECTANGLE_DIAGONAL",
    };
  }

  const proportionRecipeMatch = normalized.match(/recipe for (\d+) people uses (\d+(?:\.\d+)?)g flour.*how much for (\d+) people/i);
  if (proportionRecipeMatch) {
    const basePeople = Number(proportionRecipeMatch[1]);
    const baseAmount = Number(proportionRecipeMatch[2]);
    const targetPeople = Number(proportionRecipeMatch[3]);
    return {
      expectedAnswer: `${formatNumber((baseAmount / basePeople) * targetPeople)}g`,
      rule: "DIRECT_PROPORTION_RECIPE",
    };
  }

  const proportionBooksMatch = normalized.match(/(\d+) books cost £(\d+(?:\.\d+)?).*cost of (\d+) books/i);
  if (proportionBooksMatch) {
    const baseCount = Number(proportionBooksMatch[1]);
    const baseCost = Number(proportionBooksMatch[2]);
    const targetCount = Number(proportionBooksMatch[3]);
    return {
      expectedAnswer: `£${formatNumber((baseCost / baseCount) * targetCount)}`,
      rule: "DIRECT_PROPORTION_BOOKS",
    };
  }

  const proportionPensMatch = normalized.match(/(\d+) pens cost £(\d+(?:\.\d+)?).*what do (\d+) pens cost/i);
  if (proportionPensMatch) {
    const baseCount = Number(proportionPensMatch[1]);
    const baseCost = Number(proportionPensMatch[2]);
    const targetCount = Number(proportionPensMatch[3]);
    return {
      expectedAnswer: `£${formatNumber((baseCost / baseCount) * targetCount)}`,
      rule: "DIRECT_PROPORTION_PENS",
    };
  }

  const proportionCarMatch = normalized.match(/car travels (\d+(?:\.\d+)?) miles on (\d+(?:\.\d+)?) gallons.*far on (\d+(?:\.\d+)?) gallons/i);
  if (proportionCarMatch) {
    const miles = Number(proportionCarMatch[1]);
    const gallons = Number(proportionCarMatch[2]);
    const targetGallons = Number(proportionCarMatch[3]);
    return {
      expectedAnswer: `${formatNumber((miles / gallons) * targetGallons)} miles`,
      rule: "DIRECT_PROPORTION_CAR",
    };
  }

  const proportionApplesMatch = normalized.match(/(\d+(?:\.\d+)?)kg of apples cost £(\d+(?:\.\d+)?).*cost of (\d+(?:\.\d+)?)kg/i);
  if (proportionApplesMatch) {
    const baseKg = Number(proportionApplesMatch[1]);
    const baseCost = Number(proportionApplesMatch[2]);
    const targetKg = Number(proportionApplesMatch[3]);
    return {
      expectedAnswer: `£${formatNumber((baseCost / baseKg) * targetKg)}`,
      rule: "DIRECT_PROPORTION_APPLES",
    };
  }

  const proportionPaintMatch = normalized.match(/(\d+(?:\.\d+)?)ml of paint covers (\d+(?:\.\d+)?)m².*paint for (\d+(?:\.\d+)?)m²/i);
  if (proportionPaintMatch) {
    const paint = Number(proportionPaintMatch[1]);
    const area = Number(proportionPaintMatch[2]);
    const targetArea = Number(proportionPaintMatch[3]);
    return {
      expectedAnswer: `${formatNumber((paint / area) * targetArea)}ml`,
      rule: "DIRECT_PROPORTION_PAINT",
    };
  }

  if (normalized.includes("cost £") && normalized.includes("same rate")) {
    const values = parseNumberList(normalized);
    if (values.length >= 3) {
      const [baseCount, baseCost, targetCount] = values;
      return {
        expectedAnswer: `£${formatNumber((baseCost / baseCount) * targetCount)}`,
        rule: "DIRECT_PROPORTION_GENERIC_COST",
      };
    }
  }

  if (normalized.includes("what do") && normalized.includes("cost £")) {
    const values = parseNumberList(normalized);
    if (values.length >= 3) {
      const [baseCount, baseCost, targetCount] = values;
      return {
        expectedAnswer: `£${formatNumber((baseCost / baseCount) * targetCount)}`,
        rule: "DIRECT_PROPORTION_GENERIC_COST",
      };
    }
  }

  if (normalized.includes("how much for") && normalized.includes("uses")) {
    const values = parseNumberList(normalized);
    if (values.length >= 3) {
      const [basePeople, baseAmount, targetPeople] = values;
      return {
        expectedAnswer: `${formatNumber((baseAmount / basePeople) * targetPeople)}g`,
        rule: "DIRECT_PROPORTION_GENERIC_RECIPE",
      };
    }
  }

  if (normalized.includes("covers") && normalized.includes("how much paint for")) {
    const values = parseNumberList(normalized);
    if (values.length >= 3) {
      const [paint, area, targetArea] = values;
      return {
        expectedAnswer: `${formatNumber((paint / area) * targetArea)}ml`,
        rule: "DIRECT_PROPORTION_GENERIC_PAINT",
      };
    }
  }

  if (normalized.includes("travels") && normalized.includes("how far on")) {
    const values = parseNumberList(normalized);
    if (values.length >= 3) {
      const [distance, fuel, targetFuel] = values;
      return {
        expectedAnswer: `${formatNumber((distance / fuel) * targetFuel)} miles`,
        rule: "DIRECT_PROPORTION_GENERIC_DISTANCE",
      };
    }
  }

  if (normalized.includes("wall-hours")) {
    const values = parseNumberList(normalized);
    if (values.length >= 2) {
      return {
        expectedAnswer: formatNumber(values[0] * values[values.length - 1]),
        rule: "WORKER_HOURS",
      };
    }
  }

  const expandSimpleMatch = normalized.match(/^expand:\s*(-?\d+)\(([a-z])\s*([+\-])\s*(\d+)\)/i);
  if (expandSimpleMatch) {
    const factor = Number(expandSimpleMatch[1]);
    const variable = expandSimpleMatch[2];
    const op = expandSimpleMatch[3];
    const constant = Number(expandSimpleMatch[4]);
    const coeff = factor;
    const term = factor * constant;
    const sign = op === "+" ? "+" : term >= 0 ? "-" : "+";
    const absTerm = Math.abs(term);
    return {
      expectedAnswer: `${coeff}${variable} ${sign} ${absTerm}`,
      rule: "EXPAND_SIMPLE",
    };
  }

  if (normalized.startsWith("expand:")) {
    const values = parseNumberList(normalized);
    const variableMatch = normalized.match(/\(([0-9-]*)([a-z])/i) || normalized.match(/\(([a-z])/i);
    if (values.length >= 2 && variableMatch) {
      const outer = values[0];
      const variable = variableMatch[2] ?? variableMatch[1];
      const innerCoeff = normalized.includes(`${variable}²`) ? null : (normalized.match(/\((\d+)([a-z])/i)?.[1] ? Number(normalized.match(/\((\d+)([a-z])/i)?.[1]) : 1);
      const tail = values[values.length - 1];
      const coeff = outer * (innerCoeff ?? 1);
      if (normalized.includes("+")) {
        return {
          expectedAnswer: `${coeff}${variable} + ${Math.abs(outer * tail)}`,
          rule: "EXPAND_GENERIC",
        };
      }
      if (normalized.includes("-")) {
        const term = outer * tail;
        return {
          expectedAnswer: `${coeff}${variable} ${term >= 0 ? "-" : "+"} ${Math.abs(term)}`,
          rule: "EXPAND_GENERIC",
        };
      }
    }
  }

  const expandCoeffVarMatch = normalized.match(/^expand:\s*(-?\d+)\((\d+)([a-z])\s*([+\-])\s*(\d+)\)/i);
  if (expandCoeffVarMatch) {
    const outer = Number(expandCoeffVarMatch[1]);
    const innerCoeff = Number(expandCoeffVarMatch[2]);
    const variable = expandCoeffVarMatch[3];
    const op = expandCoeffVarMatch[4];
    const constant = Number(expandCoeffVarMatch[5]);
    const coeff = outer * innerCoeff;
    const term = outer * constant;
    const sign = op === "+" ? "+" : term >= 0 ? "-" : "+";
    const absTerm = Math.abs(term);
    return {
      expectedAnswer: `${coeff}${variable} ${sign} ${absTerm}`,
      rule: "EXPAND_COEFF_VAR",
    };
  }

  const substituteLinearMatch = normalized.match(/^substitute ([a-z]) = (-?\d+(?:\.\d+)?) into (\d+)?([a-z])(?:²)?\s*([+\-])?\s*(\d+)?$/i);
  if (substituteLinearMatch) {
    const variable = substituteLinearMatch[1];
    const value = Number(substituteLinearMatch[2]);
    const coeffText = substituteLinearMatch[3];
    const exprVar = substituteLinearMatch[4];
    const op = substituteLinearMatch[5];
    const tailText = substituteLinearMatch[6];
    if (exprVar === variable) {
      const coeff = coeffText ? Number(coeffText) : 1;
      let result = coeff * value;
      if (op && tailText) {
        const tail = Number(tailText);
        result = op === "+" ? result + tail : result - tail;
      }
      return {
        expectedAnswer: formatNumber(result),
        rule: "SUBSTITUTE_LINEAR",
      };
    }
  }

  const substituteSquareMatch = normalized.match(/^substitute ([a-z]) = (-?\d+(?:\.\d+)?) into ([a-z])²\s*([+\-])\s*(\d+)$/i);
  if (substituteSquareMatch) {
    const variable = substituteSquareMatch[1];
    const value = Number(substituteSquareMatch[2]);
    const exprVar = substituteSquareMatch[3];
    const op = substituteSquareMatch[4];
    const tail = Number(substituteSquareMatch[5]);
    if (exprVar === variable) {
      const square = value * value;
      return {
        expectedAnswer: formatNumber(op === "+" ? square + tail : square - tail),
        rule: "SUBSTITUTE_SQUARE_PLUS_CONST",
      };
    }
  }

  return { expectedAnswer: null, rule: null };
}

function rowLikeFractionComparison(normalizedPrompt: string): boolean {
  return (
    normalizedPrompt.includes("use <, >, or =") ||
    normalizedPrompt.includes("put <, >, or =") ||
    normalizedPrompt.includes("which sign makes this true")
  );
}

function auditRow(row: AuditRow): CorrectnessFinding[] {
  const findings: CorrectnessFinding[] = [];
  const base = {
    questionId: row.id,
    objectiveCode: row.objective.code,
    objectiveTitle: row.objective.title,
    yearGroup: row.objective.yearGroup,
    itemType: row.itemType,
    difficulty: row.difficulty,
    promptText: row.promptText,
    answerText: row.answerText,
  };

  if (!row.promptText.trim()) {
    findings.push({
      ...base,
      issue: "BLANK_PROMPT",
      details: "Prompt text is blank.",
    });
  }

  if (!row.answerText.trim()) {
    findings.push({
      ...base,
      issue: "BLANK_ANSWER",
      details: "Answer text is blank.",
    });
  }

  if (row.itemType === "EQUATION") {
    if (row.operator == null || row.lhsA == null || row.lhsB == null || row.rhs == null) {
      const derived = deriveExpectedAnswerFromPrompt(row);
      if (derived.expectedAnswer == null) {
        findings.push({
          ...base,
          issue: "UNVERIFIED_PATTERN",
          details: "Equation item has no structured maths fields and no parser rule matched the prompt.",
        });
      } else if (!compareExpectedToAnswer(derived.expectedAnswer, row.answerText)) {
        findings.push({
          ...base,
          issue: "PROMPT_ANSWER_MISMATCH",
          details: `Prompt-derived answer (${derived.expectedAnswer}) does not match stored answer (${row.answerText}). Rule=${derived.rule}.`,
        });
      }
      return findings;
    }

    const expected = evaluate(row.operator, row.lhsA, row.lhsB);
    if (expected == null || Math.abs(expected - row.rhs) > 0.000001) {
      findings.push({
        ...base,
        issue: "STRUCTURED_ARITHMETIC_MISMATCH",
        details: `Structured maths does not evaluate to stored rhs (${row.lhsA} ${formatOperator(row.operator)} ${row.lhsB} != ${row.rhs}).`,
      });
    }

    const answerValue = extractLeadingNumber(row.answerText);
    if (answerValue == null || Math.abs(answerValue - row.rhs) > 0.000001) {
      findings.push({
        ...base,
        issue: "ANSWER_RHS_MISMATCH",
        details: `Answer text does not match stored rhs (${row.answerText} vs ${row.rhs}).`,
      });
    }

    const expectedEquation = buildExpectedEquation(row);
    if (
      expectedEquation &&
      normalize(row.equation).replace(/−/g, "-").replace(/×/g, "x") !==
        normalize(expectedEquation).replace(/−/g, "-").replace(/×/g, "x")
    ) {
      findings.push({
        ...base,
        issue: "EQUATION_STRING_MISMATCH",
        details: `Stored equation string does not match structured fields (${row.equation} vs ${expectedEquation}).`,
      });
    }
  }

  if (row.itemType === "COMPARISON") {
    if (row.lhsA == null || row.lhsB == null) {
      const derived = deriveExpectedAnswerFromPrompt(row);
      if (derived.expectedAnswer == null) {
        findings.push({
          ...base,
          issue: "STRUCTURED_VALUE_MISSING",
          details: "Comparison item is missing lhsA/lhsB and no parser rule matched the prompt.",
        });
      } else if (!compareExpectedToAnswer(derived.expectedAnswer, row.answerText)) {
        findings.push({
          ...base,
          issue: "PROMPT_ANSWER_MISMATCH",
          details: `Prompt-derived comparison answer (${derived.expectedAnswer}) does not match stored answer (${row.answerText}). Rule=${derived.rule}.`,
        });
      }
      return findings;
    }

    const expectedSymbol = compareSymbols(row.lhsA, row.lhsB);
    if (row.answerText.trim() !== expectedSymbol) {
      findings.push({
        ...base,
        issue: "COMPARISON_RESULT_MISMATCH",
        details: `Comparison answer should be ${expectedSymbol} for ${row.lhsA} and ${row.lhsB}.`,
      });
    }
  }

  return findings;
}

async function main() {
  const rows = (await prisma.canonicalQuestion.findMany({
    where: {
      status: "ACTIVE",
      objective: {
        subject: Subject.MATHS,
        isActive: true,
      },
    },
    select: {
      id: true,
      itemType: true,
      operator: true,
      lhsA: true,
      lhsB: true,
      rhs: true,
      equation: true,
      promptText: true,
      answerText: true,
      difficulty: true,
      objective: {
        select: {
          code: true,
          title: true,
          yearGroup: true,
          subject: true,
        },
      },
    },
    orderBy: [
      { objective: { yearGroup: "asc" } },
      { objective: { code: "asc" } },
      { sequence: "asc" },
    ],
  })) as AuditRow[];

  const findings = rows.flatMap(auditRow);

  const summary = findings.reduce<Record<string, number>>((acc, finding) => {
    acc[finding.issue] = (acc[finding.issue] ?? 0) + 1;
    return acc;
  }, {});

  const structuredCoverage = rows.reduce(
    (acc, row) => {
      if (row.itemType === "EQUATION") acc.equationItems += 1;
      if (row.itemType === "COMPARISON") acc.comparisonItems += 1;
      return acc;
    },
    { equationItems: 0, comparisonItems: 0 }
  );

  console.log(
    JSON.stringify(
      {
        auditedActiveQuestions: rows.length,
        structuredCoverage,
        flaggedFindings: findings.length,
        summary,
        findings,
      },
      null,
      2
    )
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
