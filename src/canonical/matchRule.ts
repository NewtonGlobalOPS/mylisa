import type { CurriculumObjective } from "@prisma/client";
import { ks1Year1MathsObjectiveRuleMap } from "./objectiveRuleMap.ks1y1.maths";
import type { CanonicalRuleName, ObjectiveRuleDefinition } from "./types";

function includesAny(haystack: string, needles?: string[]): boolean {
  if (!needles || needles.length === 0) return false;
  const lower = haystack.toLowerCase();
  return needles.some((n) => lower.includes(n.toLowerCase()));
}

function matchesDefinition(
  objective: Pick<CurriculumObjective, "code" | "title" | "statement">,
  def: ObjectiveRuleDefinition
): boolean {
  if (def.objectiveCode && objective.code === def.objectiveCode) {
    return true;
  }

  const titleMatch = includesAny(objective.title, def.objectiveTitleIncludes);
  const statementMatch = includesAny(objective.statement, def.objectiveStatementIncludes);

  return titleMatch || statementMatch;
}

export function matchCanonicalRuleForObjective(
  objective: Pick<CurriculumObjective, "code" | "title" | "statement">
): CanonicalRuleName {
  for (const def of ks1Year1MathsObjectiveRuleMap) {
    if (matchesDefinition(objective, def)) {
      return def.rule;
    }
  }

  throw new Error(
    `No canonical rule mapping found for objective ${objective.code} | ${objective.title}`
  );
}