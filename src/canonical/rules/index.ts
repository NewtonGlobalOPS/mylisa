import type { CanonicalRuleGenerator, CanonicalRuleName } from "../types";
import { addWithin10 } from "./addWithin10";
import { subtractWithin10 } from "./subtractWithin10";
import { numberBondsWithin10 } from "./numberBondsWithin10";

export const canonicalRuleGenerators: Record<CanonicalRuleName, CanonicalRuleGenerator> = {
  add_within_10: addWithin10,
  subtract_within_10: subtractWithin10,
  number_bonds_within_10: numberBondsWithin10,
};