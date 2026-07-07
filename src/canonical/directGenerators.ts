import { DifficultyBand, type CanonicalItemType } from "@prisma/client";
import type {
  DirectGeneratorName,
  GeneratedCanonicalQuestion,
} from "./types";

export type DirectGeneratedCanonicalQuestion = GeneratedCanonicalQuestion & {
  sequence: number;
};

type SequenceDirection = "forward" | "backward";
type SequenceStep = 1 | 2 | 5 | 10;

type DirectGenerationContext = {
  targetCount?: number;
  profileName?: string;
};

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function stableSort<T>(items: T[], keyFn: (item: T) => string): T[] {
  return [...items].sort((a, b) => keyFn(a).localeCompare(keyFn(b)));
}

function pickSpread<T>(items: T[], count: number): T[] {
  if (items.length < count) {
    throw new Error(`Not enough items to pick ${count}. Pool=${items.length}`);
  }

  if (items.length === count) {
    return [...items];
  }

  const out: T[] = [];
  const used = new Set<number>();

  for (let i = 0; i < count; i += 1) {
    const rawIndex = Math.floor((i * items.length) / count);
    let index = rawIndex;

    while (used.has(index)) {
      index += 1;
      if (index >= items.length) index = 0;
    }

    used.add(index);
    out.push(items[index]);
  }

  return out;
}

function withSequence(
  items: Omit<DirectGeneratedCanonicalQuestion, "sequence">[]
): DirectGeneratedCanonicalQuestion[] {
  return items.map((item, index) => ({
    sequence: index + 1,
    ...item,
  }));
}

function difficultyFromMagnitude(
  value: number,
  easyMax: number,
  mediumMax: number
): DifficultyBand {
  if (value <= easyMax) return DifficultyBand.EASY;
  if (value <= mediumMax) return DifficultyBand.MEDIUM;
  return DifficultyBand.HARD;
}

function normalizeDirectGeneratorName(
  name: string
): DirectGeneratorName | string {
  switch (name) {
    case "ONE_MORE_ONE_LESS_TO_20":
      return "one_more_one_less_to_20";
    case "NUMBER_LINE_AND_COMPARISON_TO_20":
      return "number_line_within_20";
    case "COUNT_ACROSS_100":
      return "count_forwards_to_20";
    case "SKIP_COUNTING_TO_100":
      return "count_in_10s";
    case "FRACTION_HALVES":
      return "half_of_quantity";
    case "FRACTION_QUARTERS":
      return "quarter_of_quantity";
    case "MEASUREMENT_COMPARISON":
      return "measurement_compare";
    case "TURN_DIRECTION":
      return "turn_direction";
    case "TIME_HOUR_AND_HALF_PAST":
      return "time_match_hour_half_hour";
    case "DATE_LANGUAGE":
    case "CHRONOLOGY_LANGUAGE":
      return "date_sequence";
    case "COIN_VALUES":
      return "coin_value";
    case "SHAPE_NAMING":
      return "shape_name";
    default:
      return name;
  }
}

function takeTargetCount<T>(items: T[], targetCount = 10): T[] {
  if (items.length < targetCount) {
    throw new Error(
      `Direct generator returned ${items.length} items, expected at least ${targetCount}.`
    );
  }

  return items.slice(0, targetCount);
}

function makeQuestion(params: {
  itemType: CanonicalItemType;
  promptText: string;
  answerText: string;
  difficulty: DifficultyBand;
  contentJson: Record<string, unknown>;
  generatorMeta?: Record<string, unknown>;
}): Omit<DirectGeneratedCanonicalQuestion, "sequence"> {
  return {
    itemType: params.itemType,
    promptText: params.promptText,
    answerText: params.answerText,
    difficulty: params.difficulty,
    contentJson: params.contentJson,
    generatorMeta: params.generatorMeta,
    generatorVersion: "canonical-v2-direct",
  };
}

function buildComparisonPrompt(
  left: string | number,
  right: string | number,
  seed: string,
  includeEquals = true
): string {
  const options = includeEquals
    ? [
        `Compare ${left} and ${right}. Use <, >, or =.`,
        `Which sign makes this true: ${left} __ ${right}? Use <, >, or =.`,
        `Put <, >, or = between ${left} and ${right}.`,
      ]
    : [
        `Which is greater: ${left} or ${right}? Write < or > to compare them.`,
        `Compare ${left} and ${right}. Use < or >.`,
        `Put the correct sign between ${left} and ${right}: < or >.`,
      ];

  return options[hashString(seed) % options.length] ?? options[0];
}

function buildEquivalentFractionPrompt(
  numerator: number,
  denominator: number,
  scaledDenominator: number,
  seed: string
): string {
  const options = [
    `Complete the equivalent fraction: ${numerator}/${denominator} = __/${scaledDenominator}.`,
    `What number is missing? ${numerator}/${denominator} = __/${scaledDenominator}.`,
    `Fill in the missing numerator to make an equivalent fraction: ${numerator}/${denominator} = __/${scaledDenominator}.`,
  ];

  return options[hashString(seed) % options.length] ?? options[0];
}

function buildCalculationPrompt(expression: string): string {
  return `Calculate ${expression}.`;
}

function buildNextNumberPrompt(values: Array<number | string>): string {
  return `What is the next number in the sequence ${values.join(", ")}, __?`;
}

function buildMoreLessPrompt(base: number, delta: number): string {
  const amount = Math.abs(delta).toLocaleString("en-GB");
  const comparator = delta >= 0 ? "more" : "less";
  return `What is ${amount} ${comparator} than ${base.toLocaleString("en-GB")}?`;
}

/* =========================================================
 * KS1 EXISTING GENERATORS
 * ========================================================= */

function buildOneMoreOneLessItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (let n = 1; n <= 20; n += 1) {
    if (n < 20) {
      pool.push(
        makeQuestion({
          itemType: "ONE_MORE_ONE_LESS",
          promptText: `One more than ${n}`,
          answerText: String(n + 1),
          difficulty: difficultyFromMagnitude(n, 6, 12),
          contentJson: {
            mode: "MORE",
            value: n,
            answer: n + 1,
          },
          generatorMeta: {
            family: "one_more_one_less",
            mode: "MORE",
          },
        })
      );
    }

    if (n > 1) {
      pool.push(
        makeQuestion({
          itemType: "ONE_MORE_ONE_LESS",
          promptText: `One less than ${n}`,
          answerText: String(n - 1),
          difficulty: difficultyFromMagnitude(n, 6, 12),
          contentJson: {
            mode: "LESS",
            value: n,
            answer: n - 1,
          },
          generatorMeta: {
            family: "one_more_one_less",
            mode: "LESS",
          },
        })
      );
    }
  }

  return withSequence(
    pickSpread(stableSort(pool, (x) => `${x.promptText}|${x.answerText}`), count)
  );
}

function buildComparisonItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (let a = 0; a <= 20; a += 1) {
    for (let b = 0; b <= 20; b += 1) {
      let answer: "<" | ">" | "=";
      if (a < b) answer = "<";
      else if (a > b) answer = ">";
      else answer = "=";

      const max = Math.max(a, b);

      pool.push(
        makeQuestion({
          itemType: "COMPARISON",
          promptText: buildComparisonPrompt(a, b, `ks1-${a}-${b}`),
          answerText: answer,
          difficulty: difficultyFromMagnitude(max, 6, 12),
          contentJson: {
            left: a,
            right: b,
            answer,
          },
          generatorMeta: {
            family: "comparison",
          },
        })
      );
    }
  }

  const ordered = stableSort(pool, (x) => {
    const left = Number((x.contentJson?.left as number) ?? 0);
    const right = Number((x.contentJson?.right as number) ?? 0);
    return `${x.answerText}|${String(left).padStart(2, "0")}|${String(right).padStart(2, "0")}`;
  });

  const equals = ordered.filter((x) => x.answerText === "=");
  const less = ordered.filter((x) => x.answerText === "<");
  const greater = ordered.filter((x) => x.answerText === ">");

  const eqCount = Math.max(1, Math.floor(count * 0.2));
  const remaining = count - eqCount;
  const lessCount = Math.floor(remaining / 2);
  const greaterCount = remaining - lessCount;

  const chosen = [
    ...pickSpread(equals, eqCount),
    ...pickSpread(less, lessCount),
    ...pickSpread(greater, greaterCount),
  ];

  return withSequence(stableSort(chosen, (x) => `${x.promptText}|${x.answerText}`));
}

function makeSequencePrompt(values: Array<number | null>): string {
  return values.map((v) => (v === null ? "[]" : String(v))).join(", ");
}

function buildNumberSequenceItems(params: {
  step: SequenceStep;
  direction: SequenceDirection;
  minStart: number;
  maxStart: number;
  count: number;
  label: string;
}): DirectGeneratedCanonicalQuestion[] {
  const { step, direction, minStart, maxStart, count, label } = params;
  const missingPatterns = [1, 2, 3];
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (let start = minStart; start <= maxStart; start += 1) {
    const values =
      direction === "forward"
        ? [start, start + step, start + step * 2, start + step * 3, start + step * 4]
        : [start, start - step, start - step * 2, start - step * 3, start - step * 4];

    const minValue = Math.min(...values);
    const maxValue = Math.max(...values);
    if (minValue < 0 || maxValue > 100) continue;

    for (const missingIndex of missingPatterns) {
      const rendered = values.map((v, i) => (i === missingIndex ? null : v));
      const answer = values[missingIndex];

      pool.push(
        makeQuestion({
          itemType: "NUMBER_SEQUENCE",
          promptText: makeSequencePrompt(rendered),
          answerText: String(answer),
          difficulty:
            step === 1
              ? difficultyFromMagnitude(maxValue, 10, 20)
              : step === 2
                ? difficultyFromMagnitude(maxValue, 12, 24)
                : step === 5
                  ? difficultyFromMagnitude(maxValue, 25, 50)
                  : difficultyFromMagnitude(maxValue, 50, 80),
          contentJson: {
            values,
            rendered,
            answer,
            step,
            direction,
          },
          generatorMeta: {
            family: "number_sequence",
            label,
            step,
            direction,
          },
        })
      );
    }
  }

  return withSequence(
    pickSpread(
      stableSort(pool, (x) => {
        const json = x.contentJson as {
          values: number[];
          step: number;
          direction: string;
        };
        return `${json.direction}|${json.step}|${json.values.join(",")}|${x.answerText}`;
      }),
      count
    )
  );
}

function buildNumberLineItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (let start = 0; start <= 16; start += 1) {
    const end = start + 4;

    for (let answer = start + 1; answer <= end - 1; answer += 1) {
      pool.push(
        makeQuestion({
          itemType: "NUMBER_LINE",
          promptText: `${start}, [], ${end}`,
          answerText: String(answer),
          difficulty: difficultyFromMagnitude(answer, 6, 12),
          contentJson: {
            start,
            end,
            answer,
          },
          generatorMeta: {
            family: "number_line",
          },
        })
      );
    }
  }

  return withSequence(
    pickSpread(stableSort(pool, (x) => `${x.promptText}|${x.answerText}`), count)
  );
}

function buildFractionOfQuantityItems(params: {
  fraction: "1/2" | "1/4";
  values: number[];
  count: number;
}): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (const value of params.values) {
    const denominator = params.fraction === "1/2" ? 2 : 4;
    if (value % denominator !== 0) continue;

    const answer = value / denominator;

    pool.push(
      makeQuestion({
        itemType: "FRACTION_OF_QUANTITY",
        promptText: `${params.fraction} of ${value}`,
        answerText: String(answer),
        difficulty: difficultyFromMagnitude(value, 8, 16),
        contentJson: {
          fraction: params.fraction,
          value,
          answer,
        },
        generatorMeta: {
          family: "fraction_of_quantity",
          fraction: params.fraction,
        },
      })
    );
  }

  return withSequence(
    pickSpread(stableSort(pool, (x) => `${x.promptText}|${x.answerText}`), params.count)
  );
}

function buildMeasurementCompareItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const units = ["cm", "m"] as const;
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (const unit of units) {
    for (let a = 1; a <= 20; a += 1) {
      for (let b = 1; b <= 20; b += 1) {
        if (a === b) continue;

        const answer = a > b ? ">" : "<";
        const max = Math.max(a, b);

        pool.push(
          makeQuestion({
            itemType: "MEASUREMENT_COMPARE",
            promptText: buildComparisonPrompt(
              `${a} ${unit}`,
              `${b} ${unit}`,
              `measure-${unit}-${a}-${b}`,
              false
            ),
            answerText: answer,
            difficulty: difficultyFromMagnitude(max, 6, 12),
            contentJson: {
              left: { value: a, unit },
              right: { value: b, unit },
              answer,
            },
            generatorMeta: {
              family: "measurement_compare",
              unit,
            },
          })
        );
      }
    }
  }

  const byUnit = {
    cm: pool.filter((x) => (x.generatorMeta?.unit as string) === "cm"),
    m: pool.filter((x) => (x.generatorMeta?.unit as string) === "m"),
  };

  const cmCount = Math.ceil(count / 2);
  const mCount = count - cmCount;

  return withSequence(
    stableSort(
      [
        ...pickSpread(stableSort(byUnit.cm, (x) => `${x.promptText}|${x.answerText}`), cmCount),
        ...pickSpread(stableSort(byUnit.m, (x) => `${x.promptText}|${x.answerText}`), mCount),
      ],
      (x) => `${x.promptText}|${x.answerText}`
    )
  );
}

function buildTurnDirectionItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [
    makeQuestion({
      itemType: "TURN_DIRECTION",
      promptText: "Quarter turn clockwise",
      answerText: "right",
      difficulty: DifficultyBand.EASY,
      contentJson: { turn: "quarter", direction: "clockwise", answer: "right" },
      generatorMeta: { family: "turn_direction" },
    }),
    makeQuestion({
      itemType: "TURN_DIRECTION",
      promptText: "Quarter turn anticlockwise",
      answerText: "left",
      difficulty: DifficultyBand.EASY,
      contentJson: { turn: "quarter", direction: "anticlockwise", answer: "left" },
      generatorMeta: { family: "turn_direction" },
    }),
    makeQuestion({
      itemType: "TURN_DIRECTION",
      promptText: "Half turn clockwise",
      answerText: "half turn",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { turn: "half", direction: "clockwise", answer: "half turn" },
      generatorMeta: { family: "turn_direction" },
    }),
    makeQuestion({
      itemType: "TURN_DIRECTION",
      promptText: "Half turn anticlockwise",
      answerText: "half turn",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { turn: "half", direction: "anticlockwise", answer: "half turn" },
      generatorMeta: { family: "turn_direction" },
    }),
    makeQuestion({
      itemType: "TURN_DIRECTION",
      promptText: "Three-quarter turn clockwise",
      answerText: "three-quarter turn",
      difficulty: DifficultyBand.HARD,
      contentJson: { turn: "three-quarter", direction: "clockwise", answer: "three-quarter turn" },
      generatorMeta: { family: "turn_direction" },
    }),
    makeQuestion({
      itemType: "TURN_DIRECTION",
      promptText: "Three-quarter turn anticlockwise",
      answerText: "three-quarter turn",
      difficulty: DifficultyBand.HARD,
      contentJson: { turn: "three-quarter", direction: "anticlockwise", answer: "three-quarter turn" },
      generatorMeta: { family: "turn_direction" },
    }),
    makeQuestion({
      itemType: "TURN_DIRECTION",
      promptText: "Full turn clockwise",
      answerText: "full turn",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { turn: "full", direction: "clockwise", answer: "full turn" },
      generatorMeta: { family: "turn_direction" },
    }),
    makeQuestion({
      itemType: "TURN_DIRECTION",
      promptText: "Full turn anticlockwise",
      answerText: "full turn",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { turn: "full", direction: "anticlockwise", answer: "full turn" },
      generatorMeta: { family: "turn_direction" },
    }),
    makeQuestion({
      itemType: "TURN_DIRECTION",
      promptText: "Turn right",
      answerText: "clockwise",
      difficulty: DifficultyBand.EASY,
      contentJson: { command: "right", answer: "clockwise" },
      generatorMeta: { family: "turn_direction" },
    }),
    makeQuestion({
      itemType: "TURN_DIRECTION",
      promptText: "Turn left",
      answerText: "anticlockwise",
      difficulty: DifficultyBand.EASY,
      contentJson: { command: "left", answer: "anticlockwise" },
      generatorMeta: { family: "turn_direction" },
    }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildTimeMatchItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (let hour = 1; hour <= 12; hour += 1) {
    pool.push(
      makeQuestion({
        itemType: "TIME_MATCH",
        promptText: `${hour}:00`,
        answerText: `${hour} o'clock`,
        difficulty:
          hour <= 4 ? DifficultyBand.EASY : hour <= 8 ? DifficultyBand.MEDIUM : DifficultyBand.HARD,
        contentJson: {
          hour,
          minute: 0,
          label: `${hour} o'clock`,
        },
        generatorMeta: {
          family: "time_match",
          kind: "oclock",
        },
      })
    );

    pool.push(
      makeQuestion({
        itemType: "TIME_MATCH",
        promptText: `${hour}:30`,
        answerText: `half past ${hour}`,
        difficulty:
          hour <= 4 ? DifficultyBand.EASY : hour <= 8 ? DifficultyBand.MEDIUM : DifficultyBand.HARD,
        contentJson: {
          hour,
          minute: 30,
          label: `half past ${hour}`,
        },
        generatorMeta: {
          family: "time_match",
          kind: "half_past",
        },
      })
    );
  }

  const oclock = pool.filter((x) => x.generatorMeta?.kind === "oclock");
  const halfPast = pool.filter((x) => x.generatorMeta?.kind === "half_past");

  const oclockCount = Math.ceil(count / 2);
  const halfPastCount = count - oclockCount;

  return withSequence(
    stableSort(
      [
        ...pickSpread(stableSort(oclock, (x) => `${x.promptText}|${x.answerText}`), oclockCount),
        ...pickSpread(stableSort(halfPast, (x) => `${x.promptText}|${x.answerText}`), halfPastCount),
      ],
      (x) => `${x.promptText}|${x.answerText}`
    )
  );
}

function buildDateSequenceItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const days = [
    "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday",
  ];

  const months = [
    "January", "February", "March", "April", "May", "June",
    "July", "August", "September", "October", "November", "December",
  ];

  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (let i = 0; i < days.length; i += 1) {
    pool.push(
      makeQuestion({
        itemType: "DATE_SEQUENCE",
        promptText: `${days[i]}, []`,
        answerText: days[(i + 1) % days.length],
        difficulty: DifficultyBand.EASY,
        contentJson: {
          family: "days",
          current: days[i],
          answer: days[(i + 1) % days.length],
        },
        generatorMeta: {
          family: "date_sequence",
          kind: "days_next",
        },
      })
    );
  }

  for (let i = 0; i < months.length; i += 1) {
    pool.push(
      makeQuestion({
        itemType: "DATE_SEQUENCE",
        promptText: `${months[i]}, []`,
        answerText: months[(i + 1) % months.length],
        difficulty: i < 4 ? DifficultyBand.EASY : i < 8 ? DifficultyBand.MEDIUM : DifficultyBand.HARD,
        contentJson: {
          family: "months",
          current: months[i],
          answer: months[(i + 1) % months.length],
        },
        generatorMeta: {
          family: "date_sequence",
          kind: "months_next",
        },
      })
    );
  }

  const dayItems = pool.filter((x) => x.generatorMeta?.kind === "days_next");
  const monthItems = pool.filter((x) => x.generatorMeta?.kind === "months_next");

  const dayCount = Math.max(4, Math.floor(count / 2));
  const monthCount = count - dayCount;

  return withSequence(
    stableSort(
      [
        ...pickSpread(stableSort(dayItems, (x) => `${x.promptText}|${x.answerText}`), dayCount),
        ...pickSpread(stableSort(monthItems, (x) => `${x.promptText}|${x.answerText}`), monthCount),
      ],
      (x) => `${x.promptText}|${x.answerText}`
    )
  );
}

function buildCoinValueItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const coins = [1, 2, 5, 10] as const;
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (const a of coins) {
    for (const b of coins) {
      for (const c of coins) {
        const total = a + b + c;
        const sortedCoins = [a, b, c].sort((x, y) => x - y);

        pool.push(
          makeQuestion({
            itemType: "COIN_VALUE",
            promptText: `${sortedCoins[0]}p + ${sortedCoins[1]}p + ${sortedCoins[2]}p`,
            answerText: `${total}p`,
            difficulty: difficultyFromMagnitude(total, 8, 15),
            contentJson: {
              coins: sortedCoins,
              total,
            },
            generatorMeta: {
              family: "coin_value",
              coinCount: 3,
            },
          })
        );
      }
    }
  }

  const deduped = new Map<string, Omit<DirectGeneratedCanonicalQuestion, "sequence">>();
  for (const item of pool) {
    if (!deduped.has(item.promptText)) {
      deduped.set(item.promptText, item);
    }
  }

  return withSequence(
    pickSpread(
      stableSort([...deduped.values()], (x) => `${x.promptText}|${x.answerText}`),
      count
    )
  );
}

function buildShapeNameItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [
    makeQuestion({
      itemType: "SHAPE_NAME",
      promptText: "3 sides",
      answerText: "triangle",
      difficulty: DifficultyBand.EASY,
      contentJson: { sides: 3, shape: "triangle" },
      generatorMeta: { family: "shape_name" },
    }),
    makeQuestion({
      itemType: "SHAPE_NAME",
      promptText: "4 equal sides",
      answerText: "square",
      difficulty: DifficultyBand.EASY,
      contentJson: { sides: 4, property: "equal_sides", shape: "square" },
      generatorMeta: { family: "shape_name" },
    }),
    makeQuestion({
      itemType: "SHAPE_NAME",
      promptText: "4 sides",
      answerText: "rectangle",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { sides: 4, shape: "rectangle" },
      generatorMeta: { family: "shape_name" },
    }),
    makeQuestion({
      itemType: "SHAPE_NAME",
      promptText: "5 sides",
      answerText: "pentagon",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { sides: 5, shape: "pentagon" },
      generatorMeta: { family: "shape_name" },
    }),
    makeQuestion({
      itemType: "SHAPE_NAME",
      promptText: "6 sides",
      answerText: "hexagon",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { sides: 6, shape: "hexagon" },
      generatorMeta: { family: "shape_name" },
    }),
    makeQuestion({
      itemType: "SHAPE_NAME",
      promptText: "8 sides",
      answerText: "octagon",
      difficulty: DifficultyBand.HARD,
      contentJson: { sides: 8, shape: "octagon" },
      generatorMeta: { family: "shape_name" },
    }),
    makeQuestion({
      itemType: "SHAPE_NAME",
      promptText: "No sides",
      answerText: "circle",
      difficulty: DifficultyBand.EASY,
      contentJson: { sides: 0, shape: "circle" },
      generatorMeta: { family: "shape_name" },
    }),
    makeQuestion({
      itemType: "SHAPE_NAME",
      promptText: "4 sides, longer than it is tall",
      answerText: "rectangle",
      difficulty: DifficultyBand.MEDIUM,
      contentJson: { sides: 4, property: "rectangular", shape: "rectangle" },
      generatorMeta: { family: "shape_name" },
    }),
    makeQuestion({
      itemType: "SHAPE_NAME",
      promptText: "4 sides, all equal",
      answerText: "square",
      difficulty: DifficultyBand.EASY,
      contentJson: { sides: 4, property: "all_equal", shape: "square" },
      generatorMeta: { family: "shape_name" },
    }),
    makeQuestion({
      itemType: "SHAPE_NAME",
      promptText: "1 curved side",
      answerText: "circle",
      difficulty: DifficultyBand.EASY,
      contentJson: { curvedSides: 1, shape: "circle" },
      generatorMeta: { family: "shape_name" },
    }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

/* =========================================================
 * SECONDARY MATHS GENERATORS
 * ========================================================= */

function mathsQuestion(params: {
  promptText: string;
  answerText: string;
  difficulty: DifficultyBand;
  subtype: string;
  domain: string;
  equation?: string;
  contentJson?: Record<string, unknown>;
}): Omit<DirectGeneratedCanonicalQuestion, "sequence"> {
  return {
    itemType: "EQUATION",
    promptText: params.promptText,
    answerText: params.answerText,
    difficulty: params.difficulty,
    equation: params.equation,
    contentJson: {
      domain: params.domain,
      subtype: params.subtype,
      ...(params.contentJson ?? {}),
    },
    generatorMeta: {
      family: "secondary_maths",
      domain: params.domain,
      subtype: params.subtype,
    },
    generatorVersion: "canonical-secondary-maths-v1",
  };
}

function buildSimplifyExpressionItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "Simplify: 3x + 4x", answerText: "7x", difficulty: DifficultyBand.EASY, domain: "ALGEBRA", subtype: "SIMPLIFY_EXPRESSION", equation: "3x+4x" }),
    mathsQuestion({ promptText: "Simplify: 9a - 2a", answerText: "7a", difficulty: DifficultyBand.EASY, domain: "ALGEBRA", subtype: "SIMPLIFY_EXPRESSION", equation: "9a-2a" }),
    mathsQuestion({ promptText: "Simplify: 5y + 3y - y", answerText: "7y", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SIMPLIFY_EXPRESSION", equation: "5y+3y-y" }),
    mathsQuestion({ promptText: "Simplify: 4p + 2 - p + 7", answerText: "3p + 9", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SIMPLIFY_EXPRESSION", equation: "4p+2-p+7" }),
    mathsQuestion({ promptText: "Simplify: 6m - 2 + 4m + 9", answerText: "10m + 7", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SIMPLIFY_EXPRESSION", equation: "6m-2+4m+9" }),
    mathsQuestion({ promptText: "Simplify: 7x + 5 - 2x - 3", answerText: "5x + 2", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SIMPLIFY_EXPRESSION", equation: "7x+5-2x-3" }),
    mathsQuestion({ promptText: "Simplify: 8a - 3a + 4 - 9", answerText: "5a - 5", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SIMPLIFY_EXPRESSION", equation: "8a-3a+4-9" }),
    mathsQuestion({ promptText: "Simplify: 2x + x + 3 + 6", answerText: "3x + 9", difficulty: DifficultyBand.EASY, domain: "ALGEBRA", subtype: "SIMPLIFY_EXPRESSION", equation: "2x+x+3+6" }),
    mathsQuestion({ promptText: "Simplify: 10b - 4b + 1", answerText: "6b + 1", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SIMPLIFY_EXPRESSION", equation: "10b-4b+1" }),
    mathsQuestion({ promptText: "Simplify: 12n - 5n - 2 + 8", answerText: "7n + 6", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SIMPLIFY_EXPRESSION", equation: "12n-5n-2+8" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildSolveLinearOneStepItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "Solve: x + 7 = 15", answerText: "8", difficulty: DifficultyBand.EASY, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_ONE_STEP", equation: "x+7=15" }),
    mathsQuestion({ promptText: "Solve: x - 4 = 9", answerText: "13", difficulty: DifficultyBand.EASY, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_ONE_STEP", equation: "x-4=9" }),
    mathsQuestion({ promptText: "Solve: 3x = 21", answerText: "7", difficulty: DifficultyBand.EASY, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_ONE_STEP", equation: "3x=21" }),
    mathsQuestion({ promptText: "Solve: 5x = 45", answerText: "9", difficulty: DifficultyBand.EASY, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_ONE_STEP", equation: "5x=45" }),
    mathsQuestion({ promptText: "Solve: y ÷ 4 = 6", answerText: "24", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_ONE_STEP", equation: "y/4=6" }),
    mathsQuestion({ promptText: "Solve: a + 13 = 30", answerText: "17", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_ONE_STEP", equation: "a+13=30" }),
    mathsQuestion({ promptText: "Solve: p - 12 = 18", answerText: "30", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_ONE_STEP", equation: "p-12=18" }),
    mathsQuestion({ promptText: "Solve: 8m = 56", answerText: "7", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_ONE_STEP", equation: "8m=56" }),
    mathsQuestion({ promptText: "Solve: n/5 = 11", answerText: "55", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_ONE_STEP", equation: "n/5=11" }),
    mathsQuestion({ promptText: "Solve: 12 + t = 31", answerText: "19", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_ONE_STEP", equation: "12+t=31" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildSolveLinearTwoStepItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "Solve: 2x + 5 = 15", answerText: "5", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_TWO_STEP", equation: "2x+5=15" }),
    mathsQuestion({ promptText: "Solve: 3x - 4 = 20", answerText: "8", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_TWO_STEP", equation: "3x-4=20" }),
    mathsQuestion({ promptText: "Solve: 4x + 3 = 27", answerText: "6", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_TWO_STEP", equation: "4x+3=27" }),
    mathsQuestion({ promptText: "Solve: 5x - 10 = 20", answerText: "6", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_TWO_STEP", equation: "5x-10=20" }),
    mathsQuestion({ promptText: "Solve: 7x + 2 = 23", answerText: "3", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_TWO_STEP", equation: "7x+2=23" }),
    mathsQuestion({ promptText: "Solve: 6x - 5 = 25", answerText: "5", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_TWO_STEP", equation: "6x-5=25" }),
    mathsQuestion({ promptText: "Solve: 9 + 2x = 19", answerText: "5", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_TWO_STEP", equation: "9+2x=19" }),
    mathsQuestion({ promptText: "Solve: 3x + 11 = 29", answerText: "6", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_TWO_STEP", equation: "3x+11=29" }),
    mathsQuestion({ promptText: "Solve: 8x - 7 = 41", answerText: "6", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_TWO_STEP", equation: "8x-7=41" }),
    mathsQuestion({ promptText: "Solve: 10 + 4x = 34", answerText: "6", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SOLVE_LINEAR_TWO_STEP", equation: "10+4x=34" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildSolveQuadraticFoundationItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "Solve: x² = 49", answerText: "7 or -7", difficulty: DifficultyBand.EASY, domain: "ALGEBRA", subtype: "SOLVE_QUADRATIC_FOUNDATION", equation: "x^2=49" }),
    mathsQuestion({ promptText: "Solve: x² = 36", answerText: "6 or -6", difficulty: DifficultyBand.EASY, domain: "ALGEBRA", subtype: "SOLVE_QUADRATIC_FOUNDATION", equation: "x^2=36" }),
    mathsQuestion({ promptText: "Solve: x² - 9 = 0", answerText: "3 or -3", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_QUADRATIC_FOUNDATION", equation: "x^2-9=0" }),
    mathsQuestion({ promptText: "Solve: x² - 16 = 0", answerText: "4 or -4", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_QUADRATIC_FOUNDATION", equation: "x^2-16=0" }),
    mathsQuestion({ promptText: "Solve: x² + 5x + 6 = 0", answerText: "-2 or -3", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_QUADRATIC_FOUNDATION", equation: "x^2+5x+6=0" }),
    mathsQuestion({ promptText: "Solve: x² - 5x + 6 = 0", answerText: "2 or 3", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_QUADRATIC_FOUNDATION", equation: "x^2-5x+6=0" }),
    mathsQuestion({ promptText: "Solve: x² + 7x + 12 = 0", answerText: "-3 or -4", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SOLVE_QUADRATIC_FOUNDATION", equation: "x^2+7x+12=0" }),
    mathsQuestion({ promptText: "Solve: x² - x - 12 = 0", answerText: "4 or -3", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SOLVE_QUADRATIC_FOUNDATION", equation: "x^2-x-12=0" }),
    mathsQuestion({ promptText: "Solve: x² + x - 20 = 0", answerText: "4 or -5", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SOLVE_QUADRATIC_FOUNDATION", equation: "x^2+x-20=0" }),
    mathsQuestion({ promptText: "Solve: x² - 2x - 15 = 0", answerText: "5 or -3", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SOLVE_QUADRATIC_FOUNDATION", equation: "x^2-2x-15=0" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildSolveInequalityFoundationItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "Solve: x + 4 > 9", answerText: "x > 5", difficulty: DifficultyBand.EASY, domain: "ALGEBRA", subtype: "SOLVE_INEQUALITY_FOUNDATION", equation: "x+4>9" }),
    mathsQuestion({ promptText: "Solve: x - 3 < 7", answerText: "x < 10", difficulty: DifficultyBand.EASY, domain: "ALGEBRA", subtype: "SOLVE_INEQUALITY_FOUNDATION", equation: "x-3<7" }),
    mathsQuestion({ promptText: "Solve: 2x > 14", answerText: "x > 7", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_INEQUALITY_FOUNDATION", equation: "2x>14" }),
    mathsQuestion({ promptText: "Solve: 3x <= 18", answerText: "x <= 6", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_INEQUALITY_FOUNDATION", equation: "3x<=18" }),
    mathsQuestion({ promptText: "Solve: 5x - 10 >= 20", answerText: "x >= 6", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_INEQUALITY_FOUNDATION", equation: "5x-10>=20" }),
    mathsQuestion({ promptText: "Solve: 4x + 3 < 19", answerText: "x < 4", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SOLVE_INEQUALITY_FOUNDATION", equation: "4x+3<19" }),
    mathsQuestion({ promptText: "Solve: -x > 5", answerText: "x < -5", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SOLVE_INEQUALITY_FOUNDATION", equation: "-x>5" }),
    mathsQuestion({ promptText: "Solve: -2x <= 8", answerText: "x >= -4", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SOLVE_INEQUALITY_FOUNDATION", equation: "-2x<=8" }),
    mathsQuestion({ promptText: "Solve: 7 - x < 1", answerText: "x > 6", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SOLVE_INEQUALITY_FOUNDATION", equation: "7-x<1" }),
    mathsQuestion({ promptText: "Solve: 2 - 3x >= -10", answerText: "x <= 4", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SOLVE_INEQUALITY_FOUNDATION", equation: "2-3x>=-10" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildExpandSingleBracketItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "Expand: 3(x + 4)", answerText: "3x + 12", difficulty: DifficultyBand.EASY, domain: "ALGEBRA", subtype: "EXPAND_SINGLE_BRACKET", equation: "3(x+4)" }),
    mathsQuestion({ promptText: "Expand: 5(x - 2)", answerText: "5x - 10", difficulty: DifficultyBand.EASY, domain: "ALGEBRA", subtype: "EXPAND_SINGLE_BRACKET", equation: "5(x-2)" }),
    mathsQuestion({ promptText: "Expand: 2(a + 7)", answerText: "2a + 14", difficulty: DifficultyBand.EASY, domain: "ALGEBRA", subtype: "EXPAND_SINGLE_BRACKET", equation: "2(a+7)" }),
    mathsQuestion({ promptText: "Expand: 4(y - 3)", answerText: "4y - 12", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "EXPAND_SINGLE_BRACKET", equation: "4(y-3)" }),
    mathsQuestion({ promptText: "Expand: 6(2x + 1)", answerText: "12x + 6", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "EXPAND_SINGLE_BRACKET", equation: "6(2x+1)" }),
    mathsQuestion({ promptText: "Expand: 3(2p - 5)", answerText: "6p - 15", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "EXPAND_SINGLE_BRACKET", equation: "3(2p-5)" }),
    mathsQuestion({ promptText: "Expand: -2(x + 4)", answerText: "-2x - 8", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "EXPAND_SINGLE_BRACKET", equation: "-2(x+4)" }),
    mathsQuestion({ promptText: "Expand: -3(2m - 1)", answerText: "-6m + 3", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "EXPAND_SINGLE_BRACKET", equation: "-3(2m-1)" }),
    mathsQuestion({ promptText: "Expand: 7(t + 3)", answerText: "7t + 21", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "EXPAND_SINGLE_BRACKET", equation: "7(t+3)" }),
    mathsQuestion({ promptText: "Expand: 4(3q - 2)", answerText: "12q - 8", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "EXPAND_SINGLE_BRACKET", equation: "4(3q-2)" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildSubstituteIntoExpressionItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "Substitute x = 2 into 3x + 1", answerText: "7", difficulty: DifficultyBand.EASY, domain: "ALGEBRA", subtype: "SUBSTITUTE_INTO_EXPRESSION", equation: "3x+1" }),
    mathsQuestion({ promptText: "Substitute y = 5 into 2y - 4", answerText: "6", difficulty: DifficultyBand.EASY, domain: "ALGEBRA", subtype: "SUBSTITUTE_INTO_EXPRESSION", equation: "2y-4" }),
    mathsQuestion({ promptText: "Substitute a = 3 into a² + 2", answerText: "11", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SUBSTITUTE_INTO_EXPRESSION", equation: "a^2+2" }),
    mathsQuestion({ promptText: "Substitute n = 4 into 5n - 6", answerText: "14", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SUBSTITUTE_INTO_EXPRESSION", equation: "5n-6" }),
    mathsQuestion({ promptText: "Substitute p = 2 into 4p²", answerText: "16", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SUBSTITUTE_INTO_EXPRESSION", equation: "4p^2" }),
    mathsQuestion({ promptText: "Substitute x = 3 into x² + 4x", answerText: "21", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SUBSTITUTE_INTO_EXPRESSION", equation: "x^2+4x" }),
    mathsQuestion({ promptText: "Substitute t = -2 into 3t + 7", answerText: "1", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SUBSTITUTE_INTO_EXPRESSION", equation: "3t+7" }),
    mathsQuestion({ promptText: "Substitute m = -1 into m² + 5", answerText: "6", difficulty: DifficultyBand.HARD, domain: "ALGEBRA", subtype: "SUBSTITUTE_INTO_EXPRESSION", equation: "m^2+5" }),
    mathsQuestion({ promptText: "Substitute k = 6 into 2k + 3", answerText: "15", difficulty: DifficultyBand.EASY, domain: "ALGEBRA", subtype: "SUBSTITUTE_INTO_EXPRESSION", equation: "2k+3" }),
    mathsQuestion({ promptText: "Substitute b = 4 into b² - 7", answerText: "9", difficulty: DifficultyBand.MEDIUM, domain: "ALGEBRA", subtype: "SUBSTITUTE_INTO_EXPRESSION", equation: "b^2-7" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildLinearSequenceTermItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "Find the next term: 3, 6, 9, 12, ...", answerText: "15", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "LINEAR_SEQUENCE_TERM" }),
    mathsQuestion({ promptText: "Find the next term: 5, 8, 11, 14, ...", answerText: "17", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "LINEAR_SEQUENCE_TERM" }),
    mathsQuestion({ promptText: "Find the next term: 20, 17, 14, 11, ...", answerText: "8", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "LINEAR_SEQUENCE_TERM" }),
    mathsQuestion({ promptText: "Find the next term: -1, 2, 5, 8, ...", answerText: "11", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "LINEAR_SEQUENCE_TERM" }),
    mathsQuestion({ promptText: "Find the next term: 7, 14, 21, 28, ...", answerText: "35", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "LINEAR_SEQUENCE_TERM" }),
    mathsQuestion({ promptText: "Find the next term: 50, 45, 40, 35, ...", answerText: "30", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "LINEAR_SEQUENCE_TERM" }),
    mathsQuestion({ promptText: "Find the next term: 2, 5, 8, 11, ...", answerText: "14", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "LINEAR_SEQUENCE_TERM" }),
    mathsQuestion({ promptText: "Find the next term: 1.5, 2.5, 3.5, 4.5, ...", answerText: "5.5", difficulty: DifficultyBand.HARD, domain: "NUMBER", subtype: "LINEAR_SEQUENCE_TERM" }),
    mathsQuestion({ promptText: "Find the next term: 100, 90, 80, 70, ...", answerText: "60", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "LINEAR_SEQUENCE_TERM" }),
    mathsQuestion({ promptText: "Find the next term: -10, -5, 0, 5, ...", answerText: "10", difficulty: DifficultyBand.HARD, domain: "NUMBER", subtype: "LINEAR_SEQUENCE_TERM" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildDecimalOperationsFoundationItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "Calculate: 3.4 + 2.7", answerText: "6.1", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "DECIMAL_OPERATIONS_FOUNDATION", equation: "3.4+2.7" }),
    mathsQuestion({ promptText: "Calculate: 8.1 - 2.6", answerText: "5.5", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "DECIMAL_OPERATIONS_FOUNDATION", equation: "8.1-2.6" }),
    mathsQuestion({ promptText: "Calculate: 0.6 × 0.4", answerText: "0.24", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "DECIMAL_OPERATIONS_FOUNDATION", equation: "0.6*0.4" }),
    mathsQuestion({ promptText: "Calculate: 4.8 ÷ 0.6", answerText: "8", difficulty: DifficultyBand.HARD, domain: "NUMBER", subtype: "DECIMAL_OPERATIONS_FOUNDATION", equation: "4.8/0.6" }),
    mathsQuestion({ promptText: "Calculate: 12.5 + 7.35", answerText: "19.85", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "DECIMAL_OPERATIONS_FOUNDATION", equation: "12.5+7.35" }),
    mathsQuestion({ promptText: "Calculate: 9.2 - 4.78", answerText: "4.42", difficulty: DifficultyBand.HARD, domain: "NUMBER", subtype: "DECIMAL_OPERATIONS_FOUNDATION", equation: "9.2-4.78" }),
    mathsQuestion({ promptText: "Calculate: 1.2 × 3", answerText: "3.6", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "DECIMAL_OPERATIONS_FOUNDATION", equation: "1.2*3" }),
    mathsQuestion({ promptText: "Calculate: 7.5 ÷ 2.5", answerText: "3", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "DECIMAL_OPERATIONS_FOUNDATION", equation: "7.5/2.5" }),
    mathsQuestion({ promptText: "Calculate: 0.09 + 0.8", answerText: "0.89", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "DECIMAL_OPERATIONS_FOUNDATION", equation: "0.09+0.8" }),
    mathsQuestion({ promptText: "Calculate: 15.6 - 8.95", answerText: "6.65", difficulty: DifficultyBand.HARD, domain: "NUMBER", subtype: "DECIMAL_OPERATIONS_FOUNDATION", equation: "15.6-8.95" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildFractionOperationsFoundationItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "Calculate: 1/2 + 1/4", answerText: "3/4", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "FRACTION_OPERATIONS_FOUNDATION" }),
    mathsQuestion({ promptText: "Calculate: 3/4 - 1/4", answerText: "1/2", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "FRACTION_OPERATIONS_FOUNDATION" }),
    mathsQuestion({ promptText: "Calculate: 2/3 + 1/3", answerText: "1", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "FRACTION_OPERATIONS_FOUNDATION" }),
    mathsQuestion({ promptText: "Calculate: 5/6 - 1/6", answerText: "2/3", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "FRACTION_OPERATIONS_FOUNDATION" }),
    mathsQuestion({ promptText: "Calculate: 2/5 of 20", answerText: "8", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "FRACTION_OPERATIONS_FOUNDATION" }),
    mathsQuestion({ promptText: "Calculate: 3/8 of 24", answerText: "9", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "FRACTION_OPERATIONS_FOUNDATION" }),
    mathsQuestion({ promptText: "Calculate: 1/2 × 8", answerText: "4", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "FRACTION_OPERATIONS_FOUNDATION" }),
    mathsQuestion({ promptText: "Calculate: 3/4 of 16", answerText: "12", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "FRACTION_OPERATIONS_FOUNDATION" }),
    mathsQuestion({ promptText: "Calculate: 7/10 - 2/10", answerText: "1/2", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "FRACTION_OPERATIONS_FOUNDATION" }),
    mathsQuestion({ promptText: "Calculate: 1/3 of 27", answerText: "9", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "FRACTION_OPERATIONS_FOUNDATION" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildPercentageOfAmountItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "Find 10% of 50", answerText: "5", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "PERCENTAGE_OF_AMOUNT" }),
    mathsQuestion({ promptText: "Find 25% of 80", answerText: "20", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "PERCENTAGE_OF_AMOUNT" }),
    mathsQuestion({ promptText: "Find 50% of 34", answerText: "17", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "PERCENTAGE_OF_AMOUNT" }),
    mathsQuestion({ promptText: "Find 20% of 90", answerText: "18", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "PERCENTAGE_OF_AMOUNT" }),
    mathsQuestion({ promptText: "Find 15% of 200", answerText: "30", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "PERCENTAGE_OF_AMOUNT" }),
    mathsQuestion({ promptText: "Find 5% of 240", answerText: "12", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "PERCENTAGE_OF_AMOUNT" }),
    mathsQuestion({ promptText: "Find 12% of 150", answerText: "18", difficulty: DifficultyBand.HARD, domain: "NUMBER", subtype: "PERCENTAGE_OF_AMOUNT" }),
    mathsQuestion({ promptText: "Find 35% of 60", answerText: "21", difficulty: DifficultyBand.HARD, domain: "NUMBER", subtype: "PERCENTAGE_OF_AMOUNT" }),
    mathsQuestion({ promptText: "Find 1% of 700", answerText: "7", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "PERCENTAGE_OF_AMOUNT" }),
    mathsQuestion({ promptText: "Find 75% of 44", answerText: "33", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "PERCENTAGE_OF_AMOUNT" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildPercentageChangeFoundationItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "Increase 100 by 20%", answerText: "120", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "PERCENTAGE_CHANGE_FOUNDATION" }),
    mathsQuestion({ promptText: "Decrease 80 by 25%", answerText: "60", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "PERCENTAGE_CHANGE_FOUNDATION" }),
    mathsQuestion({ promptText: "Increase 50 by 10%", answerText: "55", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "PERCENTAGE_CHANGE_FOUNDATION" }),
    mathsQuestion({ promptText: "Decrease 200 by 5%", answerText: "190", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "PERCENTAGE_CHANGE_FOUNDATION" }),
    mathsQuestion({ promptText: "Increase 120 by 15%", answerText: "138", difficulty: DifficultyBand.HARD, domain: "NUMBER", subtype: "PERCENTAGE_CHANGE_FOUNDATION" }),
    mathsQuestion({ promptText: "Decrease 150 by 20%", answerText: "120", difficulty: DifficultyBand.MEDIUM, domain: "NUMBER", subtype: "PERCENTAGE_CHANGE_FOUNDATION" }),
    mathsQuestion({ promptText: "Increase 240 by 5%", answerText: "252", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "PERCENTAGE_CHANGE_FOUNDATION" }),
    mathsQuestion({ promptText: "Decrease 64 by 50%", answerText: "32", difficulty: DifficultyBand.EASY, domain: "NUMBER", subtype: "PERCENTAGE_CHANGE_FOUNDATION" }),
    mathsQuestion({ promptText: "Increase 90 by 30%", answerText: "117", difficulty: DifficultyBand.HARD, domain: "NUMBER", subtype: "PERCENTAGE_CHANGE_FOUNDATION" }),
    mathsQuestion({ promptText: "Decrease 300 by 12%", answerText: "264", difficulty: DifficultyBand.HARD, domain: "NUMBER", subtype: "PERCENTAGE_CHANGE_FOUNDATION" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildRatioShareItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "Split 30 in the ratio 2:3", answerText: "12 and 18", difficulty: DifficultyBand.EASY, domain: "RATIO", subtype: "RATIO_SHARE" }),
    mathsQuestion({ promptText: "Split £60 in the ratio 1:2", answerText: "£20 and £40", difficulty: DifficultyBand.EASY, domain: "RATIO", subtype: "RATIO_SHARE" }),
    mathsQuestion({ promptText: "Split 56 in the ratio 3:4", answerText: "24 and 32", difficulty: DifficultyBand.MEDIUM, domain: "RATIO", subtype: "RATIO_SHARE" }),
    mathsQuestion({ promptText: "Split £80 in the ratio 3:5", answerText: "£30 and £50", difficulty: DifficultyBand.MEDIUM, domain: "RATIO", subtype: "RATIO_SHARE" }),
    mathsQuestion({ promptText: "Split 72 in the ratio 5:7", answerText: "30 and 42", difficulty: DifficultyBand.HARD, domain: "RATIO", subtype: "RATIO_SHARE" }),
    mathsQuestion({ promptText: "Split 45 in the ratio 4:5", answerText: "20 and 25", difficulty: DifficultyBand.MEDIUM, domain: "RATIO", subtype: "RATIO_SHARE" }),
    mathsQuestion({ promptText: "Split 96 in the ratio 2:4:6", answerText: "16, 32, 48", difficulty: DifficultyBand.HARD, domain: "RATIO", subtype: "RATIO_SHARE" }),
    mathsQuestion({ promptText: "Split 40 in the ratio 1:4", answerText: "8 and 32", difficulty: DifficultyBand.EASY, domain: "RATIO", subtype: "RATIO_SHARE" }),
    mathsQuestion({ promptText: "Split 90 in the ratio 2:7", answerText: "20 and 70", difficulty: DifficultyBand.HARD, domain: "RATIO", subtype: "RATIO_SHARE" }),
    mathsQuestion({ promptText: "Split £54 in the ratio 4:5", answerText: "£24 and £30", difficulty: DifficultyBand.MEDIUM, domain: "RATIO", subtype: "RATIO_SHARE" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildRatioScaleItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "A recipe for 2 people uses 150g flour. How much for 6 people?", answerText: "450g", difficulty: DifficultyBand.EASY, domain: "RATIO", subtype: "RATIO_SCALE" }),
    mathsQuestion({ promptText: "A map uses scale 1cm : 5km. What distance is 4cm?", answerText: "20km", difficulty: DifficultyBand.EASY, domain: "RATIO", subtype: "RATIO_SCALE" }),
    mathsQuestion({ promptText: "5 books cost £15. What is the cost of 8 books at the same rate?", answerText: "£24", difficulty: DifficultyBand.MEDIUM, domain: "RATIO", subtype: "RATIO_SCALE" }),
    mathsQuestion({ promptText: "3 pens cost £4.50. What do 7 pens cost?", answerText: "£10.50", difficulty: DifficultyBand.MEDIUM, domain: "RATIO", subtype: "RATIO_SCALE" }),
    mathsQuestion({ promptText: "A car travels 120 miles on 4 gallons. How far on 7 gallons?", answerText: "210 miles", difficulty: DifficultyBand.HARD, domain: "RATIO", subtype: "RATIO_SCALE" }),
    mathsQuestion({ promptText: "2kg of apples cost £3.60. What is the cost of 5kg?", answerText: "£9", difficulty: DifficultyBand.MEDIUM, domain: "RATIO", subtype: "RATIO_SCALE" }),
    mathsQuestion({ promptText: "A scale drawing uses 1cm : 8m. What real distance is 6cm?", answerText: "48m", difficulty: DifficultyBand.EASY, domain: "RATIO", subtype: "RATIO_SCALE" }),
    mathsQuestion({ promptText: "If 4 workers paint 1 wall in 3 hours, how many wall-hours is that?", answerText: "12", difficulty: DifficultyBand.HARD, domain: "RATIO", subtype: "RATIO_SCALE" }),
    mathsQuestion({ promptText: "8 oranges cost £2.40. What do 15 oranges cost?", answerText: "£4.50", difficulty: DifficultyBand.HARD, domain: "RATIO", subtype: "RATIO_SCALE" }),
    mathsQuestion({ promptText: "250ml of paint covers 5m². How much paint for 12m²?", answerText: "600ml", difficulty: DifficultyBand.HARD, domain: "RATIO", subtype: "RATIO_SCALE" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildScaleDrawingsFoundationItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "A map uses scale 1cm : 5km. What distance is 4cm?", answerText: "20km", difficulty: DifficultyBand.EASY, domain: "RATIO", subtype: "SCALE_DRAWINGS_FOUNDATION" }),
    mathsQuestion({ promptText: "A scale drawing uses 1cm : 8m. What real distance is 6cm?", answerText: "48m", difficulty: DifficultyBand.EASY, domain: "RATIO", subtype: "SCALE_DRAWINGS_FOUNDATION" }),
    mathsQuestion({ promptText: "A map uses scale 1cm : 3km. What distance is 7cm?", answerText: "21km", difficulty: DifficultyBand.EASY, domain: "RATIO", subtype: "SCALE_DRAWINGS_FOUNDATION" }),
    mathsQuestion({ promptText: "A plan uses scale 1cm : 25cm. A line is 6cm on the plan. What is the real length?", answerText: "150cm", difficulty: DifficultyBand.MEDIUM, domain: "RATIO", subtype: "SCALE_DRAWINGS_FOUNDATION" }),
    mathsQuestion({ promptText: "A map uses scale 1cm : 4km. What distance is 9cm?", answerText: "36km", difficulty: DifficultyBand.MEDIUM, domain: "RATIO", subtype: "SCALE_DRAWINGS_FOUNDATION" }),
    mathsQuestion({ promptText: "A scale drawing uses 2cm : 7m. What real distance is 8cm?", answerText: "28m", difficulty: DifficultyBand.MEDIUM, domain: "RATIO", subtype: "SCALE_DRAWINGS_FOUNDATION" }),
    mathsQuestion({ promptText: "A map uses scale 2cm : 9km. What real distance is 10cm?", answerText: "45km", difficulty: DifficultyBand.MEDIUM, domain: "RATIO", subtype: "SCALE_DRAWINGS_FOUNDATION" }),
    mathsQuestion({ promptText: "A scale drawing uses 3cm : 12m. What real distance is 15cm?", answerText: "60m", difficulty: DifficultyBand.HARD, domain: "RATIO", subtype: "SCALE_DRAWINGS_FOUNDATION" }),
    mathsQuestion({ promptText: "A map uses scale 5cm : 20km. What real distance is 17.5cm?", answerText: "70km", difficulty: DifficultyBand.HARD, domain: "RATIO", subtype: "SCALE_DRAWINGS_FOUNDATION" }),
    mathsQuestion({ promptText: "A floor plan uses scale 2cm : 1m. A wall measures 11cm on the plan. What is the real wall length?", answerText: "5.5m", difficulty: DifficultyBand.HARD, domain: "RATIO", subtype: "SCALE_DRAWINGS_FOUNDATION" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildAngleFactsFoundationItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "Angles in a triangle add up to?", answerText: "180", difficulty: DifficultyBand.EASY, domain: "GEOMETRY", subtype: "ANGLE_FACTS_FOUNDATION" }),
    mathsQuestion({ promptText: "Angles on a straight line add up to?", answerText: "180", difficulty: DifficultyBand.EASY, domain: "GEOMETRY", subtype: "ANGLE_FACTS_FOUNDATION" }),
    mathsQuestion({ promptText: "Angles around a point add up to?", answerText: "360", difficulty: DifficultyBand.EASY, domain: "GEOMETRY", subtype: "ANGLE_FACTS_FOUNDATION" }),
    mathsQuestion({ promptText: "Find x: 90 + x = 180", answerText: "90", difficulty: DifficultyBand.EASY, domain: "GEOMETRY", subtype: "ANGLE_FACTS_FOUNDATION" }),
    mathsQuestion({ promptText: "Find x: 50 + 60 + x = 180", answerText: "70", difficulty: DifficultyBand.MEDIUM, domain: "GEOMETRY", subtype: "ANGLE_FACTS_FOUNDATION" }),
    mathsQuestion({ promptText: "Find x: x + 110 = 180", answerText: "70", difficulty: DifficultyBand.EASY, domain: "GEOMETRY", subtype: "ANGLE_FACTS_FOUNDATION" }),
    mathsQuestion({ promptText: "Find x: 130 + x = 360", answerText: "230", difficulty: DifficultyBand.MEDIUM, domain: "GEOMETRY", subtype: "ANGLE_FACTS_FOUNDATION" }),
    mathsQuestion({ promptText: "An isosceles triangle has one angle of 40° at the top. What is each base angle?", answerText: "70", difficulty: DifficultyBand.HARD, domain: "GEOMETRY", subtype: "ANGLE_FACTS_FOUNDATION" }),
    mathsQuestion({ promptText: "Two vertically opposite angles are equal. If one is 115°, what is the other?", answerText: "115", difficulty: DifficultyBand.EASY, domain: "GEOMETRY", subtype: "ANGLE_FACTS_FOUNDATION" }),
    mathsQuestion({ promptText: "In a quadrilateral, angles add up to?", answerText: "360", difficulty: DifficultyBand.MEDIUM, domain: "GEOMETRY", subtype: "ANGLE_FACTS_FOUNDATION" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildAreaPerimeterFoundationItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "Find the area of a rectangle with length 5cm and width 8cm", answerText: "40cm²", difficulty: DifficultyBand.EASY, domain: "GEOMETRY", subtype: "AREA_PERIMETER_FOUNDATION" }),
    mathsQuestion({ promptText: "Find the perimeter of a square with side 6cm", answerText: "24cm", difficulty: DifficultyBand.EASY, domain: "GEOMETRY", subtype: "AREA_PERIMETER_FOUNDATION" }),
    mathsQuestion({ promptText: "Find the perimeter of a rectangle 7cm by 4cm", answerText: "22cm", difficulty: DifficultyBand.EASY, domain: "GEOMETRY", subtype: "AREA_PERIMETER_FOUNDATION" }),
    mathsQuestion({ promptText: "Find the area of a triangle with base 10cm and height 6cm", answerText: "30cm²", difficulty: DifficultyBand.MEDIUM, domain: "GEOMETRY", subtype: "AREA_PERIMETER_FOUNDATION" }),
    mathsQuestion({ promptText: "Find the area of a parallelogram with base 9cm and height 4cm", answerText: "36cm²", difficulty: DifficultyBand.MEDIUM, domain: "GEOMETRY", subtype: "AREA_PERIMETER_FOUNDATION" }),
    mathsQuestion({ promptText: "Find the area of a rectangle 12m by 3m", answerText: "36m²", difficulty: DifficultyBand.EASY, domain: "GEOMETRY", subtype: "AREA_PERIMETER_FOUNDATION" }),
    mathsQuestion({ promptText: "A rectangle has area 42cm² and width 6cm. Find the length.", answerText: "7cm", difficulty: DifficultyBand.HARD, domain: "GEOMETRY", subtype: "AREA_PERIMETER_FOUNDATION" }),
    mathsQuestion({ promptText: "A square has perimeter 28cm. Find the side length.", answerText: "7cm", difficulty: DifficultyBand.MEDIUM, domain: "GEOMETRY", subtype: "AREA_PERIMETER_FOUNDATION" }),
    mathsQuestion({ promptText: "Find the area of a triangle with base 14cm and height 5cm", answerText: "35cm²", difficulty: DifficultyBand.MEDIUM, domain: "GEOMETRY", subtype: "AREA_PERIMETER_FOUNDATION" }),
    mathsQuestion({ promptText: "Find the perimeter of a rectangle 11cm by 9cm", answerText: "40cm", difficulty: DifficultyBand.EASY, domain: "GEOMETRY", subtype: "AREA_PERIMETER_FOUNDATION" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildCircumferenceAreaCircleFoundationItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "Use π = 3.14. Find the circumference of a circle with radius 5cm", answerText: "31.4cm", difficulty: DifficultyBand.MEDIUM, domain: "GEOMETRY", subtype: "CIRCUMFERENCE_AREA_CIRCLE_FOUNDATION" }),
    mathsQuestion({ promptText: "Use π = 3.14. Find the area of a circle with radius 3cm", answerText: "28.26cm²", difficulty: DifficultyBand.MEDIUM, domain: "GEOMETRY", subtype: "CIRCUMFERENCE_AREA_CIRCLE_FOUNDATION" }),
    mathsQuestion({ promptText: "Use π = 3.14. Find the circumference of a circle with diameter 10cm", answerText: "31.4cm", difficulty: DifficultyBand.EASY, domain: "GEOMETRY", subtype: "CIRCUMFERENCE_AREA_CIRCLE_FOUNDATION" }),
    mathsQuestion({ promptText: "Use π = 3.14. Find the area of a circle with radius 4cm", answerText: "50.24cm²", difficulty: DifficultyBand.MEDIUM, domain: "GEOMETRY", subtype: "CIRCUMFERENCE_AREA_CIRCLE_FOUNDATION" }),
    mathsQuestion({ promptText: "Use π = 3.14. Find the circumference of a circle with radius 7cm", answerText: "43.96cm", difficulty: DifficultyBand.HARD, domain: "GEOMETRY", subtype: "CIRCUMFERENCE_AREA_CIRCLE_FOUNDATION" }),
    mathsQuestion({ promptText: "Use π = 3.14. Find the area of a circle with radius 6cm", answerText: "113.04cm²", difficulty: DifficultyBand.HARD, domain: "GEOMETRY", subtype: "CIRCUMFERENCE_AREA_CIRCLE_FOUNDATION" }),
    mathsQuestion({ promptText: "A circle has diameter 8cm. Use π = 3.14. Find the circumference.", answerText: "25.12cm", difficulty: DifficultyBand.EASY, domain: "GEOMETRY", subtype: "CIRCUMFERENCE_AREA_CIRCLE_FOUNDATION" }),
    mathsQuestion({ promptText: "A circle has diameter 12cm. Use π = 3.14. Find the radius.", answerText: "6cm", difficulty: DifficultyBand.EASY, domain: "GEOMETRY", subtype: "CIRCUMFERENCE_AREA_CIRCLE_FOUNDATION" }),
    mathsQuestion({ promptText: "Use π = 3.14. Find the area of a circle with diameter 10cm", answerText: "78.5cm²", difficulty: DifficultyBand.HARD, domain: "GEOMETRY", subtype: "CIRCUMFERENCE_AREA_CIRCLE_FOUNDATION" }),
    mathsQuestion({ promptText: "Use π = 3.14. Find the circumference of a circle with diameter 14cm", answerText: "43.96cm", difficulty: DifficultyBand.HARD, domain: "GEOMETRY", subtype: "CIRCUMFERENCE_AREA_CIRCLE_FOUNDATION" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildPythagorasFoundationItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "A right-angled triangle has shorter sides 3cm and 4cm. Find the hypotenuse.", answerText: "5cm", difficulty: DifficultyBand.EASY, domain: "GEOMETRY", subtype: "PYTHAGORAS_FOUNDATION" }),
    mathsQuestion({ promptText: "A right-angled triangle has shorter sides 5cm and 12cm. Find the hypotenuse.", answerText: "13cm", difficulty: DifficultyBand.MEDIUM, domain: "GEOMETRY", subtype: "PYTHAGORAS_FOUNDATION" }),
    mathsQuestion({ promptText: "A right-angled triangle has shorter sides 8cm and 15cm. Find the hypotenuse.", answerText: "17cm", difficulty: DifficultyBand.MEDIUM, domain: "GEOMETRY", subtype: "PYTHAGORAS_FOUNDATION" }),
    mathsQuestion({ promptText: "A right-angled triangle has hypotenuse 10cm and one shorter side 6cm. Find the other shorter side.", answerText: "8cm", difficulty: DifficultyBand.MEDIUM, domain: "GEOMETRY", subtype: "PYTHAGORAS_FOUNDATION" }),
    mathsQuestion({ promptText: "A right-angled triangle has hypotenuse 25cm and one shorter side 7cm. Find the other shorter side.", answerText: "24cm", difficulty: DifficultyBand.HARD, domain: "GEOMETRY", subtype: "PYTHAGORAS_FOUNDATION" }),
    mathsQuestion({ promptText: "A ladder is 13m long and reaches 12m up a wall. How far is the base from the wall?", answerText: "5m", difficulty: DifficultyBand.HARD, domain: "GEOMETRY", subtype: "PYTHAGORAS_FOUNDATION" }),
    mathsQuestion({ promptText: "A square has side 6cm. Find its diagonal to 1 decimal place.", answerText: "8.5cm", difficulty: DifficultyBand.HARD, domain: "GEOMETRY", subtype: "PYTHAGORAS_FOUNDATION" }),
    mathsQuestion({ promptText: "A right-angled triangle has shorter sides 9cm and 12cm. Find the hypotenuse.", answerText: "15cm", difficulty: DifficultyBand.MEDIUM, domain: "GEOMETRY", subtype: "PYTHAGORAS_FOUNDATION" }),
    mathsQuestion({ promptText: "A right-angled triangle has hypotenuse 17cm and one shorter side 8cm. Find the other shorter side.", answerText: "15cm", difficulty: DifficultyBand.MEDIUM, domain: "GEOMETRY", subtype: "PYTHAGORAS_FOUNDATION" }),
    mathsQuestion({ promptText: "A rectangle is 9cm by 12cm. Find the diagonal.", answerText: "15cm", difficulty: DifficultyBand.MEDIUM, domain: "GEOMETRY", subtype: "PYTHAGORAS_FOUNDATION" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildMeanMedianModeRangeItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "Find the mean of 4, 6, 8", answerText: "6", difficulty: DifficultyBand.EASY, domain: "DATA", subtype: "MEAN_MEDIAN_MODE_RANGE" }),
    mathsQuestion({ promptText: "Find the mode of 2, 3, 3, 5", answerText: "3", difficulty: DifficultyBand.EASY, domain: "DATA", subtype: "MEAN_MEDIAN_MODE_RANGE" }),
    mathsQuestion({ promptText: "Find the range of 10, 4, 7", answerText: "6", difficulty: DifficultyBand.EASY, domain: "DATA", subtype: "MEAN_MEDIAN_MODE_RANGE" }),
    mathsQuestion({ promptText: "Find the median of 3, 5, 7, 9, 11", answerText: "7", difficulty: DifficultyBand.EASY, domain: "DATA", subtype: "MEAN_MEDIAN_MODE_RANGE" }),
    mathsQuestion({ promptText: "Find the mean of 10, 12, 15, 23", answerText: "15", difficulty: DifficultyBand.MEDIUM, domain: "DATA", subtype: "MEAN_MEDIAN_MODE_RANGE" }),
    mathsQuestion({ promptText: "Find the range of 18, 4, 9, 12, 20", answerText: "16", difficulty: DifficultyBand.MEDIUM, domain: "DATA", subtype: "MEAN_MEDIAN_MODE_RANGE" }),
    mathsQuestion({ promptText: "Find the median of 2, 4, 8, 10", answerText: "6", difficulty: DifficultyBand.MEDIUM, domain: "DATA", subtype: "MEAN_MEDIAN_MODE_RANGE" }),
    mathsQuestion({ promptText: "Find the mode of 1, 1, 2, 3, 3, 3, 4", answerText: "3", difficulty: DifficultyBand.EASY, domain: "DATA", subtype: "MEAN_MEDIAN_MODE_RANGE" }),
    mathsQuestion({ promptText: "The mean of five numbers is 12. What is their total?", answerText: "60", difficulty: DifficultyBand.HARD, domain: "DATA", subtype: "MEAN_MEDIAN_MODE_RANGE" }),
    mathsQuestion({ promptText: "Find the mean of 2.5, 3.5, 4.5, 5.5", answerText: "4", difficulty: DifficultyBand.HARD, domain: "DATA", subtype: "MEAN_MEDIAN_MODE_RANGE" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildProbabilityFoundationItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool = [
    mathsQuestion({ promptText: "A fair coin is tossed. What is the probability of heads?", answerText: "1/2", difficulty: DifficultyBand.EASY, domain: "DATA", subtype: "PROBABILITY_FOUNDATION" }),
    mathsQuestion({ promptText: "A fair six-sided die is rolled. What is the probability of getting a 4?", answerText: "1/6", difficulty: DifficultyBand.EASY, domain: "DATA", subtype: "PROBABILITY_FOUNDATION" }),
    mathsQuestion({ promptText: "A jar has 3 star tokens and 2 circle tokens. What is the probability of picking a circle token?", answerText: "2/5", difficulty: DifficultyBand.EASY, domain: "DATA", subtype: "PROBABILITY_FOUNDATION" }),
    mathsQuestion({ promptText: "A bag has 5 green and 5 yellow counters. What is the probability of green?", answerText: "1/2", difficulty: DifficultyBand.EASY, domain: "DATA", subtype: "PROBABILITY_FOUNDATION" }),
    mathsQuestion({ promptText: "A spinner has 8 equal sections. 3 show a sun. What is the probability of landing on the sun?", answerText: "3/8", difficulty: DifficultyBand.MEDIUM, domain: "DATA", subtype: "PROBABILITY_FOUNDATION" }),
    mathsQuestion({ promptText: "A bag has 4 black, 1 white and 5 orange counters. What is the probability of white?", answerText: "1/10", difficulty: DifficultyBand.MEDIUM, domain: "DATA", subtype: "PROBABILITY_FOUNDATION" }),
    mathsQuestion({ promptText: "A fair die is rolled. What is the probability of an even number?", answerText: "1/2", difficulty: DifficultyBand.EASY, domain: "DATA", subtype: "PROBABILITY_FOUNDATION" }),
    mathsQuestion({ promptText: "A number tile from 1 to 10 is picked at random. What is the probability of picking a prime number?", answerText: "2/5", difficulty: DifficultyBand.HARD, domain: "DATA", subtype: "PROBABILITY_FOUNDATION" }),
    mathsQuestion({ promptText: "A box has 7 striped counters and 13 plain counters. What is the probability of picking a striped counter?", answerText: "7/20", difficulty: DifficultyBand.HARD, domain: "DATA", subtype: "PROBABILITY_FOUNDATION" }),
    mathsQuestion({ promptText: "A fair die is rolled. What is the probability of getting a number greater than 4?", answerText: "1/3", difficulty: DifficultyBand.MEDIUM, domain: "DATA", subtype: "PROBABILITY_FOUNDATION" }),
  ];

  return withSequence(takeTargetCount(pool, count));
}

function buildYear3TimesTablesItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (const a of [3, 4, 8]) {
    for (let b = 1; b <= 12; b += 1) {
      const product = a * b;
      const difficulty =
        b <= 4 ? DifficultyBand.EASY : b <= 8 ? DifficultyBand.MEDIUM : DifficultyBand.HARD;

      pool.push(
        makeQuestion({
          itemType: "EQUATION",
          promptText: buildCalculationPrompt(`${a} x ${b}`),
          answerText: String(product),
          difficulty,
          contentJson: { domain: "times_tables_y3", a, b, result: product, operator: "x" },
        })
      );

      pool.push(
        makeQuestion({
          itemType: "EQUATION",
          promptText: buildCalculationPrompt(`${product} / ${a}`),
          answerText: String(b),
          difficulty,
          contentJson: { domain: "times_tables_y3", a: product, b: a, result: b, operator: "/" },
        })
      );
    }
  }

  return withSequence(
    pickSpread(stableSort(pool, (item) => `${item.promptText}|${item.answerText}`), count)
  );
}

function buildYear3CountMultiplesItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const steps = [4, 8, 50, 100];
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (const step of steps) {
    for (let startIndex = 0; startIndex <= 5; startIndex += 1) {
      const start = step * startIndex;
      const values = Array.from({ length: 5 }, (_, index) => start + step * index);
      pool.push(
        makeQuestion({
          itemType: "NUMBER_SEQUENCE",
          promptText: buildNextNumberPrompt(values.slice(0, 4)),
          answerText: String(values[4]),
          difficulty:
            step <= 8 ? DifficultyBand.EASY : step === 50 ? DifficultyBand.MEDIUM : DifficultyBand.HARD,
          contentJson: { domain: "count_multiples_y3", step, start, answer: values[4] },
        })
      );
    }
  }

  return withSequence(
    pickSpread(stableSort(pool, (item) => `${item.promptText}|${item.answerText}`), count)
  );
}

function buildYear3MultiplyDivideItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (const a of [3, 4, 6, 7, 8, 9]) {
    for (let b = 2; b <= 12; b += 1) {
      const product = a * b;
      pool.push(
        makeQuestion({
          itemType: "EQUATION",
          promptText: buildCalculationPrompt(`${a} x ${b}`),
          answerText: String(product),
          difficulty: b <= 4 ? DifficultyBand.EASY : b <= 8 ? DifficultyBand.MEDIUM : DifficultyBand.HARD,
          contentJson: { domain: "multiply_divide_y3", a, b, result: product, operator: "x" },
        })
      );

      pool.push(
        makeQuestion({
          itemType: "MISSING_NUMBER",
          promptText: `Complete the number sentence: ${a} x __ = ${product}.`,
          answerText: String(b),
          difficulty: b <= 4 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
          contentJson: { domain: "multiply_divide_y3", a, result: product, answer: b },
        })
      );
    }
  }

  return withSequence(
    pickSpread(stableSort(pool, (item) => `${item.promptText}|${item.answerText}`), count)
  );
}

function buildYear3PlaceValueItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const places = [
    { label: "hundreds", divisor: 100 },
    { label: "tens", divisor: 10 },
    { label: "ones", divisor: 1 },
  ];
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (let number = 124; number <= 986; number += 97) {
    for (const place of places) {
      const digit = Math.floor(number / place.divisor) % 10;
      pool.push(
        makeQuestion({
          itemType: "EQUATION",
          promptText: `What digit is in the ${place.label} place in ${number}?`,
          answerText: String(digit),
          difficulty: place.divisor === 100 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
          contentJson: { domain: "place_value_y3", number, place: place.label, answer: digit },
        })
      );
    }
  }

  return withSequence(
    pickSpread(stableSort(pool, (item) => `${item.promptText}|${item.answerText}`), count)
  );
}

function buildYear3MoreLessItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (const base of [134, 278, 345, 409, 562, 678, 745, 810, 926, 990]) {
    pool.push(
      makeQuestion({
        itemType: "ONE_MORE_ONE_LESS",
        promptText: buildMoreLessPrompt(base, 10),
        answerText: String(base + 10),
        difficulty: DifficultyBand.EASY,
        contentJson: { domain: "more_less_y3", base, delta: 10, answer: base + 10 },
      })
    );
    pool.push(
      makeQuestion({
        itemType: "ONE_MORE_ONE_LESS",
        promptText: buildMoreLessPrompt(base, -10),
        answerText: String(base - 10),
        difficulty: DifficultyBand.EASY,
        contentJson: { domain: "more_less_y3", base, delta: -10, answer: base - 10 },
      })
    );
    pool.push(
      makeQuestion({
        itemType: "ONE_MORE_ONE_LESS",
        promptText: buildMoreLessPrompt(base, 100),
        answerText: String(base + 100),
        difficulty: DifficultyBand.MEDIUM,
        contentJson: { domain: "more_less_y3", base, delta: 100, answer: base + 100 },
      })
    );
    if (base >= 100) {
      pool.push(
        makeQuestion({
          itemType: "ONE_MORE_ONE_LESS",
          promptText: buildMoreLessPrompt(base, -100),
          answerText: String(base - 100),
          difficulty: DifficultyBand.MEDIUM,
          contentJson: { domain: "more_less_y3", base, delta: -100, answer: base - 100 },
        })
      );
    }
  }

  return withSequence(
    pickSpread(stableSort(pool, (item) => `${item.promptText}|${item.answerText}`), count)
  );
}

function buildYear3Compare1000Items(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pairs: Array<[number, number]> = [
    [245, 254],
    [378, 378],
    [490, 409],
    [601, 610],
    [725, 715],
    [830, 803],
    [912, 921],
    [999, 1000],
    [540, 450],
    [681, 618],
  ];

  const items = pairs.map(([a, b]) =>
    makeQuestion({
      itemType: "COMPARISON",
      promptText: buildComparisonPrompt(a, b, `y3-compare-${a}-${b}`),
      answerText: a < b ? "<" : a > b ? ">" : "=",
      difficulty: a === b ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
      contentJson: { domain: "compare_1000_y3", left: a, right: b, answer: a < b ? "<" : a > b ? ">" : "=" },
    })
  );

  return withSequence(takeTargetCount(items, count));
}

function buildYear3AddSubtractMentalItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (const a of [134, 248, 305, 417, 562, 690, 723, 845, 918, 999]) {
    for (const b of [1, 10, 100, 3, 20, 200]) {
      pool.push(
        makeQuestion({
          itemType: "EQUATION",
          promptText: buildCalculationPrompt(`${a} + ${b}`),
          answerText: String(a + b),
          difficulty: b <= 10 ? DifficultyBand.EASY : b <= 100 ? DifficultyBand.MEDIUM : DifficultyBand.HARD,
          contentJson: { domain: "add_subtract_mental_y3", a, b, result: a + b, operator: "+" },
        })
      );

      if (a >= b) {
        pool.push(
          makeQuestion({
            itemType: "EQUATION",
            promptText: buildCalculationPrompt(`${a} - ${b}`),
            answerText: String(a - b),
            difficulty: b <= 10 ? DifficultyBand.EASY : b <= 100 ? DifficultyBand.MEDIUM : DifficultyBand.HARD,
            contentJson: { domain: "add_subtract_mental_y3", a, b, result: a - b, operator: "-" },
          })
        );
      }
    }
  }

  return withSequence(
    pickSpread(stableSort(pool, (item) => `${item.promptText}|${item.answerText}`), count)
  );
}

function buildYear3AddSubtractColumnItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (const [a, b] of [
    [245, 128],
    [367, 245],
    [489, 176],
    [512, 278],
    [634, 189],
    [745, 267],
    [856, 318],
    [907, 454],
    [678, 299],
    [543, 287],
  ] as Array<[number, number]>) {
    pool.push(
      makeQuestion({
        itemType: "EQUATION",
        promptText: buildCalculationPrompt(`${a} + ${b}`),
        answerText: String(a + b),
        difficulty: a + b < 700 ? DifficultyBand.MEDIUM : DifficultyBand.HARD,
        contentJson: { domain: "add_subtract_column_y3", a, b, result: a + b, operator: "+" },
      })
    );
    if (a > b) {
      pool.push(
        makeQuestion({
          itemType: "EQUATION",
          promptText: buildCalculationPrompt(`${a} - ${b}`),
          answerText: String(a - b),
          difficulty: a - b < 200 ? DifficultyBand.MEDIUM : DifficultyBand.HARD,
          contentJson: { domain: "add_subtract_column_y3", a, b, result: a - b, operator: "-" },
        })
      );
    }
  }

  return withSequence(takeTargetCount(pool, count));
}

function buildYear3FractionsBasicItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const items = [
    ["What fraction of 8 is 2?", "1/4"],
    ["What fraction of 10 is 5?", "1/2"],
    ["What fraction of 12 is 4?", "1/3"],
    ["What fraction of 12 is 8?", "2/3"],
    ["What fraction of 15 is 5?", "1/3"],
    ["What fraction of 16 is 4?", "1/4"],
    ["Calculate 3/7 + 2/7.", "5/7"],
    ["Calculate 5/8 - 2/8.", "3/8"],
    ["Calculate 1/6 + 3/6.", "4/6"],
    ["Calculate 4/9 - 1/9.", "3/9"],
  ].map(([promptText, answerText], index) =>
    makeQuestion({
      itemType: "FRACTION_OF_QUANTITY",
      promptText,
      answerText,
      difficulty: index < 6 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
      contentJson: { domain: "fractions_basic_y3", answer: answerText },
    })
  );

  return withSequence(takeTargetCount(items, count));
}

function buildYear3FractionsCompareItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const items = [
    ["1/5", "1/3", "<"],
    ["1/2", "1/4", ">"],
    ["3/8", "5/8", "<"],
    ["4/7", "2/7", ">"],
    ["1/6", "1/6", "="],
    ["2/9", "4/9", "<"],
    ["1/8", "1/2", "<"],
    ["5/10", "1/2", "="],
    ["3/5", "2/5", ">"],
    ["1/3", "1/4", ">"],
  ].map(([left, right, answerText], index) =>
    makeQuestion({
      itemType: "COMPARISON",
      promptText: buildComparisonPrompt(left, right, `y3-frac-${left}-${right}`),
      answerText,
      difficulty: index < 5 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
      contentJson: { domain: "fractions_compare_y3", answer: answerText },
    })
  );

  return withSequence(takeTargetCount(items, count));
}

function buildYear3FractionsEquivalentItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const items = ([
    [1, 2, 4, "2"],
    [1, 3, 6, "2"],
    [2, 4, 2, "1"],
    [3, 6, 2, "1"],
    [2, 3, 6, "4"],
    [1, 4, 8, "2"],
    [3, 4, 8, "6"],
    [2, 5, 10, "4"],
    [1, 5, 10, "2"],
    [4, 8, 2, "1"],
  ] as Array<[number, number, number, string]>).map(
    ([numerator, denominator, scaledDenominator, answerText], index) =>
      makeQuestion({
      itemType: "FRACTION_OF_QUANTITY",
      promptText: buildEquivalentFractionPrompt(
        numerator,
        denominator,
        scaledDenominator,
        `y3-equivalent-${numerator}-${denominator}-${scaledDenominator}`
      ),
      answerText,
      difficulty: index < 5 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
      contentJson: {
        domain: "fractions_equivalent_y3",
        numerator,
        denominator,
        scaledDenominator,
        answer: answerText,
      },
    })
  );

  return withSequence(takeTargetCount(items, count));
}

function buildYear3FractionOfQuantityItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const cases: Array<[number, number, number]> = [
    [1, 2, 12],
    [1, 3, 15],
    [2, 3, 18],
    [1, 4, 20],
    [3, 4, 16],
    [2, 5, 25],
    [3, 5, 20],
    [1, 8, 24],
    [3, 8, 32],
    [5, 6, 24],
  ];

  const items = cases.map(([numerator, denominator, quantity], index) =>
    makeQuestion({
      itemType: "FRACTION_OF_QUANTITY",
      promptText: `Find ${numerator}/${denominator} of ${quantity}.`,
      answerText: String((quantity / denominator) * numerator),
      difficulty: index < 4 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
      contentJson: {
        domain: "fraction_of_quantity_y3",
        numerator,
        denominator,
        quantity,
        answer: (quantity / denominator) * numerator,
      },
    })
  );

  return withSequence(takeTargetCount(items, count));
}

function buildYear3MeasuresItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const items = [
    ["Which is heavier, 2 kg or 800 g?", "2 kg"],
    ["Which is longer, 140 cm or 1 m?", "140 cm"],
    ["Work in millilitres. What is 500 ml + 250 ml?", "750"],
    ["Work in grams. What is 3 kg - 500 g?", "2500"],
    ["Work in centimetres. What is 120 cm + 30 cm?", "150"],
    ["Work in millilitres. What is 2 l - 500 ml?", "1500"],
    ["Which is greater, 900 ml or 1 l?", "1 l"],
    ["Work in grams. What is 400 g + 600 g?", "1000"],
    ["Work in centimetres. What is 150 cm - 40 cm?", "110"],
    ["Work in millilitres. What is 1 l + 250 ml?", "1250"],
  ].map(([promptText, answerText], index) =>
    makeQuestion({
      itemType: "MEASUREMENT_COMPARE",
      promptText,
      answerText,
      difficulty: index < 4 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
      contentJson: { domain: "measures_y3", answer: answerText },
    })
  );

  return withSequence(takeTargetCount(items, count));
}

function buildYear3DataInterpretationItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const scenarios = [
    {
      intro: "A pictogram shows favourite pets in Class 3",
      labels: ["Dogs", "Cats", "Birds"],
      values: (index: number) => [8 + index, 5 + (index % 4), 3 + (index % 3)],
      question: "How many more children chose Dogs than Cats?",
      answer: (values: number[]) => values[0] - values[1],
    },
    {
      intro: "A table shows how many books each team read this week",
      labels: ["Owls", "Foxes", "Badgers"],
      values: (index: number) => [11 + index, 7 + (index % 3), 6 + (index % 4)],
      question: "How many more books did Owls read than Foxes?",
      answer: (values: number[]) => values[0] - values[1],
    },
    {
      intro: "A bar chart shows votes for playground games",
      labels: ["Tag", "Skipping", "Football"],
      values: (index: number) => [9 + index, 4 + (index % 4), 6 + (index % 3)],
      question: "What is the difference between Tag and Skipping?",
      answer: (values: number[]) => values[0] - values[1],
    },
    {
      intro: "A class chart shows fruit choices at snack time",
      labels: ["Apples", "Bananas", "Oranges"],
      values: (index: number) => [10 + index, 6 + (index % 4), 5 + (index % 3)],
      question: "How many more children chose Apples than Bananas?",
      answer: (values: number[]) => values[0] - values[1],
    },
    {
      intro: "A tally chart shows favourite school clubs",
      labels: ["Chess", "Drama", "Art"],
      values: (index: number) => [7 + index, 4 + (index % 4), 5 + (index % 3)],
      question: "How many more pupils chose Chess than Drama?",
      answer: (values: number[]) => values[0] - values[1],
    },
    {
      intro: "A survey shows how children travel to school",
      labels: ["Walk", "Car", "Scooter"],
      values: (index: number) => [9 + index, 5 + (index % 3), 4 + (index % 4)],
      question: "How many more children walk than come by car?",
      answer: (values: number[]) => values[0] - values[1],
    },
    {
      intro: "A table shows seedlings grown by each group",
      labels: ["Group A", "Group B", "Group C"],
      values: (index: number) => [12 + index, 8 + (index % 4), 7 + (index % 3)],
      question: "How many more seedlings did Group A grow than Group B?",
      answer: (values: number[]) => values[0] - values[1],
    },
    {
      intro: "A class chart records library books borrowed this month",
      labels: ["History", "Stories", "Science"],
      values: (index: number) => [8 + index, 6 + (index % 4), 5 + (index % 3)],
      question: "What is the difference between Stories and Science?",
      answer: (values: number[]) => values[1] - values[2],
    },
  ];

  const items = Array.from({ length: 10 }, (_, index) => {
    const scenario = scenarios[index % scenarios.length] ?? scenarios[0];
    const values = scenario.values(index);
    const [a, b, c] = values;
    return makeQuestion({
      itemType: "EQUATION",
      promptText: `${scenario.intro}: ${scenario.labels[0]} ${a}, ${scenario.labels[1]} ${b}, ${scenario.labels[2]} ${c}. ${scenario.question}`,
      answerText: String(scenario.answer(values)),
      difficulty: index < 5 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
      contentJson: {
        domain: "data_y3",
        categoryA: scenario.labels[0],
        categoryB: scenario.labels[1],
        categoryC: scenario.labels[2],
        valueA: a,
        valueB: b,
        valueC: c,
        answer: scenario.answer(values),
      },
    });
  });

  return withSequence(takeTargetCount(items, count));
}

function buildYear3PerimeterItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const items = Array.from({ length: 10 }, (_, index) => {
    const length = 3 + index;
    const width = 2 + (index % 4);
    return makeQuestion({
      itemType: "EQUATION",
      promptText: `A rectangle has length ${length} cm and width ${width} cm. What is its perimeter?`,
      answerText: String(length * 2 + width * 2),
      difficulty: index < 4 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
      contentJson: { domain: "perimeter_y3", length, width, unit: "cm", answer: length * 2 + width * 2 },
    });
  });

  return withSequence(takeTargetCount(items, count));
}

function buildYear3AnglesItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const items = [
    ["Is 90 degrees a right angle? Answer yes or no.", "yes"],
    ["Is 45 degrees less than a right angle? Answer yes or no.", "yes"],
    ["Is 120 degrees greater than a right angle? Answer yes or no.", "yes"],
    ["How many right angles make a half turn?", "2"],
    ["How many right angles make a full turn?", "4"],
    ["Is 90 degrees greater than a right angle? Answer yes or no.", "no"],
    ["Is 30 degrees less than a right angle? Answer yes or no.", "yes"],
    ["How many right angles make three-quarters of a turn?", "3"],
    ["Is 100 degrees greater than a right angle? Answer yes or no.", "yes"],
    ["Is 80 degrees a right angle? Answer yes or no.", "no"],
  ].map(([promptText, answerText], index) =>
    makeQuestion({
      itemType: "TURN_DIRECTION",
      promptText,
      answerText,
      difficulty: index < 5 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
      contentJson: { domain: "angles_y3", answer: answerText },
    })
  );

  return withSequence(takeTargetCount(items, count));
}

function buildYear3LinesAndShapesItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const items = [
    ["What do we call lines that never meet?", "parallel"],
    ["What do we call lines that cross at a right angle?", "perpendicular"],
    ["Which 2D shape has 4 equal sides?", "square"],
    ["Which 3D shape has 6 square faces?", "cube"],
    ["Does a rectangle have parallel sides? Answer yes or no.", "yes"],
    ["Does a triangle have parallel sides? Answer yes or no.", "no"],
    ["Which 2D shape has 3 sides?", "triangle"],
    ["Which 3D shape has a circular face and one point?", "cone"],
    ["Are the opposite sides of a rectangle parallel? Answer yes or no.", "yes"],
    ["Which 2D shape has 4 sides and 4 right angles?", "rectangle"],
  ].map(([promptText, answerText], index) =>
    makeQuestion({
      itemType: "SHAPE_NAME",
      promptText,
      answerText,
      difficulty: index < 5 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
      contentJson: { domain: "lines_shapes_y3", answer: answerText },
    })
  );

  return withSequence(takeTargetCount(items, count));
}

function buildYear3TimeItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const items = [
    ["Write 3:15 in words.", "quarter past 3"],
    ["Write 6:30 in words.", "half past 6"],
    ["Write 8:45 in words.", "quarter to 9"],
    ["How many seconds are in 1 minute?", "60"],
    ["How many minutes are in 2 hours?", "120"],
    ["A film starts at 2:10 pm and lasts 30 minutes. What time does it end?", "2:40 pm"],
    ["Write 14:00 on a 12-hour clock.", "2:00 pm"],
    ["How many days are in April?", "30"],
    ["Write 12:00 midnight using am or pm.", "12:00 am"],
    ["A lesson starts at 9:05 and ends at 9:50. How long is the lesson in minutes?", "45"],
  ].map(([promptText, answerText], index) =>
    makeQuestion({
      itemType: "TIME_MATCH",
      promptText,
      answerText,
      difficulty: index < 5 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
      contentJson: { domain: "time_y3", answer: answerText },
    })
  );

  return withSequence(takeTargetCount(items, count));
}

function buildYear4TimesTablesItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (let a = 2; a <= 12; a += 1) {
    for (let b = 2; b <= 12; b += 1) {
      const product = a * b;
      const difficulty =
        Math.max(a, b) <= 5
          ? DifficultyBand.EASY
          : Math.max(a, b) <= 9
          ? DifficultyBand.MEDIUM
          : DifficultyBand.HARD;

      pool.push(
        makeQuestion({
          itemType: "EQUATION",
          promptText: buildCalculationPrompt(`${a} x ${b}`),
          answerText: String(product),
          difficulty,
          contentJson: {
            domain: "times_tables",
            a,
            b,
            result: product,
            operator: "x",
          },
        })
      );

      pool.push(
        makeQuestion({
          itemType: "EQUATION",
          promptText: buildCalculationPrompt(`${product} / ${a}`),
          answerText: String(b),
          difficulty,
          contentJson: {
            domain: "times_tables",
            a: product,
            b: a,
            result: b,
            operator: "/",
          },
        })
      );
    }
  }

  return withSequence(
    pickSpread(stableSort(pool, (item) => `${item.promptText}|${item.answerText}`), count)
  );
}

function buildYear4CountMultiplesItems(
  count = 10
): DirectGeneratedCanonicalQuestion[] {
  const steps = [6, 7, 9, 25, 1000];
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (const step of steps) {
    for (let startIndex = 0; startIndex <= 4; startIndex += 1) {
      const start = step * startIndex;
      const values = Array.from({ length: 5 }, (_, index) => start + step * index);

      pool.push(
        makeQuestion({
          itemType: "NUMBER_SEQUENCE",
          promptText: buildNextNumberPrompt(values.slice(0, 4)),
          answerText: String(values[4]),
          difficulty:
            step <= 9
              ? DifficultyBand.EASY
              : step === 25
              ? DifficultyBand.MEDIUM
              : DifficultyBand.HARD,
          contentJson: {
            domain: "count_multiples",
            step,
            start,
            answer: values[4],
          },
        })
      );
    }
  }

  return withSequence(
    pickSpread(stableSort(pool, (item) => `${item.promptText}|${item.answerText}`), count)
  );
}

function buildYear4MentalMultiplyDivideItems(
  count = 10
): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (let a = 2; a <= 12; a += 1) {
    for (let b = 2; b <= 12; b += 1) {
      const product = a * b;

      pool.push(
        makeQuestion({
          itemType: "EQUATION",
          promptText: buildCalculationPrompt(`${a} x ${b} x 1`),
          answerText: String(product),
          difficulty: a <= 5 && b <= 5 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
          contentJson: {
            domain: "mental_multiply_divide",
            a,
            b,
            c: 1,
            result: product,
          },
        })
      );

      pool.push(
        makeQuestion({
          itemType: "EQUATION",
          promptText: buildCalculationPrompt(`${a} x ${b} x 0`),
          answerText: "0",
          difficulty: DifficultyBand.EASY,
          contentJson: {
            domain: "mental_multiply_divide",
            a,
            b,
            c: 0,
            result: 0,
          },
        })
      );

      pool.push(
        makeQuestion({
          itemType: "EQUATION",
          promptText: buildCalculationPrompt(`${product} / 1`),
          answerText: String(product),
          difficulty: a <= 5 && b <= 5 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
          contentJson: {
            domain: "mental_multiply_divide",
            a: product,
            b: 1,
            result: product,
          },
        })
      );
    }
  }

  return withSequence(
    pickSpread(stableSort(pool, (item) => `${item.promptText}|${item.answerText}`), count)
  );
}

function buildYear4PlaceValueItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const places = [
    { label: "thousands", divisor: 1000 },
    { label: "hundreds", divisor: 100 },
    { label: "tens", divisor: 10 },
    { label: "ones", divisor: 1 },
  ];
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (let number = 1234; number <= 9876; number += 327) {
    for (const place of places) {
      const digit = Math.floor(number / place.divisor) % 10;
      pool.push(
        makeQuestion({
          itemType: "EQUATION",
          promptText: `What digit is in the ${place.label} place in ${number}?`,
          answerText: String(digit),
          difficulty:
            place.divisor >= 100 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
          contentJson: {
            domain: "place_value",
            number,
            place: place.label,
            answer: digit,
          },
        })
      );
    }
  }

  return withSequence(
    pickSpread(stableSort(pool, (item) => `${item.promptText}|${item.answerText}`), count)
  );
}

function buildYear4ThousandMoreLessItems(
  count = 10
): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (let base = 1456; base <= 8456; base += 700) {
    pool.push(
      makeQuestion({
        itemType: "EQUATION",
        promptText: buildMoreLessPrompt(base, 1000),
        answerText: String(base + 1000),
        difficulty: DifficultyBand.EASY,
        contentJson: {
          domain: "thousand_more_less",
          base,
          delta: 1000,
          answer: base + 1000,
        },
      })
    );

    pool.push(
      makeQuestion({
        itemType: "EQUATION",
        promptText: buildMoreLessPrompt(base, -1000),
        answerText: String(base - 1000),
        difficulty: DifficultyBand.EASY,
        contentJson: {
          domain: "thousand_more_less",
          base,
          delta: -1000,
          answer: base - 1000,
        },
      })
    );
  }

  return withSequence(
    pickSpread(stableSort(pool, (item) => `${item.promptText}|${item.answerText}`), count)
  );
}

function buildYear4RoundingItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const increments = [10, 100, 1000];
  const numbers = [1246, 1581, 2394, 3678, 4412, 5876, 6505, 7819, 8451, 9326];
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (const number of numbers) {
    for (const increment of increments) {
      const rounded = Math.round(number / increment) * increment;
      pool.push(
        makeQuestion({
          itemType: "EQUATION",
          promptText: `Round ${number} to the nearest ${increment}.`,
          answerText: String(rounded),
          difficulty:
            increment === 10
              ? DifficultyBand.EASY
              : increment === 100
              ? DifficultyBand.MEDIUM
              : DifficultyBand.HARD,
          contentJson: {
            domain: "rounding",
            number,
            increment,
            answer: rounded,
          },
        })
      );
    }
  }

  return withSequence(
    pickSpread(stableSort(pool, (item) => `${item.promptText}|${item.answerText}`), count)
  );
}

function buildYear4Compare1000Items(count = 10): DirectGeneratedCanonicalQuestion[] {
  const pairs: Array<[number, number]> = [
    [1234, 1324],
    [4567, 4567],
    [7890, 7809],
    [3050, 3500],
    [9999, 1000],
    [4201, 4120],
    [6705, 6708],
    [8100, 8010],
    [2509, 2590],
    [6006, 6060],
  ];

  const items = pairs.map(([a, b]) => {
    const answer = a < b ? "<" : a > b ? ">" : "=";
    return makeQuestion({
      itemType: "COMPARISON",
      promptText: buildComparisonPrompt(a, b, `y4-compare-${a}-${b}`),
      answerText: answer,
      difficulty: a === b ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
      contentJson: {
        domain: "compare_numbers",
        left: a,
        right: b,
        answer,
      },
    });
  });

  return withSequence(
    pickSpread(stableSort(items, (item) => `${item.promptText}|${item.answerText}`), count)
  );
}

function buildYear4AddSubtract4DigitItems(
  count = 10
): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (let a = 1234; a <= 6789; a += 611) {
    const b = (a % 1700) + 245;
    pool.push(
      makeQuestion({
        itemType: "EQUATION",
        promptText: buildCalculationPrompt(`${a} + ${b}`),
        answerText: String(a + b),
        difficulty: a + b < 5000 ? DifficultyBand.MEDIUM : DifficultyBand.HARD,
        contentJson: {
          domain: "add_subtract_4_digit",
          a,
          b,
          result: a + b,
          operator: "+",
        },
      })
    );

    if (a > b) {
      pool.push(
        makeQuestion({
          itemType: "EQUATION",
          promptText: buildCalculationPrompt(`${a} - ${b}`),
          answerText: String(a - b),
          difficulty: a - b < 1000 ? DifficultyBand.MEDIUM : DifficultyBand.HARD,
          contentJson: {
            domain: "add_subtract_4_digit",
            a,
            b,
            result: a - b,
            operator: "-",
          },
        })
      );
    }
  }

  return withSequence(
    pickSpread(stableSort(pool, (item) => `${item.promptText}|${item.answerText}`), count)
  );
}

function buildYear4MultiplyDivide10And100Items(
  count = 10
): DirectGeneratedCanonicalQuestion[] {
  const bases = [4, 7, 12, 25, 34, 56, 78, 90, 105, 240];
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (const base of bases) {
    pool.push(
      makeQuestion({
        itemType: "EQUATION",
        promptText: buildCalculationPrompt(`${base} x 10`),
        answerText: String(base * 10),
        difficulty: DifficultyBand.EASY,
        contentJson: {
          domain: "multiply_divide_10_100",
          base,
          factor: 10,
          answer: base * 10,
        },
      })
    );

    pool.push(
      makeQuestion({
        itemType: "EQUATION",
        promptText: buildCalculationPrompt(`${base} x 100`),
        answerText: String(base * 100),
        difficulty: DifficultyBand.MEDIUM,
        contentJson: {
          domain: "multiply_divide_10_100",
          base,
          factor: 100,
          answer: base * 100,
        },
      })
    );

    pool.push(
      makeQuestion({
        itemType: "EQUATION",
        promptText: buildCalculationPrompt(`${base * 100} / 100`),
        answerText: String(base),
        difficulty: DifficultyBand.MEDIUM,
        contentJson: {
          domain: "multiply_divide_10_100",
          base: base * 100,
          factor: 100,
          answer: base,
        },
      })
    );
  }

  return withSequence(
    pickSpread(stableSort(pool, (item) => `${item.promptText}|${item.answerText}`), count)
  );
}

function buildYear4EquivalentFractionsItems(
  count = 10
): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];
  const cases = [
    [1, 2, 4],
    [1, 3, 3],
    [2, 3, 2],
    [3, 4, 2],
    [2, 5, 2],
    [3, 5, 2],
    [4, 5, 2],
    [1, 4, 3],
    [3, 8, 2],
    [5, 6, 2],
  ];

  for (const [numerator, denominator, factor] of cases) {
    pool.push(
      makeQuestion({
        itemType: "FRACTION_OF_QUANTITY",
        promptText: buildEquivalentFractionPrompt(
          numerator,
          denominator,
          denominator * factor,
          `y4-equivalent-${numerator}-${denominator}-${factor}`
        ),
        answerText: String(numerator * factor),
        difficulty: factor <= 2 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
        contentJson: {
          domain: "equivalent_fractions",
          numerator,
          denominator,
          scaledDenominator: denominator * factor,
          answer: numerator * factor,
        },
      })
    );
  }

  return withSequence(takeTargetCount(pool, count));
}

function buildYear4FractionSameDenominatorItems(
  count = 10
): DirectGeneratedCanonicalQuestion[] {
  const pool: Omit<DirectGeneratedCanonicalQuestion, "sequence">[] = [];

  for (let denominator = 4; denominator <= 12; denominator += 2) {
    for (let a = 1; a < denominator; a += 1) {
      for (let b = 1; b < denominator; b += 1) {
        if (a + b < denominator) {
          pool.push(
            makeQuestion({
              itemType: "FRACTION_OF_QUANTITY",
              promptText: `Calculate ${a}/${denominator} + ${b}/${denominator}.`,
              answerText: `${a + b}/${denominator}`,
              difficulty: denominator <= 6 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
              contentJson: {
                domain: "fractions_same_denominator",
                numeratorA: a,
                numeratorB: b,
                denominator,
                answer: `${a + b}/${denominator}`,
              },
            })
          );
        }

        if (a > b) {
          pool.push(
            makeQuestion({
              itemType: "FRACTION_OF_QUANTITY",
              promptText: `Calculate ${a}/${denominator} - ${b}/${denominator}.`,
              answerText: `${a - b}/${denominator}`,
              difficulty: denominator <= 6 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
              contentJson: {
                domain: "fractions_same_denominator",
                numeratorA: a,
                numeratorB: b,
                denominator,
                answer: `${a - b}/${denominator}`,
              },
            })
          );
        }
      }
    }
  }

  return withSequence(
    pickSpread(stableSort(pool, (item) => `${item.promptText}|${item.answerText}`), count)
  );
}

function buildYear4FractionOfQuantityItems(
  count = 10
): DirectGeneratedCanonicalQuestion[] {
  const cases: Array<[number, number, number]> = [
    [3, 4, 20],
    [2, 3, 18],
    [3, 5, 25],
    [4, 5, 30],
    [5, 6, 24],
    [2, 7, 21],
    [3, 8, 32],
    [5, 8, 40],
    [7, 10, 50],
    [9, 10, 60],
  ];

  const items = cases.map(([numerator, denominator, quantity]) =>
    makeQuestion({
      itemType: "FRACTION_OF_QUANTITY",
      promptText: `Find ${numerator}/${denominator} of ${quantity}.`,
      answerText: String((quantity / denominator) * numerator),
      difficulty: denominator <= 5 ? DifficultyBand.MEDIUM : DifficultyBand.HARD,
      contentJson: {
        domain: "fraction_of_quantity",
        numerator,
        denominator,
        quantity,
        answer: (quantity / denominator) * numerator,
      },
    })
  );

  return withSequence(takeTargetCount(items, count));
}

function buildYear4CoordinatesItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const items = Array.from({ length: 10 }, (_, index) => {
    const x = 1 + (index % 5);
    const y = 2 + (index % 4);
    const dx = 1 + (index % 3);
    const dy = index % 2 === 0 ? 1 : 2;
    return makeQuestion({
      itemType: "NUMBER_SEQUENCE",
      promptText: `A point starts at (${x}, ${y}). Move it ${dx} right and ${dy} up. What are the new coordinates?`,
      answerText: `${x + dx},${y + dy}`,
      difficulty: index < 4 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
      contentJson: {
        domain: "coordinates",
        x,
        y,
        dx,
        dy,
        answer: [x + dx, y + dy],
      },
    });
  });

  return withSequence(takeTargetCount(items, count));
}

function buildYear4PerimeterItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const items = Array.from({ length: 10 }, (_, index) => {
    const length = 4 + index;
    const width = 2 + (index % 5);
    return makeQuestion({
      itemType: "EQUATION",
      promptText: `A rectangle has length ${length} cm and width ${width} cm. What is its perimeter?`,
      answerText: String(length * 2 + width * 2),
      difficulty: index < 4 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
      contentJson: {
        domain: "perimeter",
        length,
        width,
        unit: "cm",
        answer: length * 2 + width * 2,
      },
    });
  });

  return withSequence(takeTargetCount(items, count));
}

function buildYear4SymmetryItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const shapes: Array<[string, number]> = [
    ["square", 4],
    ["rectangle", 2],
    ["equilateral triangle", 3],
    ["isosceles triangle", 1],
    ["scalene triangle", 0],
    ["regular pentagon", 5],
    ["regular hexagon", 6],
    ["kite", 1],
    ["parallelogram", 0],
    ["rhombus", 2],
  ];

  const articleFor = (shape: string) =>
    /^(equilateral|isosceles|octagon)\b/i.test(shape) ? "an" : "a";

  const items = shapes.map(([shape, lines]) =>
    makeQuestion({
      itemType: "SHAPE_NAME",
      promptText: `How many lines of symmetry does ${articleFor(shape)} ${shape} have?`,
      answerText: String(lines),
      difficulty: lines >= 5 ? DifficultyBand.HARD : DifficultyBand.MEDIUM,
      contentJson: {
        domain: "symmetry",
        shape,
        answer: lines,
      },
    })
  );

  return withSequence(takeTargetCount(items, count));
}

function buildYear4Time24HourItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const items = [
    ["3:15 pm", "15:15"],
    ["4:40 pm", "16:40"],
    ["7:05 am", "07:05"],
    ["11:30 am", "11:30"],
    ["12:45 pm", "12:45"],
    ["1:20 pm", "13:20"],
    ["9:55 pm", "21:55"],
    ["6:10 am", "06:10"],
    ["8:25 pm", "20:25"],
    ["10:50 am", "10:50"],
  ].map(([prompt, answer], index) =>
    makeQuestion({
      itemType: "TIME_MATCH",
      promptText: `Convert ${prompt} to 24-hour time.`,
      answerText: answer,
      difficulty: index < 4 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
      contentJson: {
        domain: "time_24_hour",
        format: "12_to_24",
        answer,
      },
    })
  );

  return withSequence(takeTargetCount(items, count));
}

function buildYear4UnitConversionItems(
  count = 10
): DirectGeneratedCanonicalQuestion[] {
  const cases: Array<[string, number, string, number]> = [
    ["km to m", 3, "m", 3000],
    ["km to m", 7, "m", 7000],
    ["m to km", 5000, "km", 5],
    ["hours to minutes", 2, "minutes", 120],
    ["hours to minutes", 4, "minutes", 240],
    ["minutes to seconds", 3, "seconds", 180],
    ["years to months", 5, "months", 60],
    ["weeks to days", 6, "days", 42],
    ["minutes to seconds", 9, "seconds", 540],
    ["years to months", 8, "months", 96],
  ];

  const items = cases.map(([kind, value, unit, answer]) =>
    makeQuestion({
      itemType: "EQUATION",
      promptText: `Convert ${value} ${kind.split(" to ")[0]} to ${unit}.`,
      answerText: String(answer),
      difficulty: kind.includes("seconds") ? DifficultyBand.MEDIUM : DifficultyBand.EASY,
      contentJson: {
        domain: "unit_conversion",
        kind,
        value,
        answer,
      },
    })
  );

  return withSequence(takeTargetCount(items, count));
}

function buildYear4DataInterpretationItems(
  count = 10
): DirectGeneratedCanonicalQuestion[] {
  const scenarios = [
    {
      intro: "A bar chart shows after-school club choices",
      labels: ["Art", "Music", "Sport"],
      values: (index: number) => [10 + index * 2, 6 + index, 8 + index],
      question: "How many more pupils chose Art than Music?",
      answer: (values: number[]) => values[0] - values[1],
    },
    {
      intro: "A results chart shows house points this week",
      labels: ["Oak", "Cedar", "Elm"],
      values: (index: number) => [18 + index, 11 + (index % 5), 14 + (index % 4)],
      question: "What is the difference between Oak and Cedar?",
      answer: (values: number[]) => values[0] - values[1],
    },
    {
      intro: "A survey shows favourite library genres",
      labels: ["Adventure", "Mystery", "Science"],
      values: (index: number) => [12 + index, 7 + (index % 4), 9 + (index % 5)],
      question: "How many more votes did Adventure get than Mystery?",
      answer: (values: number[]) => values[0] - values[1],
    },
    {
      intro: "A class chart records recycling collected by each team",
      labels: ["Team A", "Team B", "Team C"],
      values: (index: number) => [16 + index, 8 + (index % 4), 10 + (index % 3)],
      question: "How many more items did Team A collect than Team B?",
      answer: (values: number[]) => values[0] - values[1],
    },
    {
      intro: "A survey shows favourite science topics",
      labels: ["Space", "Plants", "Forces"],
      values: (index: number) => [13 + index, 9 + (index % 4), 8 + (index % 3)],
      question: "How many more votes did Space get than Plants?",
      answer: (values: number[]) => values[0] - values[1],
    },
    {
      intro: "A table shows laps completed on sports day",
      labels: ["Red Team", "Blue Team", "Green Team"],
      values: (index: number) => [22 + index, 15 + (index % 4), 17 + (index % 3)],
      question: "What is the difference between Red Team and Blue Team?",
      answer: (values: number[]) => values[0] - values[1],
    },
    {
      intro: "A chart shows healthy snack choices at lunchtime",
      labels: ["Wraps", "Fruit Pots", "Yoghurt"],
      values: (index: number) => [14 + index, 10 + (index % 4), 9 + (index % 3)],
      question: "How many more pupils chose Wraps than Fruit Pots?",
      answer: (values: number[]) => values[0] - values[1],
    },
    {
      intro: "A results table shows points earned in a times-table challenge",
      labels: ["Oak", "Willow", "Maple"],
      values: (index: number) => [24 + index, 18 + (index % 4), 20 + (index % 3)],
      question: "How many more points did Oak score than Willow?",
      answer: (values: number[]) => values[0] - values[1],
    },
  ];

  const items = Array.from({ length: 10 }, (_, index) => {
    const scenario = scenarios[index % scenarios.length] ?? scenarios[0];
    const values = scenario.values(index);
    const [a, b, c] = values;
    return makeQuestion({
      itemType: "EQUATION",
      promptText: `${scenario.intro}: ${scenario.labels[0]} ${a}, ${scenario.labels[1]} ${b}, ${scenario.labels[2]} ${c}. ${scenario.question}`,
      answerText: String(scenario.answer(values)),
      difficulty: index < 5 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
      contentJson: {
        domain: "data",
        chartType: "bar_chart",
        categoryA: scenario.labels[0],
        categoryB: scenario.labels[1],
        categoryC: scenario.labels[2],
        valueA: a,
        valueB: b,
        valueC: c,
        answer: scenario.answer(values),
      },
    });
  });

  return withSequence(takeTargetCount(items, count));
}

function buildYear4MoneyItems(count = 10): DirectGeneratedCanonicalQuestion[] {
  const items = [
    ["£3.50", "£1.20", "4.70"],
    ["£5.75", "£2.10", "7.85"],
    ["£10.00", "£6.45", "3.55"],
    ["£8.40", "£0.60", "9.00"],
    ["£12.30", "£2.30", "10.00"],
    ["£7.25", "£1.50", "8.75"],
    ["£6.80", "£3.20", "10.00"],
    ["£9.90", "£4.40", "5.50"],
    ["£11.15", "£0.85", "12.00"],
    ["£14.50", "£2.75", "11.75"],
  ].map(([a, b, answer], index) =>
    makeQuestion({
      itemType: "COIN_VALUE",
      promptText:
        index % 2 === 0
          ? `Calculate the total of ${a} and ${b}.`
          : `Calculate ${a} - ${b}.`,
      answerText: answer,
      difficulty: index < 4 ? DifficultyBand.EASY : DifficultyBand.MEDIUM,
      contentJson: {
        domain: "money",
        a,
        b,
        answer,
      },
    })
  );

  return withSequence(takeTargetCount(items, count));
}

export function generateDirectCanonicalQuestions(
  profileName: string,
  context: DirectGenerationContext = {}
): DirectGeneratedCanonicalQuestion[] {
  const targetCount = context.targetCount ?? 10;
  const normalized = normalizeDirectGeneratorName(profileName);

  switch (normalized) {
    case "one_more_one_less_to_20":
      return buildOneMoreOneLessItems(targetCount);

    case "comparison_within_20":
      return buildComparisonItems(targetCount);

    case "count_forwards_to_20":
      return buildNumberSequenceItems({
        step: 1,
        direction: "forward",
        minStart: 0,
        maxStart: 16,
        count: targetCount,
        label: "count_forwards_to_20",
      });

    case "count_backwards_from_20":
      return buildNumberSequenceItems({
        step: 1,
        direction: "backward",
        minStart: 20,
        maxStart: 20,
        count: targetCount,
        label: "count_backwards_from_20",
      });

    case "count_in_2s":
      return buildNumberSequenceItems({
        step: 2,
        direction: "forward",
        minStart: 0,
        maxStart: 12,
        count: targetCount,
        label: "count_in_2s",
      });

    case "count_in_5s":
      return buildNumberSequenceItems({
        step: 5,
        direction: "forward",
        minStart: 0,
        maxStart: 30,
        count: targetCount,
        label: "count_in_5s",
      });

    case "count_in_10s":
      return buildNumberSequenceItems({
        step: 10,
        direction: "forward",
        minStart: 0,
        maxStart: 50,
        count: targetCount,
        label: "count_in_10s",
      });

    case "number_line_within_20":
      return buildNumberLineItems(targetCount);

    case "half_of_quantity":
      return buildFractionOfQuantityItems({
        fraction: "1/2",
        values: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20],
        count: targetCount,
      });

    case "quarter_of_quantity":
      return buildFractionOfQuantityItems({
        fraction: "1/4",
        values: [4, 8, 12, 16, 20, 24, 28, 32, 36, 40],
        count: targetCount,
      });

    case "measurement_compare":
      return buildMeasurementCompareItems(targetCount);

    case "turn_direction":
      return buildTurnDirectionItems(targetCount);

    case "time_match_hour_half_hour":
      return buildTimeMatchItems(targetCount);

    case "date_sequence":
      return buildDateSequenceItems(targetCount);

    case "coin_value":
      return buildCoinValueItems(targetCount);

    case "shape_name":
      return buildShapeNameItems(targetCount);

    case "Y3_TIMES_TABLES":
      return buildYear3TimesTablesItems(targetCount);

    case "Y3_COUNT_MULTIPLES":
      return buildYear3CountMultiplesItems(targetCount);

    case "Y3_MULTIPLY_DIVIDE":
      return buildYear3MultiplyDivideItems(targetCount);

    case "Y3_PLACE_VALUE_3_DIGIT":
      return buildYear3PlaceValueItems(targetCount);

    case "Y3_MORE_LESS_10_100":
      return buildYear3MoreLessItems(targetCount);

    case "Y3_COMPARE_1000":
      return buildYear3Compare1000Items(targetCount);

    case "Y3_ADD_SUBTRACT_MENTAL":
      return buildYear3AddSubtractMentalItems(targetCount);

    case "Y3_ADD_SUBTRACT_COLUMN":
      return buildYear3AddSubtractColumnItems(targetCount);

    case "Y3_FRACTIONS_BASIC":
      return buildYear3FractionsBasicItems(targetCount);

    case "Y3_FRACTIONS_COMPARE":
      return buildYear3FractionsCompareItems(targetCount);

    case "Y3_FRACTIONS_EQUIVALENT":
      return buildYear3FractionsEquivalentItems(targetCount);

    case "Y3_FRACTION_OF_QUANTITY":
      return buildYear3FractionOfQuantityItems(targetCount);

    case "Y3_MEASURES":
      return buildYear3MeasuresItems(targetCount);

    case "Y3_DATA_INTERPRETATION":
      return buildYear3DataInterpretationItems(targetCount);

    case "Y3_PERIMETER":
      return buildYear3PerimeterItems(targetCount);

    case "Y3_ANGLES":
      return buildYear3AnglesItems(targetCount);

    case "Y3_LINES_AND_SHAPES":
      return buildYear3LinesAndShapesItems(targetCount);

    case "Y3_TIME":
      return buildYear3TimeItems(targetCount);

    case "Y4_TIMES_TABLES":
      return buildYear4TimesTablesItems(targetCount);

    case "Y4_COUNT_MULTIPLES":
      return buildYear4CountMultiplesItems(targetCount);

    case "Y4_MENTAL_MULTIPLY_DIVIDE":
      return buildYear4MentalMultiplyDivideItems(targetCount);

    case "Y4_PLACE_VALUE_4_DIGIT":
      return buildYear4PlaceValueItems(targetCount);

    case "Y4_THOUSAND_MORE_LESS":
      return buildYear4ThousandMoreLessItems(targetCount);

    case "Y4_ROUNDING":
      return buildYear4RoundingItems(targetCount);

    case "Y4_COMPARE_1000":
      return buildYear4Compare1000Items(targetCount);

    case "Y4_ADD_SUBTRACT_4_DIGIT":
      return buildYear4AddSubtract4DigitItems(targetCount);

    case "Y4_MULTIPLY_DIVIDE_10_100":
      return buildYear4MultiplyDivide10And100Items(targetCount);

    case "Y4_EQUIVALENT_FRACTIONS":
      return buildYear4EquivalentFractionsItems(targetCount);

    case "Y4_FRACTIONS_SAME_DENOMINATOR":
      return buildYear4FractionSameDenominatorItems(targetCount);

    case "Y4_FRACTION_OF_QUANTITY":
      return buildYear4FractionOfQuantityItems(targetCount);

    case "Y4_COORDINATES":
      return buildYear4CoordinatesItems(targetCount);

    case "Y4_PERIMETER":
      return buildYear4PerimeterItems(targetCount);

    case "Y4_SYMMETRY":
      return buildYear4SymmetryItems(targetCount);

    case "Y4_TIME_24_HOUR":
      return buildYear4Time24HourItems(targetCount);

    case "Y4_UNIT_CONVERSION":
      return buildYear4UnitConversionItems(targetCount);

    case "Y4_DATA_INTERPRETATION":
      return buildYear4DataInterpretationItems(targetCount);

    case "Y4_MONEY":
      return buildYear4MoneyItems(targetCount);

    case "SIMPLIFY_EXPRESSION":
      return buildSimplifyExpressionItems(targetCount);

    case "SOLVE_LINEAR_ONE_STEP":
      return buildSolveLinearOneStepItems(targetCount);

    case "SOLVE_LINEAR_TWO_STEP":
      return buildSolveLinearTwoStepItems(targetCount);
    case "SOLVE_QUADRATIC_FOUNDATION":
      return buildSolveQuadraticFoundationItems(targetCount);
    case "SOLVE_INEQUALITY_FOUNDATION":
      return buildSolveInequalityFoundationItems(targetCount);

    case "EXPAND_SINGLE_BRACKET":
      return buildExpandSingleBracketItems(targetCount);

    case "SUBSTITUTE_INTO_EXPRESSION":
      return buildSubstituteIntoExpressionItems(targetCount);

    case "LINEAR_SEQUENCE_TERM":
      return buildLinearSequenceTermItems(targetCount);

    case "FRACTION_OPERATIONS_FOUNDATION":
      return buildFractionOperationsFoundationItems(targetCount);

    case "DECIMAL_OPERATIONS_FOUNDATION":
      return buildDecimalOperationsFoundationItems(targetCount);

    case "PERCENTAGE_OF_AMOUNT":
      return buildPercentageOfAmountItems(targetCount);

    case "PERCENTAGE_CHANGE_FOUNDATION":
      return buildPercentageChangeFoundationItems(targetCount);

    case "RATIO_SHARE":
      return buildRatioShareItems(targetCount);

    case "RATIO_SCALE":
      return buildRatioScaleItems(targetCount);
    case "SCALE_DRAWINGS_FOUNDATION":
      return buildScaleDrawingsFoundationItems(targetCount);

    case "ANGLE_FACTS_FOUNDATION":
      return buildAngleFactsFoundationItems(targetCount);

    case "AREA_PERIMETER_FOUNDATION":
      return buildAreaPerimeterFoundationItems(targetCount);

    case "CIRCUMFERENCE_AREA_CIRCLE_FOUNDATION":
      return buildCircumferenceAreaCircleFoundationItems(targetCount);

    case "PYTHAGORAS_FOUNDATION":
      return buildPythagorasFoundationItems(targetCount);

    case "MEAN_MEDIAN_MODE_RANGE":
      return buildMeanMedianModeRangeItems(targetCount);

    case "PROBABILITY_FOUNDATION":
      return buildProbabilityFoundationItems(targetCount);

    default:
      throw new Error(`No direct generator registered for profile "${profileName}"`);
  }
}

export function generateDirectQuestions(
  directGenerator: string,
  context: DirectGenerationContext = {}
): GeneratedCanonicalQuestion[] {
  return generateDirectCanonicalQuestions(directGenerator, context).map(
    ({ sequence: _sequence, ...question }) => question
  );
}
