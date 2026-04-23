import { DifficultyBand } from "@prisma/client";
import { renderEquation } from "../render";
import type { CanonicalRuleGenerator } from "../types";

export const addWithin10: CanonicalRuleGenerator = () => {
  const pairs: Array<[number, number]> = [
    [0, 1],
    [1, 1],
    [1, 2],
    [2, 2],
    [2, 3],
    [3, 3],
    [3, 4],
    [4, 4],
    [4, 5],
    [5, 5],
  ];

  return pairs.map(([lhsA, lhsB], index) => {
    const rhs = lhsA + lhsB;

    return {
      sequence: index + 1,
      operator: "ADD",
      lhsA,
      lhsB,
      rhs,
      equation: renderEquation("ADD", lhsA, lhsB, rhs),
      difficulty:
        index < 4
          ? DifficultyBand.EASY
          : index < 8
            ? DifficultyBand.MEDIUM
            : DifficultyBand.HARD,
      generatorMeta: {
        rule: "add_within_10",
      },
    };
  });
};