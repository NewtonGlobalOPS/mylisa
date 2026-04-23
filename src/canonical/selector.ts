import type {
  CanonicalCandidate,
  CanonicalProfile,
  EquationGenerationProfile,
} from "./types";
import { isCanonicalProfile, isEquationGenerationProfile } from "./types";

/**
 * =========================================================
 * INTERNAL TYPES
 * =========================================================
 */

type SelectorProfile = CanonicalProfile | EquationGenerationProfile;

type ScoredCandidate = {
  candidate: CanonicalCandidate;
  score: number;
  key: string;
};

type SelectionState = {
  picked: CanonicalCandidate[];
  pickedKeys: Set<string>;
  resultCounts: Map<string, number>;
  tagCounts: Map<string, number>;
  operatorCounts: Map<string, number>;
  promptCounts: Map<string, number>;
};

/**
 * =========================================================
 * BASIC HELPERS
 * =========================================================
 */

function getCandidateKey(candidate: CanonicalCandidate): string {
  return JSON.stringify({
    itemType: candidate.itemType ?? null,
    operator: candidate.operator ?? null,
    lhsA: candidate.lhsA ?? null,
    lhsB: candidate.lhsB ?? null,
    rhs: candidate.rhs ?? null,
    promptParts: candidate.promptParts ?? null,
    answer: candidate.answer ?? null,
    content: candidate.content ?? null,
  });
}

function getPromptFamilyKey(candidate: CanonicalCandidate): string {
  if (candidate.content && typeof candidate.content.template === "string") {
    return `template:${candidate.content.template}`;
  }

  if (typeof candidate.promptParts === "string") {
    return `prompt:${candidate.promptParts}`;
  }

  if (Array.isArray(candidate.promptParts)) {
    return `prompt:${JSON.stringify(candidate.promptParts)}`;
  }

  if (
    typeof candidate.operator === "string" &&
    typeof candidate.lhsA === "number" &&
    typeof candidate.lhsB === "number" &&
    typeof candidate.rhs === "number"
  ) {
    return `equation:${candidate.operator}`;
  }

  return `generic:${candidate.itemType ?? "unknown"}`;
}

function getResultKey(candidate: CanonicalCandidate): string | null {
  if (typeof candidate.rhs === "number") {
    return String(candidate.rhs);
  }

  if (
    candidate.content &&
    typeof candidate.content === "object" &&
    typeof candidate.content.rhs === "number"
  ) {
    return String(candidate.content.rhs);
  }

  return null;
}

function getOperatorKey(candidate: CanonicalCandidate): string | null {
  if (typeof candidate.operator === "string") {
    return candidate.operator;
  }

  if (
    candidate.content &&
    typeof candidate.content === "object" &&
    typeof candidate.content.operator === "string"
  ) {
    return candidate.content.operator;
  }

  return null;
}

function getTags(candidate: CanonicalCandidate): string[] {
  return Array.isArray(candidate.tags) ? candidate.tags : [];
}

function getTargetCount(profile: SelectorProfile): number {
  if (isCanonicalProfile(profile)) return profile.targetCount;
  return profile.count;
}

function getRequiredForms(profile: SelectorProfile): string[] {
  if (!isCanonicalProfile(profile)) return [];
  return profile.diversity?.requiredForms ?? [];
}

function shouldEnforceVariety(profile: SelectorProfile): boolean {
  if (isCanonicalProfile(profile)) {
    return profile.diversity?.enforceVariety !== false;
  }

  return true;
}

function isEquationLike(candidate: CanonicalCandidate): boolean {
  return (
    typeof getOperatorKey(candidate) === "string" &&
    ((typeof candidate.lhsA === "number" &&
      typeof candidate.lhsB === "number" &&
      typeof candidate.rhs === "number") ||
      (candidate.content !== undefined &&
        typeof candidate.content === "object" &&
        typeof candidate.content.lhsA === "number" &&
        typeof candidate.content.lhsB === "number" &&
        typeof candidate.content.rhs === "number"))
  );
}

function hasCommutativeTwin(
  candidate: CanonicalCandidate,
  state: SelectionState
): boolean {
  const operator = getOperatorKey(candidate);
  if (operator !== "ADD") return false;

  const a =
    typeof candidate.lhsA === "number"
      ? candidate.lhsA
      : typeof candidate.content?.lhsA === "number"
      ? candidate.content.lhsA
      : null;
  const b =
    typeof candidate.lhsB === "number"
      ? candidate.lhsB
      : typeof candidate.content?.lhsB === "number"
      ? candidate.content.lhsB
      : null;
  const rhs =
    typeof candidate.rhs === "number"
      ? candidate.rhs
      : typeof candidate.content?.rhs === "number"
      ? candidate.content.rhs
      : null;

  if (a === null || b === null || rhs === null) return false;

  const twinKey = JSON.stringify({
    itemType: candidate.itemType ?? null,
    operator,
    lhsA: b,
    lhsB: a,
    rhs,
    promptParts: candidate.promptParts ?? null,
    answer: candidate.answer ?? null,
    content:
      candidate.content && typeof candidate.content === "object"
        ? {
            ...candidate.content,
            lhsA: b,
            lhsB: a,
            rhs,
          }
        : candidate.content ?? null,
  });

  return state.pickedKeys.has(twinKey);
}

function makeInitialState(): SelectionState {
  return {
    picked: [],
    pickedKeys: new Set<string>(),
    resultCounts: new Map<string, number>(),
    tagCounts: new Map<string, number>(),
    operatorCounts: new Map<string, number>(),
    promptCounts: new Map<string, number>(),
  };
}

function incrementMap(map: Map<string, number>, key: string): void {
  map.set(key, (map.get(key) ?? 0) + 1);
}

function addToState(state: SelectionState, candidate: CanonicalCandidate): void {
  const key = getCandidateKey(candidate);
  state.picked.push(candidate);
  state.pickedKeys.add(key);

  const resultKey = getResultKey(candidate);
  if (resultKey) incrementMap(state.resultCounts, resultKey);

  const operatorKey = getOperatorKey(candidate);
  if (operatorKey) incrementMap(state.operatorCounts, operatorKey);

  const promptKey = getPromptFamilyKey(candidate);
  incrementMap(state.promptCounts, promptKey);

  for (const tag of getTags(candidate)) {
    incrementMap(state.tagCounts, tag);
  }
}

/**
 * =========================================================
 * SCORING
 * =========================================================
 */

function baseScore(candidate: CanonicalCandidate): number {
  let score = candidate.weight ?? 1;

  const tags = new Set(getTags(candidate));

  if (tags.has("cross_ten")) score += 1.5;
  if (tags.has("two_digit_operand")) score += 1.2;
  if (tags.has("non_trivial")) score += 0.8;
  if (tags.has("fact_family")) score += 0.8;
  if (tags.has("related_subtraction")) score += 0.7;
  if (tags.has("number_bonds")) score += 0.6;
  if (tags.has("missing_left")) score += 0.6;
  if (tags.has("missing_right")) score += 0.6;
  if (tags.has("teen_totals")) score += 0.5;
  if (tags.has("sign_interpretation")) score += 0.5;
  if (tags.has("balanced_difficulty")) score += 0.3;

  return score;
}

function scoreCandidateAgainstState(
  candidate: CanonicalCandidate,
  state: SelectionState,
  profile: SelectorProfile
): number {
  let score = baseScore(candidate);

  const tags = getTags(candidate);
  const requiredForms = getRequiredForms(profile);
  const operatorKey = getOperatorKey(candidate);
  const resultKey = getResultKey(candidate);
  const promptKey = getPromptFamilyKey(candidate);

  for (const form of requiredForms) {
    if (tags.includes(form) && (state.tagCounts.get(form) ?? 0) === 0) {
      score += 4;
    }
  }

  if (resultKey) {
    const existing = state.resultCounts.get(resultKey) ?? 0;
    if (existing === 0) score += 0.9;
    if (existing >= 1) score -= 1.25 * existing;
  }

  if (operatorKey) {
    const existing = state.operatorCounts.get(operatorKey) ?? 0;
    const totalPicked = Math.max(state.picked.length, 1);
    const ratio = existing / totalPicked;

    if (ratio >= 0.7) score -= 1.4;
    else if (ratio >= 0.55) score -= 0.8;
    else if (existing === 0) score += 0.6;
  }

  const promptRepeats = state.promptCounts.get(promptKey) ?? 0;
  if (promptRepeats >= 1) score -= 1.1 * promptRepeats;

  for (const tag of tags) {
    const count = state.tagCounts.get(tag) ?? 0;
    if (count === 0) score += 0.4;
    if (count >= 2) score -= 0.35 * count;
  }

  if (hasCommutativeTwin(candidate, state)) {
    score -= 10;
  }

  return score;
}

function preSortCandidates(pool: CanonicalCandidate[]): ScoredCandidate[] {
  return pool
    .map((candidate) => ({
      candidate,
      score: baseScore(candidate),
      key: getCandidateKey(candidate),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.key.localeCompare(b.key);
    });
}

/**
 * =========================================================
 * SELECTION PASSES
 * =========================================================
 */

function selectRequiredFormsFirst(
  preSorted: ScoredCandidate[],
  state: SelectionState,
  profile: SelectorProfile,
  targetCount: number
): void {
  const requiredForms = getRequiredForms(profile);
  if (requiredForms.length === 0) return;

  for (const form of requiredForms) {
    if (state.picked.length >= targetCount) break;
    if ((state.tagCounts.get(form) ?? 0) > 0) continue;

    const best = preSorted
      .filter(({ candidate, key }) => {
        if (state.pickedKeys.has(key)) return false;
        return getTags(candidate).includes(form);
      })
      .map(({ candidate }) => ({
        candidate,
        score: scoreCandidateAgainstState(candidate, state, profile),
      }))
      .sort((a, b) => b.score - a.score)[0];

    if (best && best.score > -999) {
      addToState(state, best.candidate);
    }
  }
}

function selectBalancedCore(
  preSorted: ScoredCandidate[],
  state: SelectionState,
  profile: SelectorProfile,
  targetCount: number
): void {
  while (state.picked.length < targetCount) {
    const remaining = preSorted.filter(({ key }) => !state.pickedKeys.has(key));
    if (remaining.length === 0) break;

    const scored = remaining
      .map(({ candidate, key }) => ({
        candidate,
        key,
        score: scoreCandidateAgainstState(candidate, state, profile),
      }))
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return a.key.localeCompare(b.key);
      });

    const best = scored[0];
    if (!best) break;

    addToState(state, best.candidate);
  }
}

function topUpWithDeterministicSpread(
  pool: CanonicalCandidate[],
  state: SelectionState,
  targetCount: number
): void {
  if (state.picked.length >= targetCount) return;

  const remaining = pool.filter(
    (candidate) => !state.pickedKeys.has(getCandidateKey(candidate))
  );

  if (remaining.length === 0) return;

  const spread = remaining.sort((a, b) =>
    getCandidateKey(a).localeCompare(getCandidateKey(b))
  );

  const needed = targetCount - state.picked.length;
  if (needed <= 0) return;

  if (spread.length <= needed) {
    for (const candidate of spread) addToState(state, candidate);
    return;
  }

  for (let i = 0; i < needed; i += 1) {
    const index = Math.floor((i * spread.length) / needed);
    const candidate = spread[index];
    if (candidate && !state.pickedKeys.has(getCandidateKey(candidate))) {
      addToState(state, candidate);
    }
  }
}

/**
 * =========================================================
 * PUBLIC API
 * =========================================================
 */

export function selectCanonicalCandidates(
  pool: CanonicalCandidate[],
  targetCount: number,
  profile: SelectorProfile
): CanonicalCandidate[] {
  if (targetCount <= 0 || pool.length === 0) {
    return [];
  }

  const effectiveTarget = Math.min(targetCount, pool.length);

  if (!shouldEnforceVariety(profile)) {
    return preSortCandidates(pool)
      .slice(0, effectiveTarget)
      .map(({ candidate }) => candidate);
  }

  const preSorted = preSortCandidates(pool);
  const state = makeInitialState();

  selectRequiredFormsFirst(preSorted, state, profile, effectiveTarget);
  selectBalancedCore(preSorted, state, profile, effectiveTarget);
  topUpWithDeterministicSpread(pool, state, effectiveTarget);

  return state.picked.slice(0, effectiveTarget);
}

export function selectFromProfilePool(
  pool: CanonicalCandidate[],
  profile: SelectorProfile
): CanonicalCandidate[] {
  return selectCanonicalCandidates(pool, getTargetCount(profile), profile);
}

export function scoreCandidate(
  candidate: CanonicalCandidate,
  alreadyPicked: CanonicalCandidate[],
  profile: SelectorProfile
): number {
  const state = makeInitialState();
  for (const picked of alreadyPicked) {
    addToState(state, picked);
  }
  return scoreCandidateAgainstState(candidate, state, profile);
}

export function hasEnoughVariation(
  selected: CanonicalCandidate[],
  profile: SelectorProfile
): boolean {
  const requiredForms = getRequiredForms(profile);
  const tags = new Set(selected.flatMap((candidate) => getTags(candidate)));

  for (const form of requiredForms) {
    if (!tags.has(form)) return false;
  }

  const equationItems = selected.filter(isEquationLike);
  if (equationItems.length >= 6) {
    const distinctResults = new Set(
      equationItems.map((candidate) => getResultKey(candidate)).filter(Boolean)
    ).size;

    if (distinctResults < Math.min(5, equationItems.length)) {
      return false;
    }
  }

  return true;
}