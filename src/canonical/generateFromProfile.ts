import type { DifficultyBand } from "@prisma/client";
import { buildCandidatePool } from "./poolBuilders";
import { renderCanonicalCandidate } from "./render";
import { selectCanonicalCandidates } from "./selector";
import type {
  CanonicalCandidate,
  CanonicalProfile,
  EquationGenerationProfile,
  GeneratedCanonicalQuestion,
} from "./types";
import { isCanonicalProfile, isEquationGenerationProfile } from "./types";
import { generateDirectQuestions } from "./directGenerators";

/**
 * =========================================================
 * INTERNAL HELPERS
 * =========================================================
 */

function getTargetCount(
  profile: CanonicalProfile | EquationGenerationProfile
): number {
  if (isCanonicalProfile(profile)) {
    return profile.targetCount;
  }
  return profile.count;
}

function inferDifficultyFromEquation(
  lhsA?: number,
  lhsB?: number,
  rhs?: number
): DifficultyBand {
  const numbers = [lhsA, lhsB, rhs].filter(
    (value): value is number => typeof value === "number"
  );

  const maxValue = numbers.length > 0 ? Math.max(...numbers) : 0;
  const minValue = numbers.length > 0 ? Math.min(...numbers) : 0;

  if (maxValue <= 10 && minValue >= 0) return "EASY";
  if (maxValue <= 20) return "MEDIUM";
  return "HARD";
}

function inferDifficultyFromTags(tags?: string[]): DifficultyBand {
  const tagSet = new Set(tags ?? []);

  if (tagSet.has("cross_ten") || tagSet.has("two_digit_operand")) {
    return "HARD";
  }

  if (
    tagSet.has("teen_totals") ||
    tagSet.has("fact_family") ||
    tagSet.has("related_subtraction") ||
    tagSet.has("missing_left") ||
    tagSet.has("missing_right")
  ) {
    return "MEDIUM";
  }

  return "EASY";
}

function inferDifficulty(candidate: CanonicalCandidate): DifficultyBand {
  const content = candidate.content ?? {};

  if (
    typeof candidate.lhsA === "number" ||
    typeof candidate.lhsB === "number" ||
    typeof candidate.rhs === "number"
  ) {
    const base = inferDifficultyFromEquation(
      candidate.lhsA,
      candidate.lhsB,
      candidate.rhs
    );
    const tagDifficulty = inferDifficultyFromTags(candidate.tags);

    if (base === "HARD" || tagDifficulty === "HARD") return "HARD";
    if (base === "MEDIUM" || tagDifficulty === "MEDIUM") return "MEDIUM";
    return "EASY";
  }

  if (
    typeof content.lhsA === "number" ||
    typeof content.lhsB === "number" ||
    typeof content.rhs === "number"
  ) {
    const base = inferDifficultyFromEquation(
      typeof content.lhsA === "number" ? content.lhsA : undefined,
      typeof content.lhsB === "number" ? content.lhsB : undefined,
      typeof content.rhs === "number" ? content.rhs : undefined
    );
    const tagDifficulty = inferDifficultyFromTags(candidate.tags);

    if (base === "HARD" || tagDifficulty === "HARD") return "HARD";
    if (base === "MEDIUM" || tagDifficulty === "MEDIUM") return "MEDIUM";
    return "EASY";
  }

  return inferDifficultyFromTags(candidate.tags);
}

function attachGeneratorMetadata(
  question: GeneratedCanonicalQuestion,
  profile: CanonicalProfile | EquationGenerationProfile
): GeneratedCanonicalQuestion {
  return {
    ...question,
    generatorVersion: question.generatorVersion ?? "canonical-v2",
    generatorMeta: {
      ...(question.generatorMeta ?? {}),
      profileName: profile.name,
      profileKind: isCanonicalProfile(profile) ? "canonical" : "equation-legacy",
      pool: isCanonicalProfile(profile) ? profile.pool ?? null : null,
      tags: question.generatorMeta?.tags ?? [],
    },
  };
}

function buildGeneratedQuestionFromCandidate(
  candidate: CanonicalCandidate,
  profile: CanonicalProfile | EquationGenerationProfile
): GeneratedCanonicalQuestion | null {
  const rendered = renderCanonicalCandidate(candidate);
  if (!rendered) return null;

  const difficulty = inferDifficulty(candidate);

  return attachGeneratorMetadata(
    {
      itemType: rendered.itemType,
      promptText: rendered.promptText,
      answerText: rendered.answerText,
      difficulty,
      operator: rendered.operator,
      lhsA: rendered.lhsA,
      lhsB: rendered.lhsB,
      rhs: rendered.rhs,
      equation: rendered.equation,
      contentJson: rendered.contentJson,
      generatorMeta: {
        tags: candidate.tags ?? [],
        weight: candidate.weight ?? 1,
      },
    },
    profile
  );
}

function dedupeGeneratedQuestions(
  questions: GeneratedCanonicalQuestion[]
): GeneratedCanonicalQuestion[] {
  const seen = new Set<string>();
  const out: GeneratedCanonicalQuestion[] = [];

  for (const question of questions) {
    const key = JSON.stringify({
      itemType: question.itemType,
      promptText: question.promptText,
      answerText: question.answerText,
      operator: question.operator ?? null,
      lhsA: question.lhsA ?? null,
      lhsB: question.lhsB ?? null,
      rhs: question.rhs ?? null,
      contentJson: question.contentJson ?? null,
    });

    if (seen.has(key)) continue;
    seen.add(key);
    out.push(question);
  }

  return out;
}

/**
 * =========================================================
 * PROFILE GENERATION LANES
 * =========================================================
 */

function generateFromPoolProfile(
  profile: CanonicalProfile | EquationGenerationProfile
): GeneratedCanonicalQuestion[] {
  const pool = buildCandidatePool(profile);
  if (pool.length === 0) {
    return [];
  }

  const targetCount = getTargetCount(profile);
  const selected = selectCanonicalCandidates(pool, targetCount, profile);

  return dedupeGeneratedQuestions(
    selected
      .map((candidate) => buildGeneratedQuestionFromCandidate(candidate, profile))
      .filter((item): item is GeneratedCanonicalQuestion => item !== null)
  ).slice(0, targetCount);
}

function generateFromDirectProfile(
  profile: CanonicalProfile | EquationGenerationProfile
): GeneratedCanonicalQuestion[] {
  const directGenerator =
    (isCanonicalProfile(profile) ? profile.directGenerator : profile.directGenerator) ??
    null;

  if (!directGenerator) {
    return [];
  }

  const targetCount = getTargetCount(profile);

  const generated = generateDirectQuestions(directGenerator, {
    targetCount,
    profileName: profile.name,
  });

  return dedupeGeneratedQuestions(
    generated.map((question) =>
      attachGeneratorMetadata(
        {
          ...question,
          generatorVersion: question.generatorVersion ?? "canonical-v2-direct",
          generatorMeta: {
            ...(question.generatorMeta ?? {}),
            directGenerator,
          },
        },
        profile
      )
    )
  ).slice(0, targetCount);
}

/**
 * =========================================================
 * PUBLIC API
 * =========================================================
 */

export function generateFromProfile(
  profile: CanonicalProfile | EquationGenerationProfile
): GeneratedCanonicalQuestion[] {
  if (isCanonicalProfile(profile)) {
    if (profile.directGenerator) {
      const direct = generateFromDirectProfile(profile);
      if (direct.length > 0) return direct;
    }

    if (profile.pool) {
      const pooled = generateFromPoolProfile(profile);
      if (pooled.length > 0) return pooled;
    }

    return [];
  }

  if (isEquationGenerationProfile(profile)) {
    if (profile.directGenerator) {
      const direct = generateFromDirectProfile(profile);
      if (direct.length > 0) return direct;
    }

    return generateFromPoolProfile(profile);
  }

  return [];
}

/**
 * Backwards-compatible export for older scripts.
 */
export const generateCanonicalQuestionsFromProfile = generateFromProfile;