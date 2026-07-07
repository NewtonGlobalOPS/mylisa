import type {
  CanonicalProfile,
  DirectGeneratorName,
  ObjectiveProfileDefinition,
} from "./types";

function poolProfile(
  objectiveCode: string,
  profile: CanonicalProfile
): ObjectiveProfileDefinition<CanonicalProfile> {
  return { objectiveCode, profile };
}

function directProfile(
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

function cloneProfile(
  profile: CanonicalProfile,
  name: string
): CanonicalProfile {
  return {
    ...profile,
    name,
    constraints: profile.constraints ? { ...profile.constraints } : undefined,
    difficulty: profile.difficulty ? { ...profile.difficulty } : undefined,
    diversity: profile.diversity ? { ...profile.diversity } : undefined,
  };
}

/**
 * =========================================================
 * EQUATION / MISSING-NUMBER CANONICAL PROFILES
 * These now target the new CanonicalProfile architecture.
 *
 * NOTE:
 * The pool names below are intentional. The next migration step
 * is to make poolBuilders.ts provide these mixed / higher-variation
 * pools properly.
 * =========================================================
 */

const addSubtractTo20Strong: CanonicalProfile = {
  name: "add_subtract_one_digit_and_two_digit_to_20",
  pool: "addSubtractWithin20Strong",
  targetCount: 10,
  constraints: {
    min: 0,
    max: 20,
  },
  difficulty: {
    easyMax: 8,
    mediumMax: 14,
  },
  diversity: {
    enforceVariety: true,
    requiredForms: [
      "add",
      "subtract",
      "cross_ten",
      "two_digit_operand",
      "non_trivial",
    ],
  },
};

const readWriteInterpretAddSubtractTo20: CanonicalProfile = {
  name: "read_write_interpret_add_subtract_signs_to_20",
  pool: "addSubtractWithin20Core",
  targetCount: 10,
  constraints: {
    min: 0,
    max: 20,
  },
  difficulty: {
    easyMax: 8,
    mediumMax: 14,
  },
  diversity: {
    enforceVariety: true,
    requiredForms: [
      "add",
      "subtract",
      "sign_interpretation",
      "balanced_difficulty",
    ],
  },
};

const numberBondsRelatedFactsWithin20: CanonicalProfile = {
  name: "number_bonds_and_related_subtraction_facts_within_20",
  pool: "numberBondsRelatedFactsWithin20",
  targetCount: 10,
  constraints: {
    min: 0,
    max: 20,
  },
  difficulty: {
    easyMax: 10,
    mediumMax: 15,
  },
  diversity: {
    enforceVariety: true,
    requiredForms: [
      "number_bonds",
      "fact_family",
      "related_subtraction",
    ],
  },
};

const oneStepAddSubtractTo20: CanonicalProfile = {
  name: "one_step_add_subtract_to_20",
  pool: "missingNumberWithin20",
  targetCount: 10,
  constraints: {
    min: 0,
    max: 20,
  },
  difficulty: {
    easyMax: 8,
    mediumMax: 14,
  },
  diversity: {
    enforceVariety: true,
    requiredForms: [
      "missing_left",
      "missing_right",
      "teen_totals",
    ],
  },
};

export const ks1Year1MathsProfiles: ObjectiveProfileDefinition<CanonicalProfile>[] = [
  /**
   * Additive structures: addition
   */
  poolProfile(
    "oak:maths:ks1:additive-structures-addition:d84a827227eab9f543608b7d13de2faa68a4447e",
    addSubtractTo20Strong
  ),
  poolProfile(
    "oak:maths:ks1:additive-structures-addition:0661d249d6b5e4d6a22e174be7a3f97271c75dae",
    readWriteInterpretAddSubtractTo20
  ),
  poolProfile(
    "oak:maths:ks1:additive-structures-addition:f7423167403accb6caced956439e54717846131f",
    numberBondsRelatedFactsWithin20
  ),
  poolProfile(
    "oak:maths:ks1:additive-structures-addition:08d510b4b0de32c3875d54f34b9c96485ced41fe",
    oneStepAddSubtractTo20
  ),

  /**
   * Additive structures: addition and subtraction
   */
  poolProfile(
    "oak:maths:ks1:additive-structures-addition-and-subtraction:d84a827227eab9f543608b7d13de2faa68a4447e",
    cloneProfile(
      addSubtractTo20Strong,
      "add_subtract_one_digit_and_two_digit_to_20_dup"
    )
  ),
  poolProfile(
    "oak:maths:ks1:additive-structures-addition-and-subtraction:0661d249d6b5e4d6a22e174be7a3f97271c75dae",
    cloneProfile(
      readWriteInterpretAddSubtractTo20,
      "read_write_interpret_add_subtract_signs_to_20_dup"
    )
  ),
  poolProfile(
    "oak:maths:ks1:additive-structures-addition-and-subtraction:f7423167403accb6caced956439e54717846131f",
    cloneProfile(
      numberBondsRelatedFactsWithin20,
      "number_bonds_and_related_subtraction_facts_within_20_dup"
    )
  ),
  poolProfile(
    "oak:maths:ks1:additive-structures-addition-and-subtraction:08d510b4b0de32c3875d54f34b9c96485ced41fe",
    cloneProfile(oneStepAddSubtractTo20, "one_step_add_subtract_to_20_dup")
  ),

  /**
   * Comparing quantities / part-whole
   */
  directProfile(
    "oak:maths:ks1:comparing-quantities-part-whole-relationships:fbb324c00e987d385834b34a0dc431a20c8b3ef5",
    "measurement_compare",
    "measurement_compare"
  ),
  directProfile(
    "oak:maths:ks1:comparing-quantities-part-whole-relationships:e8186eb516bcf741525f5d1eb7a6c54dd980dcf7",
    "one_more_one_less_to_20",
    "one_more_one_less_to_20"
  ),
  directProfile(
    "oak:maths:ks1:comparing-quantities-part-whole-relationships:31c99b03d8c29e6e1d7a753b3b6078aedb1229a6",
    "number_line_within_20",
    "number_line_within_20"
  ),

  /**
   * Counting in tens / decade numbers
   */
  directProfile(
    "oak:maths:ks1:counting-in-tens-decade-numbers:b477fe0bbe8b39438714b95e270c5415913a5fc3",
    "count_in_10s",
    "count_in_10s"
  ),
  directProfile(
    "oak:maths:ks1:counting-in-tens-decade-numbers:490635989035e0cfa0e901929677334ce9c62e73",
    "count_in_10s_reinforced",
    "count_in_10s"
  ),
  directProfile(
    "oak:maths:ks1:counting-in-tens-decade-numbers:31c99b03d8c29e6e1d7a753b3b6078aedb1229a6",
    "number_line_within_20_counting_strand",
    "number_line_within_20"
  ),

  /**
   * Numbers 0 to 20 in different contexts
   */
  poolProfile(
    "oak:maths:ks1:numbers-0-to-20-in-different-contexts:d84a827227eab9f543608b7d13de2faa68a4447e",
    cloneProfile(
      addSubtractTo20Strong,
      "add_subtract_one_digit_and_two_digit_to_20_contexts"
    )
  ),
  directProfile(
    "oak:maths:ks1:numbers-0-to-20-in-different-contexts:fbb324c00e987d385834b34a0dc431a20c8b3ef5",
    "measurement_compare_contexts",
    "measurement_compare"
  ),
  directProfile(
    "oak:maths:ks1:numbers-0-to-20-in-different-contexts:de87e31138f572d42a3ac4fae1cda0785bed4b44",
    "measurement_compare_read_record_contexts",
    "measurement_compare"
  ),
  poolProfile(
    "oak:maths:ks1:numbers-0-to-20-in-different-contexts:f7423167403accb6caced956439e54717846131f",
    cloneProfile(
      numberBondsRelatedFactsWithin20,
      "number_bonds_and_related_subtraction_facts_within_20_contexts"
    )
  ),
  poolProfile(
    "oak:maths:ks1:numbers-0-to-20-in-different-contexts:08d510b4b0de32c3875d54f34b9c96485ced41fe",
    cloneProfile(
      oneStepAddSubtractTo20,
      "one_step_add_subtract_to_20_contexts"
    )
  ),

  /**
   * Position and direction / fractions of turns
   */
  directProfile(
    "oak:maths:ks1:position-and-direction-including-fractions-of-turns:93cafd4886cc384b988f963b38dc498b56d61a5e",
    "turn_direction",
    "turn_direction"
  ),
  directProfile(
    "oak:maths:ks1:position-and-direction-including-fractions-of-turns:e3927710bc68fcfb0358fafe58b407710e8510c0",
    "half_of_quantity",
    "half_of_quantity"
  ),
  directProfile(
    "oak:maths:ks1:position-and-direction-including-fractions-of-turns:679aebbf3e12dfe0221c8b9c48ee17293181ee5b",
    "quarter_of_quantity",
    "quarter_of_quantity"
  ),

  /**
   * Shape strand
   */
  directProfile(
    "oak:maths:ks1:recognise-compose-decompose-and-manipulate-2d-and-3d-shapes:93cafd4886cc384b988f963b38dc498b56d61a5e",
    "turn_direction_shapes_strand",
    "turn_direction"
  ),
  directProfile(
    "oak:maths:ks1:recognise-compose-decompose-and-manipulate-2d-and-3d-shapes:8d10d931dcb790917efcbc79bde50e7460a6d9e7",
    "shape_name",
    "shape_name"
  ),

  /**
   * Money strand
   */
  directProfile(
    "oak:maths:ks1:unitising-and-coin-recognition-solving-problems-involving-money:490635989035e0cfa0e901929677334ce9c62e73",
    "coin_value_money_strand",
    "coin_value"
  ),
  directProfile(
    "oak:maths:ks1:unitising-and-coin-recognition-solving-problems-involving-money:e3927710bc68fcfb0358fafe58b407710e8510c0",
    "half_of_quantity_money_strand",
    "half_of_quantity"
  ),
  poolProfile(
    "oak:maths:ks1:unitising-and-coin-recognition-solving-problems-involving-money:08d510b4b0de32c3875d54f34b9c96485ced41fe",
    cloneProfile(
      oneStepAddSubtractTo20,
      "one_step_add_subtract_to_20_money_strand"
    )
  ),

  /**
   * Time strand
   */
  directProfile(
    "oak:maths:ks1:time-sequencing-events-and-telling-the-time-to-the-hour-and-half-hour:fbb324c00e987d385834b34a0dc431a20c8b3ef5",
    "measurement_compare_time_strand",
    "measurement_compare"
  ),
  directProfile(
    "oak:maths:ks1:time-sequencing-events-and-telling-the-time-to-the-hour-and-half-hour:de87e31138f572d42a3ac4fae1cda0785bed4b44",
    "measurement_compare_recording_time_strand",
    "measurement_compare"
  ),
  directProfile(
    "oak:maths:ks1:time-sequencing-events-and-telling-the-time-to-the-hour-and-half-hour:ab0030e8802888148b671972152d8ecf155e4086",
    "date_sequence",
    "date_sequence"
  ),
  directProfile(
    "oak:maths:ks1:time-sequencing-events-and-telling-the-time-to-the-hour-and-half-hour:54249be8f822a296d02fb739fc74c3c50981cf8b",
    "date_sequence_chronology_language",
    "date_sequence"
  ),
  directProfile(
    "oak:maths:ks1:time-sequencing-events-and-telling-the-time-to-the-hour-and-half-hour:d8bdc507a8ed2df8372a6341ff64d812a379b159",
    "time_match_hour_half_hour",
    "time_match_hour_half_hour"
  ),

  /**
   * Coin recognition / counting in 2s, 5s, 10s
   */
  directProfile(
    "oak:maths:ks1:unitising-and-coin-recognitions-counting-in-2s-5s-and-10s:863db3880e9eb0d295796bd80aa7e64d266d1b6c",
    "coin_value",
    "coin_value"
  ),
  directProfile(
    "oak:maths:ks1:unitising-and-coin-recognitions-counting-in-2s-5s-and-10s:42142d29a383d33a0d896b08e122a9291d5d6819",
    "coin_value_counting_strand",
    "coin_value"
  ),

  /**
   * Coin value of a set
   */
  directProfile(
    "oak:maths:ks1:unitising-and-coin-recognition-value-of-a-set-of-coins:863db3880e9eb0d295796bd80aa7e64d266d1b6c",
    "coin_value_set_totals",
    "coin_value"
  ),
  directProfile(
    "oak:maths:ks1:unitising-and-coin-recognition-value-of-a-set-of-coins:42142d29a383d33a0d896b08e122a9291d5d6819",
    "coin_value_set_problem_strand",
    "coin_value"
  ),
];
