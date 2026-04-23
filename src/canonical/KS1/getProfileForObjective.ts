import { ks1Year1MathsProfiles } from "../profiles.ks1y1.maths";
import type {
  AnyGenerationProfile,
  ObjectiveProfileDefinition,
} from "../types";

/**
 * =========================================================
 * OBJECTIVE INPUT SHAPES
 * Keep this tolerant so it works with Oak rows, Prisma rows,
 * or ad hoc script inputs during migration.
 * =========================================================
 */

export type ObjectiveLike = {
  id?: string;
  code?: string;
  objectiveCode?: string;
  oakCode?: string;
  statement?: string | null;
  title?: string | null;
};

const ALL_PROFILE_SETS: ObjectiveProfileDefinition<AnyGenerationProfile>[] = [
  ...ks1Year1MathsProfiles,
];

/**
 * =========================================================
 * INTERNAL HELPERS
 * =========================================================
 */

function normalize(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function normalizeKey(value: string | null | undefined): string {
  return normalize(value).toLowerCase();
}

function getObjectiveCode(objective: ObjectiveLike | string): string {
  if (typeof objective === "string") {
    return normalize(objective);
  }

  return (
    normalize(objective.code) ||
    normalize(objective.objectiveCode) ||
    normalize(objective.oakCode) ||
    normalize(objective.id)
  );
}

function getObjectiveTextHaystack(objective: ObjectiveLike): string {
  return [
    normalize(objective.code),
    normalize(objective.objectiveCode),
    normalize(objective.oakCode),
    normalize(objective.title),
    normalize(objective.statement),
  ]
    .filter(Boolean)
    .join(" | ")
    .toLowerCase();
}

function cloneProfileDefinition<TProfile extends AnyGenerationProfile>(
  definition: ObjectiveProfileDefinition<TProfile>
): ObjectiveProfileDefinition<TProfile> {
  const profile = definition.profile;

  return {
    objectiveCode: definition.objectiveCode,
    profile: {
      ...profile,
      constraints:
        "constraints" in profile && profile.constraints
          ? { ...profile.constraints }
          : undefined,
      difficulty:
        "difficulty" in profile && profile.difficulty
          ? { ...profile.difficulty }
          : undefined,
      diversity:
        "diversity" in profile && profile.diversity
          ? { ...profile.diversity }
          : undefined,
      targetDifficultySplit:
        "targetDifficultySplit" in profile && profile.targetDifficultySplit
          ? { ...profile.targetDifficultySplit }
          : undefined,
      candidateRules:
        "candidateRules" in profile && profile.candidateRules
          ? { ...profile.candidateRules }
          : undefined,
    } as TProfile,
  };
}

/**
 * =========================================================
 * LOOKUP
 * =========================================================
 */

export function getProfileDefinitionForObjective(
  objective: ObjectiveLike | string
): ObjectiveProfileDefinition<AnyGenerationProfile> | null {
  const objectiveCode = normalizeKey(getObjectiveCode(objective));
  if (!objectiveCode) {
    return null;
  }

  const exact = ALL_PROFILE_SETS.find(
    (entry) => normalizeKey(entry.objectiveCode) === objectiveCode
  );

  if (exact) {
    return cloneProfileDefinition(exact);
  }

  return null;
}

export function getProfileForObjective(
  objective: ObjectiveLike | string
): AnyGenerationProfile | null {
  const definition = getProfileDefinitionForObjective(objective);
  return definition ? definition.profile : null;
}

/**
 * Useful for debugging drift and coverage during migration.
 */
export function hasProfileForObjective(objective: ObjectiveLike | string): boolean {
  return getProfileForObjective(objective) !== null;
}

export function listAllProfileDefinitions(): ObjectiveProfileDefinition<AnyGenerationProfile>[] {
  return ALL_PROFILE_SETS.map((entry) => cloneProfileDefinition(entry));
}

export function listAllMappedObjectiveCodes(): string[] {
  return ALL_PROFILE_SETS.map((entry) => entry.objectiveCode);
}

/**
 * =========================================================
 * COVERAGE / DEBUG HELPERS
 * =========================================================
 */

export function findUnmappedObjectives<T extends ObjectiveLike>(
  objectives: T[]
): T[] {
  return objectives.filter((objective) => !hasProfileForObjective(objective));
}

export function explainProfileLookup(
  objective: ObjectiveLike | string
):
  | {
      matched: true;
      objectiveCode: string;
      profileName: string;
      haystack?: string;
    }
  | {
      matched: false;
      objectiveCode: string;
      haystack?: string;
    } {
  const objectiveCode = getObjectiveCode(objective);

  if (typeof objective === "string") {
    const matched = getProfileDefinitionForObjective(objective);
    if (matched) {
      return {
        matched: true,
        objectiveCode,
        profileName: matched.profile.name,
      };
    }

    return {
      matched: false,
      objectiveCode,
    };
  }

  const haystack = getObjectiveTextHaystack(objective);
  const matched = getProfileDefinitionForObjective(objective);

  if (matched) {
    return {
      matched: true,
      objectiveCode,
      profileName: matched.profile.name,
      haystack,
    };
  }

  return {
    matched: false,
    objectiveCode,
    haystack,
  };
}
