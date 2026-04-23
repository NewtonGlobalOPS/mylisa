import type {
  CanonicalCandidate,
  CanonicalOperator,
  CanonicalProfile,
  EquationGenerationProfile,
} from "./types";
import { isEquationGenerationProfile } from "./types";

/**
 * =========================================================
 * EQUATION CANDIDATE HELPERS
 * =========================================================
 */

type EquationLikeCandidate = CanonicalCandidate & {
  operator: CanonicalOperator;
  lhsA: number;
  lhsB: number;
  rhs: number;
};

function isEquationCandidate(
  candidate: CanonicalCandidate
): candidate is EquationLikeCandidate {
  return (
    typeof candidate.operator === "string" &&
    typeof candidate.lhsA === "number" &&
    typeof candidate.lhsB === "number" &&
    typeof candidate.rhs === "number"
  );
}

function makeEquationCandidate(
  operator: CanonicalOperator,
  lhsA: number,
  lhsB: number,
  rhs: number,
  tags: string[] = [],
  weight = 1
): EquationLikeCandidate {
  return {
    itemType: "EQUATION",
    operator,
    lhsA,
    lhsB,
    rhs,
    tags,
    weight,
    content: {
      kind: "equation",
      operator,
      lhsA,
      lhsB,
      rhs,
    },
  };
}

function uniqueByKey<T>(items: T[], keyFn: (item: T) => string): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const item of items) {
    const key = keyFn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }
  return out;
}

function equationKey(candidate: EquationLikeCandidate): string {
  return `${candidate.operator}:${candidate.lhsA}:${candidate.lhsB}:${candidate.rhs}`;
}

function normalizeOperator(
  operator: CanonicalOperator | string
): CanonicalOperator {
  if (operator === "ADD" || operator === "SUBTRACT") return operator;
  return operator as CanonicalOperator;
}

function isCrossTenAdd(a: number, b: number): boolean {
  return a < 10 && a + b >= 10;
}

function isCrossTenSubtract(a: number, b: number): boolean {
  return a > 10 && b > a % 10;
}

function isTrivialAdd(a: number, b: number): boolean {
  return a === 0 || b === 0 || a === 1 || b === 1;
}

function isTrivialSubtract(a: number, b: number): boolean {
  return b === 0 || b === 1 || a === b;
}

function buildEquationPoolFromLegacyProfile(
  profile: EquationGenerationProfile
): EquationLikeCandidate[] {
  const candidates: EquationLikeCandidate[] = [];
  const operators = profile.operators.map(normalizeOperator);

  for (const operator of operators) {
    for (let a = profile.minA; a <= profile.maxA; a += 1) {
      for (let b = profile.minB; b <= profile.maxB; b += 1) {
        let rhs: number;

        if (operator === "ADD") {
          rhs = a + b;
        } else if (operator === "SUBTRACT") {
          rhs = a - b;
        } else {
          continue;
        }

        if (!profile.allowZero && (a === 0 || b === 0 || rhs === 0)) {
          continue;
        }

        if (rhs < profile.minResult || rhs > profile.maxResult) {
          continue;
        }

        if (!profile.allowTwoDigitOperands && (a >= 10 || b >= 10)) {
          continue;
        }

        if (operator === "SUBTRACT" && rhs < 0) {
          continue;
        }

        const tags: string[] = [];
        let weight = 1;

        if (operator === "ADD") {
          tags.push("add");
          if (isCrossTenAdd(a, b)) {
            tags.push("cross_ten");
            weight += 0.35;
          }
          if (a >= 10 || b >= 10) {
            tags.push("two_digit_operand");
            weight += 0.25;
          }
          if (!isTrivialAdd(a, b)) {
            tags.push("non_trivial");
            weight += 0.15;
          }
        }

        if (operator === "SUBTRACT") {
          tags.push("subtract");
          if (isCrossTenSubtract(a, b)) {
            tags.push("cross_ten");
            weight += 0.35;
          }
          if (a >= 10 || b >= 10) {
            tags.push("two_digit_operand");
            weight += 0.25;
          }
          if (!isTrivialSubtract(a, b)) {
            tags.push("non_trivial");
            weight += 0.15;
          }
        }

        candidates.push(makeEquationCandidate(operator, a, b, rhs, tags, weight));
      }
    }
  }

  return uniqueByKey(candidates, equationKey);
}

/**
 * =========================================================
 * STRONGER PURPOSE-BUILT CANONICAL POOLS
 * These are the real migration target for the new profiles.
 * =========================================================
 */

function buildAddSubtractWithin20StrongPool(): EquationLikeCandidate[] {
  const candidates: EquationLikeCandidate[] = [];

  for (let a = 0; a <= 20; a += 1) {
    for (let b = 0; b <= 20; b += 1) {
      const addResult = a + b;
      if (addResult <= 20) {
        const tags = ["add"];
        let weight = 1;

        if (isCrossTenAdd(a, b)) {
          tags.push("cross_ten");
          weight += 0.45;
        }
        if (a >= 10 || b >= 10) {
          tags.push("two_digit_operand");
          weight += 0.35;
        }
        if (!isTrivialAdd(a, b)) {
          tags.push("non_trivial");
          weight += 0.2;
        }

        if (
          !(a === 0 && b === 0) &&
          !(a > 10 && b > 10) &&
          !(a === b && a <= 2)
        ) {
          candidates.push(
            makeEquationCandidate("ADD", a, b, addResult, tags, weight)
          );
        }
      }

      const subtractResult = a - b;
      if (subtractResult >= 0 && subtractResult <= 20) {
        const tags = ["subtract"];
        let weight = 1;

        if (isCrossTenSubtract(a, b)) {
          tags.push("cross_ten");
          weight += 0.45;
        }
        if (a >= 10 || b >= 10) {
          tags.push("two_digit_operand");
          weight += 0.35;
        }
        if (!isTrivialSubtract(a, b)) {
          tags.push("non_trivial");
          weight += 0.2;
        }

        if (!(a === b && a <= 2) && !(b === 0 && a <= 5)) {
          candidates.push(
            makeEquationCandidate("SUBTRACT", a, b, subtractResult, tags, weight)
          );
        }
      }
    }
  }

  return uniqueByKey(candidates, equationKey);
}

function buildAddSubtractWithin20CorePool(): EquationLikeCandidate[] {
  const source = buildAddSubtractWithin20StrongPool();

  return source
    .filter((candidate) => {
      const tags = new Set(candidate.tags ?? []);
      return (
        tags.has("add") ||
        tags.has("subtract") ||
        tags.has("cross_ten") ||
        tags.has("non_trivial")
      );
    })
    .map((candidate) => {
      const tags = [...(candidate.tags ?? [])];
      if (!tags.includes("sign_interpretation")) {
        tags.push("sign_interpretation");
      }
      if (!tags.includes("balanced_difficulty")) {
        tags.push("balanced_difficulty");
      }

      return {
        ...candidate,
        tags,
        weight: (candidate.weight ?? 1) + 0.1,
      };
    });
}

function buildNumberBondsRelatedFactsWithin20Pool(): EquationLikeCandidate[] {
  const candidates: EquationLikeCandidate[] = [];

  for (let total = 2; total <= 20; total += 1) {
    for (let a = 0; a <= total; a += 1) {
      const b = total - a;

      candidates.push(
        makeEquationCandidate(
          "ADD",
          a,
          b,
          total,
          ["add", "number_bonds"],
          a !== 0 && b !== 0 ? 1.3 : 1
        )
      );

      candidates.push(
        makeEquationCandidate(
          "SUBTRACT",
          total,
          a,
          b,
          ["subtract", "fact_family", "related_subtraction"],
          a !== 0 ? 1.25 : 1
        )
      );

      candidates.push(
        makeEquationCandidate(
          "SUBTRACT",
          total,
          b,
          a,
          ["subtract", "fact_family", "related_subtraction"],
          b !== 0 ? 1.25 : 1
        )
      );
    }
  }

  return uniqueByKey(candidates, equationKey).filter((candidate) => {
    if (candidate.operator === "ADD") {
      return candidate.rhs <= 20;
    }
    return candidate.rhs >= 0 && candidate.lhsA <= 20;
  });
}

function buildMissingNumberWithin20Pool(): CanonicalCandidate[] {
  const candidates: CanonicalCandidate[] = [];

  for (let a = 0; a <= 20; a += 1) {
    for (let b = 0; b <= 20; b += 1) {
      const total = a + b;
      if (total > 20) continue;

      candidates.push({
        itemType: "MISSING_NUMBER",
        tags: ["missing_left", "add"],
        weight: total >= 10 ? 1.2 : 1,
        content: {
          kind: "missing_number",
          template: "? + b = total",
          operator: "ADD",
          missing: "lhsA",
          lhsA: a,
          lhsB: b,
          rhs: total,
        },
      });

      candidates.push({
        itemType: "MISSING_NUMBER",
        tags: ["missing_right", "add"],
        weight: total >= 10 ? 1.2 : 1,
        content: {
          kind: "missing_number",
          template: "a + ? = total",
          operator: "ADD",
          missing: "lhsB",
          lhsA: a,
          lhsB: b,
          rhs: total,
        },
      });
    }
  }

  for (let a = 0; a <= 20; a += 1) {
    for (let b = 0; b <= a; b += 1) {
      const diff = a - b;

      candidates.push({
        itemType: "MISSING_NUMBER",
        tags: ["missing_right", "subtract"],
        weight: a >= 10 ? 1.15 : 1,
        content: {
          kind: "missing_number",
          template: "a - ? = diff",
          operator: "SUBTRACT",
          missing: "lhsB",
          lhsA: a,
          lhsB: b,
          rhs: diff,
        },
      });

      candidates.push({
        itemType: "MISSING_NUMBER",
        tags: ["missing_left", "subtract"],
        weight: a >= 10 ? 1.15 : 1,
        content: {
          kind: "missing_number",
          template: "? - b = diff",
          operator: "SUBTRACT",
          missing: "lhsA",
          lhsA: a,
          lhsB: b,
          rhs: diff,
        },
      });
    }
  }

  return uniqueByKey(
    candidates,
    (candidate) => JSON.stringify(candidate.content)
  ).map((candidate) => {
    const tags = new Set(candidate.tags ?? []);
    const content = candidate.content ?? {};
    const rhs = typeof content.rhs === "number" ? content.rhs : undefined;

    if (rhs !== undefined && rhs >= 10) {
      tags.add("teen_totals");
    }

    return {
      ...candidate,
      tags: [...tags],
    };
  });
}

/**
 * =========================================================
 * GENERIC / FALLBACK POOL BUILDERS
 * =========================================================
 */

function buildPoolFromCanonicalProfile(profile: CanonicalProfile): CanonicalCandidate[] {
  switch (profile.pool) {
    case "addSubtractWithin20Strong":
      return buildAddSubtractWithin20StrongPool();

    case "addSubtractWithin20Core":
      return buildAddSubtractWithin20CorePool();

    case "numberBondsRelatedFactsWithin20":
      return buildNumberBondsRelatedFactsWithin20Pool();

    case "missingNumberWithin20":
      return buildMissingNumberWithin20Pool();

    default:
      return [];
  }
}

/**
 * =========================================================
 * PUBLIC API
 * =========================================================
 */

export function buildCandidatePool(
  profile: CanonicalProfile | EquationGenerationProfile
): CanonicalCandidate[] {
  if (isEquationGenerationProfile(profile)) {
    return buildEquationPoolFromLegacyProfile(profile);
  }

  if (profile.pool) {
    const built = buildPoolFromCanonicalProfile(profile);
    if (built.length > 0) {
      return built;
    }
  }

  return [];
}

export function getEquationCandidates(
  profile: CanonicalProfile | EquationGenerationProfile
): EquationLikeCandidate[] {
  return buildCandidatePool(profile).filter(isEquationCandidate);
}