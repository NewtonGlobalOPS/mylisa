import {
  buildLessonDeliveryPlan,
  buildLessonDeliveryPlanFromSelection,
} from "./lessonDelivery.service.js";

type DeliveryByObjectiveInput = {
  studentId: string;
  objectiveId: string;
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
  selectedChunkIds?: string[];
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
  selectedChunkIds?: string[];
};

type RuntimeWrapperVector = {
  title: string;
  content: string;
  scope: string;
  strand?: string | null;
};

function firstLines(value: string, maxLines: number): string[] {
  return value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, maxLines);
}

function hasAny(text: string, terms: string[]) {
  return terms.some((term) => text.includes(term));
}

export function buildLearnerSupportFocus(input: {
  presentation?: {
    stepSize?: string;
    lowStimulus?: boolean;
    frequentCheckIns?: boolean;
    scaffolding?: string;
    confidencePriority?: string;
  } | null;
  wrapperVectors?: RuntimeWrapperVector[] | null;
}) {
  const vectors = input.wrapperVectors ?? [];
  const text = vectors
    .map((vector) => `${vector.title}\n${vector.scope}\n${vector.content}`)
    .join("\n")
    .toLowerCase();
  const items: string[] = [];

  const add = (item: string) => {
    if (!items.includes(item)) items.push(item);
  };

  if (input.presentation?.stepSize === "SMALL") add("Use one short step at a time.");
  if (input.presentation?.lowStimulus) add("Keep the page and spoken prompts uncluttered.");
  if (input.presentation?.frequentCheckIns || input.presentation?.confidencePriority === "HIGH") {
    add("Add a quick confidence check before moving on.");
  }
  if (input.presentation?.scaffolding === "HIGH") add("Model first, then let the learner try the same structure.");

  if (hasAny(text, ["adhd", "attention", "distract", "restlessness", "impulsivity", "executive"])) {
    add("Mark the important words first, then choose the calculation step.");
    add("Use a short reset if attention drifts.");
  }
  if (hasAny(text, ["autism", "asc", "social cues", "flexibility", "transitions", "sensory"])) {
    add("Use predictable wording and avoid surprise changes.");
  }
  if (hasAny(text, ["emotional regulation", "emotion", "anxiety", "confidence"])) {
    add("Keep correction calm and specific.");
  }
  if (hasAny(text, ["working memory", "planning", "organisation", "auditory processing", "reading/language"])) {
    add("Leave the method visible while the learner answers.");
  }

  return {
    summary: items.length
      ? "Today's support focus"
      : "Steady practice focus",
    items: items.slice(0, 5),
    evidenceTitles: vectors
      .filter((vector) =>
        ["NEURODEVELOPMENTAL_PROFILE", "SCORED_DOMAIN_EVIDENCE", "LEARNING_PROFILE"].includes(vector.scope),
      )
      .map((vector) => vector.title)
      .slice(0, 4),
  };
}

function buildScreenPayload(
  delivery: Awaited<ReturnType<typeof buildLessonDeliveryPlan>>,
) {
  const wrapperVectors = delivery.personalization.wrapperVectors.map((vector) => ({
    id: vector.id,
    title: vector.title,
    content: vector.content,
    scope: vector.scope,
    strand: vector.strand,
    objectiveCode: vector.objective?.code ?? null,
  }));

  return {
    organisation: delivery.organisation,
    child: delivery.child,
    objective: delivery.curriculum.objective,
    objectives: delivery.curriculum.objectives,
    lessonFlow: delivery.lessonFlow,
    presentation: delivery.personalization.presentationControls,
    learnerSupportFocus: buildLearnerSupportFocus({
      presentation: delivery.personalization.presentationControls,
      wrapperVectors,
    }),
    wrapperVectors,
    canonicalCards: delivery.canonical.questions.map((question) => ({
      id: question.id,
      sequence: question.sequence,
      title: `Canonical ${question.sequence}`,
      promptText: question.promptText,
      answerText: question.answerText,
      itemType: question.itemType,
      difficulty: question.difficulty,
      equation: question.equation,
      contentJson: question.contentJson,
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
          objectiveCode: chunk.objectiveCode,
          objectiveTitle: chunk.objectiveTitle,
          strand: chunk.strand,
          yearGroup: chunk.yearGroup,
          matchReason: chunk.matchReason,
          excerpt: firstLines(chunk.content, 4),
          citations: chunk.citations,
          tags: chunk.tags,
        })),
      }),
    ),
    supportSelection: {
      selectedChunkIds: delivery.oakSupport.selectedChunkIds,
      autoSelectedChunkIds: delivery.oakSupport.autoSelectedChunkIds,
      isCustomSelection: delivery.oakSupport.isCustomSelection,
    },
    candidateSupportCards: delivery.oakSupport.candidateChunks.map((chunk) => ({
      id: chunk.id,
      type: chunk.type,
      difficulty: chunk.difficulty,
      objectiveCode: chunk.objectiveCode,
      objectiveTitle: chunk.objectiveTitle,
      strand: chunk.strand,
      yearGroup: chunk.yearGroup,
      matchScore: chunk.matchScore,
      matchReason: chunk.matchReason,
      selected: delivery.oakSupport.selectedChunkIds.includes(chunk.id),
      excerpt: firstLines(chunk.content, 4),
      citations: chunk.citations,
      tags: chunk.tags,
    })),
    personalisedQuestionRounds: delivery.lessonFlow.personalisedQuestionRounds,
  };
}

function buildPromptPayload(
  delivery: Awaited<ReturnType<typeof buildLessonDeliveryPlan>>,
) {
  const system = [
    "You are MyLisa lesson delivery.",
    "Your job is to present the same canonical subject content to every child while adapting the teaching wrapper to this specific learner.",
    ...delivery.llmContract.guardrails,
  ].join("\n");

  const user = {
    child: delivery.child,
    curriculum: delivery.curriculum,
    lessonFlow: delivery.lessonFlow,
    presentationControls: delivery.personalization.presentationControls,
    objectiveSignals: delivery.personalization.objectiveSignals,
    strandSignals: delivery.personalization.strandSignals,
    wrapperVectors: delivery.personalization.wrapperVectors,
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
          objectiveCode: chunk.objectiveCode,
          objectiveTitle: chunk.objectiveTitle,
          strand: chunk.strand,
          yearGroup: chunk.yearGroup,
          matchReason: chunk.matchReason,
          citations: chunk.citations,
          tags: chunk.tags,
        })),
      }),
    ),
  };

  return {
    modelIntent: "Wrap canonical lesson content for one child without changing the canonical subject content.",
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
        "whole_group_objectives",
        "vectored_question_round_1",
        "blended_strand_teach",
        "vectored_question_round_2",
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
