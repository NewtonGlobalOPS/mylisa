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
          promptText: `${a} ? ${b}`,
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
    const left = Number((x.contentJson.left as number) ?? 0);
    const right = Number((x.contentJson.right as number) ?? 0);
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
    if (minValue < 0 || maxValue > 50) continue;

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
            promptText: `${a}${unit} ? ${b}${unit}`,
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
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ];

  const months = [
    "January",
    "February",
    "March",
    "April",
    "May",
    "June",
    "July",
    "August",
    "September",
    "October",
    "November",
    "December",
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