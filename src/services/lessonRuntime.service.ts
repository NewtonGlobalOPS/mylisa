import {
  buildLessonDeliveryPlan,
  buildLessonDeliveryPlanFromSelection,
} from "./lessonDelivery.service.js";

type DeliveryByObjectiveInput = {
  studentId: string;
  objectiveId: string;
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
};

type DeliveryBySelectionInput = {
  studentId: string;
  subject?: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
  keyStage?: "KS1" | "KS2" | "KS3" | "KS4";
  yearGroup?: number;
  strand?: string;
  objectiveCode?: string;
  search?: string;
  organisationSlug?: string;
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
};

function firstLines(value: string, maxLines: number): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
}

function buildScreenPayload(
  delivery: Awaited<ReturnType<typeof buildLessonDeliveryPlan>>,
) {
  return {
    child: delivery.child,
    objective: delivery.curriculum.objective,
    lessonFlow: delivery.lessonFlow,
    presentation: delivery.personalization.presentationControls,
    canonicalCards: delivery.canonical.questions.map((question) => ({
      id: question.id,
      sequence: question.sequence,
      title: `Canonical ${question.sequence}`,
      promptText: question.promptText,
      answerText: question.answerText,
      itemType: question.itemType,
      difficulty: question.difficulty,
      equation: question.equation,
      structure: {
        operator: question.operator,
        lhsA: question.lhsA,
        lhsB: question.lhsB,
        rhs: question.rhs,
      },
    })),
    supportCards: Object.entries(delivery.oakSupport.chunksByType).map(
      ([type, chunks]) => ({
        type,
        items: chunks.map((chunk) => ({
          id: chunk.id,
          difficulty: chunk.difficulty,
          excerpt: firstLines(chunk.content, 4),
          citations: chunk.citations,
          tags: chunk.tags,
        })),
      }),
    ),
  };
}

function buildPromptPayload(
  delivery: Awaited<ReturnType<typeof buildLessonDeliveryPlan>>,
) {
  const system = [
    "You are MyLisa lesson delivery.",
    "Your job is to present the same canonical maths to every child while adapting the teaching wrapper to this specific learner.",
    ...delivery.llmContract.guardrails,
  ].join("\n");

  const user = {
    child: delivery.child,
    curriculum: delivery.curriculum,
    lessonFlow: delivery.lessonFlow,
    presentationControls: delivery.personalization.presentationControls,
    objectiveSignals: delivery.personalization.objectiveSignals,
    strandSignals: delivery.personalization.strandSignals,
    canonicalQuestions: delivery.canonical.questions.map((question) => ({
      id: question.id,
      sequence: question.sequence,
      promptText: question.promptText,
      answerText: question.answerText,
      itemType: question.itemType,
      difficulty: question.difficulty,
      operator: question.operator,
      lhsA: question.lhsA,
      lhsB: question.lhsB,
      rhs: question.rhs,
      equation: question.equation,
      contentJson: question.contentJson,
    })),
    oakSupport: Object.entries(delivery.oakSupport.chunksByType).map(
      ([type, chunks]) => ({
        type,
        chunks: chunks.map((chunk) => ({
          id: chunk.id,
          content: chunk.content,
          citations: chunk.citations,
          tags: chunk.tags,
        })),
      }),
    ),
  };

  return {
    modelIntent: "Wrap canonical lesson content for one child without changing the canonical maths.",
    systemPrompt: system,
    userPayload: user,
    outputContract: {
      rules: [
        "Keep all canonical numbers, operators, prompts, and answers unchanged.",
        "Adapt tone, examples, chunking, encouragement, and explanation only.",
        "Prefer short steps and confidence checks when presentation controls demand it.",
        "Use child interests sparingly and only to make the wrapper feel familiar.",
      ],
      expectedSections: [
        "opening",
        "guided_teach",
        "canonical_practice",
        "check_for_understanding",
        "repair_moves",
      ],
    },
  };
}

export async function buildLessonRuntimeByObjective(
  input: DeliveryByObjectiveInput,
) {
  const delivery = await buildLessonDeliveryPlan(input);

  return {
    delivery,
    screenPayload: buildScreenPayload(delivery),
    promptPayload: buildPromptPayload(delivery),
  };
}

export async function buildLessonRuntimeBySelection(
  input: DeliveryBySelectionInput,
) {
  const resolved = await buildLessonDeliveryPlanFromSelection(input);

  return {
    resolution: resolved.resolution,
    delivery: resolved.delivery,
    screenPayload: buildScreenPayload(resolved.delivery),
    promptPayload: buildPromptPayload(resolved.delivery),
  };
}
