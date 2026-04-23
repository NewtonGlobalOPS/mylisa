import { DifficultyBand } from "@prisma/client";
import { renderEquation } from "../render.js";
import type { CanonicalRuleGenerator } from "../types.js";

export const numberBondsWithin10: CanonicalRuleGenerator = () => {
  const pairs: Array<[number, number]> = [
    [0, 10],
    [1, 9],
    [2, 8],
    [3, 7],
    [4, 6],
    [5, 5],
    [6, 4],
    [7, 3],
    [8, 2],
    [9, 1],
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
        rule: "number_bonds_within_10",
        target: 10,
      },
    };
  });
};