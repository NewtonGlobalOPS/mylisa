import { DifficultyBand } from "@prisma/client";
import { renderEquation } from "../render";
import type { CanonicalRuleGenerator } from "../types";

export const subtractWithin10: CanonicalRuleGenerator = () => {
  const pairs: Array<[number, number]> = [
    [2, 1],
    [3, 1],
    [3, 2],
    [4, 1],
    [4, 2],
    [5, 2],
    [6, 3],
    [7, 3],
    [8, 4],
    [10, 5],
  ];

  return pairs.map(([lhsA, lhsB], index) => {
    const rhs = lhsA - lhsB;

    return {
      sequence: index + 1,
      operator: "SUBTRACT",
      lhsA,
      lhsB,
      rhs,
      equation: renderEquation("SUBTRACT", lhsA, lhsB, rhs),
      difficulty:
        index < 4
          ? DifficultyBand.EASY
          : index < 8
            ? DifficultyBand.MEDIUM
            : DifficultyBand.HARD,
      generatorMeta: {
        rule: "subtract_within_10",
      },
    };
  });
};