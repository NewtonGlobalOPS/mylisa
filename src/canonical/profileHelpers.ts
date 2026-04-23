import type {
  CanonicalProfile,
  EquationGenerationProfile,
  ObjectiveProfileDefinition,
  AnyGenerationProfile,
  DirectGeneratorName,
} from "./types";
import {
  isCanonicalProfile,
  isEquationGenerationProfile,
} from "./types";

/**
 * =========================================================
 * PROFILE FACTORIES
 * These helpers keep profile construction consistent while
 * we finish the migration away from the old mixed model.
 * =========================================================
 */

export function defineCanonicalProfile(
  profile: CanonicalProfile
): CanonicalProfile {
  return cloneCanonicalProfile(profile);
}

export function defineEquationProfile(
  profile: EquationGenerationProfile
): EquationGenerationProfile {
  return cloneEquationProfile(profile);
}

export function defineObjectiveProfile<TProfile extends AnyGenerationProfile>(
  objectiveCode: string,
  profile: TProfile
): ObjectiveProfileDefinition<TProfile> {
  return {
    objectiveCode,
    profile: cloneAnyProfile(profile),
  };
}

export function defineDirectProfile(
  objectiveCode: string,
  name: string,
  directGenerator: DirectGeneratorName,
  targetCount = 10
): ObjectiveProfileDefinition<CanonicalProfile> {
  return {
    objectiveCode,
    profile: {
      name,
      directGenerator,
      targetCount,
      diversity: {
        enforceVariety: true,
      },
    },
  };
}

export function definePoolProfile(
  objectiveCode: string,
  profile: CanonicalProfile
): ObjectiveProfileDefinition<CanonicalProfile> {
  return {
    objectiveCode,
    profile: cloneCanonicalProfile(profile),
  };
}

/**
 * =========================================================
 * CLONING
 * =========================================================
 */

export function cloneCanonicalProfile(profile: CanonicalProfile): CanonicalProfile {
  return {
    ...profile,
    constraints: profile.constraints ? { ...profile.constraints } : undefined,
    difficulty: profile.difficulty ? { ...profile.difficulty } : undefined,
    diversity: profile.diversity
      ? {
          ...profile.diversity,
          requiredForms: profile.diversity.requiredForms
            ? [...profile.diversity.requiredForms]
            : undefined,
        }
      : undefined,
  };
}

export function cloneEquationProfile(
  profile: EquationGenerationProfile
): EquationGenerationProfile {
  return {
    ...profile,
    operators: [...profile.operators],
    forms: [...profile.forms],
    targetDifficultySplit: { ...profile.targetDifficultySplit },
    diversity: { ...profile.diversity },
    candidateRules: profile.candidateRules
      ? { ...profile.candidateRules }
      : undefined,
  };
}

export function cloneAnyProfile<TProfile extends AnyGenerationProfile>(
  profile: TProfile
): TProfile {
  if (isCanonicalProfile(profile)) {
    return cloneCanonicalProfile(profile) as TProfile;
  }

  if (isEquationGenerationProfile(profile)) {
    return cloneEquationProfile(profile) as TProfile;
  }

  return { ...profile };
}

/**
 * =========================================================
 * NORMALIZATION / INSPECTION
 * =========================================================
 */

export function getProfileTargetCount(profile: AnyGenerationProfile): number {
  if (isCanonicalProfile(profile)) {
    return profile.targetCount;
  }

  return profile.count;
}

export function getProfileName(profile: AnyGenerationProfile): string {
  return profile.name;
}

export function getProfileDirectGenerator(
  profile: AnyGenerationProfile
): string | undefined {
  return profile.directGenerator;
}

export function getProfilePool(profile: AnyGenerationProfile): string | undefined {
  if (isCanonicalProfile(profile)) {
    return profile.pool;
  }

  return undefined;
}

export function profileUsesDirectGenerator(profile: AnyGenerationProfile): boolean {
  return Boolean(getProfileDirectGenerator(profile));
}

export function profileUsesPool(profile: AnyGenerationProfile): boolean {
  if (isCanonicalProfile(profile)) {
    return Boolean(profile.pool);
  }

  return true;
}

export function getRequiredForms(profile: AnyGenerationProfile): string[] {
  if (isCanonicalProfile(profile)) {
    return profile.diversity?.requiredForms
      ? [...profile.diversity.requiredForms]
      : [];
  }

  return [];
}

export function shouldEnforceVariety(profile: AnyGenerationProfile): boolean {
  if (isCanonicalProfile(profile)) {
    return profile.diversity?.enforceVariety !== false;
  }

  return true;
}

/**
 * =========================================================
 * PROFILE ADAPTATION
 * These help old code paths tolerate new profiles and vice versa.
 * =========================================================
 */

export function toCanonicalProfile(
  profile: AnyGenerationProfile
): CanonicalProfile {
  if (isCanonicalProfile(profile)) {
    return cloneCanonicalProfile(profile);
  }

  return {
    name: profile.name,
    pool: "legacyEquationPool",
    directGenerator: profile.directGenerator,
    targetCount: profile.count,
    constraints: {
      min: profile.minResult,
      max: profile.maxResult,
      allowNegative: false,
    },
    diversity: {
      enforceVariety: true,
    },
  };
}

export function mergeCanonicalProfile(
  base: CanonicalProfile,
  override: Partial<CanonicalProfile>
): CanonicalProfile {
  return {
    ...cloneCanonicalProfile(base),
    ...override,
    constraints:
      override.constraints || base.constraints
        ? {
            ...(base.constraints ?? {}),
            ...(override.constraints ?? {}),
          }
        : undefined,
    difficulty:
      override.difficulty || base.difficulty
        ? {
            ...(base.difficulty ?? {}),
            ...(override.difficulty ?? {}),
          }
        : undefined,
    diversity:
      override.diversity || base.diversity
        ? {
            ...(base.diversity ?? {}),
            ...(override.diversity ?? {}),
            requiredForms:
              override.diversity?.requiredForms ??
              base.diversity?.requiredForms ??
              undefined,
          }
        : undefined,
  };
}

export function renameProfile(
  profile: AnyGenerationProfile,
  name: string
): AnyGenerationProfile {
  if (isCanonicalProfile(profile)) {
    return {
      ...cloneCanonicalProfile(profile),
      name,
    };
  }

  if (isEquationGenerationProfile(profile)) {
    return {
      ...cloneEquationProfile(profile),
      name,
    };
  }

  return {
    ...profile,
    name,
  };
}

/**
 * =========================================================
 * LEGACY-COMPAT HELPERS
 * These keep older imports from exploding while we finish
 * removing the last stale equation/rule code paths.
 * =========================================================
 */

export function equationProfile(
  objectiveCode: string,
  profile: EquationGenerationProfile
): ObjectiveProfileDefinition<EquationGenerationProfile> {
  return defineObjectiveProfile(objectiveCode, profile);
}

export function directProfile(
  objectiveCode: string,
  name: string,
  directGenerator: DirectGeneratorName,
  count = 10
): ObjectiveProfileDefinition<CanonicalProfile> {
  return defineDirectProfile(objectiveCode, name, directGenerator, count);
}

export function poolProfile(
  objectiveCode: string,
  profile: CanonicalProfile
): ObjectiveProfileDefinition<CanonicalProfile> {
  return definePoolProfile(objectiveCode, profile);
}