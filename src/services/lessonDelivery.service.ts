import { prisma } from "../lib/prisma.js";
import { buildCombinedChildProfile } from "./childProfile.service.js";
import { resolveOakCurriculumObjective } from "./curriculumExplorer.service.js";

type LessonSection = {
  key: string;
  title: string;
  purpose: string;
  chunkIds: string[];
  canonicalQuestionIds: string[];
};

type LessonDeliveryParams = {
  studentId: string;
  objectiveId: string;
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
};

type LessonDeliverySelectionParams = {
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

function normaliseText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function buildChildInterests(profile: Awaited<ReturnType<typeof buildCombinedChildProfile>>) {
  const candidates = [
    profile.screening?.learningProfile?.summaryText,
    profile.screening?.learningProfile?.summary,
    profile.screening?.latestResult?.recommendation,
  ]
    .map((value) => normaliseText(value))
    .filter(Boolean);

  return candidates.slice(0, 3);
}

function buildPresentationControls(
  profile: Awaited<ReturnType<typeof buildCombinedChildProfile>>,
  preferences: {
    tutoringMode: string;
    verbosity: string;
    stepSize: string;
    lowStimulus: boolean;
    avoidMetaphors: boolean;
    useBullets: boolean;
    moreExamples: boolean;
    frequentCheckIns: boolean;
    readingLevel: number | null;
    attentionSpanMins: number | null;
  } | null,
) {
  return {
    tutoringMode: preferences?.tutoringMode ?? "AUTO",
    verbosity: preferences?.verbosity ?? "LOW",
    stepSize:
      profile.recommendations.deliveryProfile.pace === "SHORT_STEPS"
        ? "SMALL"
        : (preferences?.stepSize ?? "NORMAL"),
    lowStimulus: preferences?.lowStimulus ?? true,
    avoidMetaphors: preferences?.avoidMetaphors ?? false,
    useBullets: preferences?.useBullets ?? true,
    moreExamples: preferences?.moreExamples ?? true,
    frequentCheckIns: preferences?.frequentCheckIns ?? true,
    readingLevel: preferences?.readingLevel ?? null,
    attentionSpanMins: preferences?.attentionSpanMins ?? null,
    scaffolding: profile.recommendations.deliveryProfile.scaffolding,
    confidencePriority: profile.recommendations.deliveryProfile.confidencePriority,
    rationale: profile.recommendations.deliveryProfile.rationale,
  };
}

function buildLlmGuardrails(input: {
  displayName: string;
  interests: string[];
  presentationControls: ReturnType<typeof buildPresentationControls>;
}) {
  const interestLine = input.interests.length
    ? `Use familiar contexts only when helpful: ${input.interests.join(" | ")}.`
    : "Use neutral everyday contexts unless a known child interest is available.";

  return [
    "Canonical question maths and answer are the source of truth.",
    "Do not change the numbers, operator, expected answer, or mathematical intent of any canonical question.",
    `Wrap explanations for ${input.displayName} using the presentation controls and confidence-first tone.`,
    interestLine,
    "Keep steps short when confidence or screening suggests extra load control.",
    "Use Oak explanation and misconception chunks to explain, model, and remediate around the canonical question.",
    "Personalization may change wording, examples, pacing, encouragement, and ordering of support, but never the canonical maths itself.",
  ];
}

function buildLessonSections(input: {
  chunks: Array<{
    id: string;
    type: string;
  }>;
  canonicalQuestions: Array<{
    id: string;
  }>;
}): LessonSection[] {
  const chunkIdsByType = input.chunks.reduce<Record<string, string[]>>((acc, chunk) => {
    if (!acc[chunk.type]) {
      acc[chunk.type] = [];
    }
    acc[chunk.type].push(chunk.id);
    return acc;
  }, {});

  const questionIds = input.canonicalQuestions.map((question) => question.id);
  const guidedCount = Math.min(3, questionIds.length);
  const guidedQuestionIds = questionIds.slice(0, guidedCount);
  const independentQuestionIds = questionIds.slice(guidedCount);

  return [
    {
      key: "connect",
      title: "Connect To The Objective",
      purpose: "Set the goal clearly and activate relevant prior knowledge with minimal load.",
      chunkIds: [
        ...(chunkIdsByType.OBJECTIVE ?? []),
        ...(chunkIdsByType.GLOSSARY ?? []).slice(0, 1),
      ],
      canonicalQuestionIds: [],
    },
    {
      key: "teach",
      title: "Teach And Model",
      purpose: "Explain the idea and model worked examples before the child answers independently.",
      chunkIds: [
        ...(chunkIdsByType.EXPLANATION ?? []).slice(0, 2),
        ...(chunkIdsByType.WORKED_EXAMPLE ?? []).slice(0, 2),
      ],
      canonicalQuestionIds: guidedQuestionIds,
    },
    {
      key: "practice",
      title: "Canonical Practice",
      purpose: "Run the source-of-truth canonical questions with the child-specific wrapper.",
      chunkIds: [...(chunkIdsByType.PRACTICE ?? []).slice(0, 2)],
      canonicalQuestionIds: independentQuestionIds,
    },
    {
      key: "repair",
      title: "Misconception Repair",
      purpose: "Respond to likely misconceptions without changing the canonical maths.",
      chunkIds: [...(chunkIdsByType.MISCONCEPTION ?? []).slice(0, 3)],
      canonicalQuestionIds: [],
    },
  ].filter((section) => section.chunkIds.length > 0 || section.canonicalQuestionIds.length > 0);
}

export async function buildLessonDeliveryPlan(params: LessonDeliveryParams) {
  const student = await prisma.student.findUnique({
    where: { id: params.studentId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      age: true,
      keyStage: true,
      preferences: {
        select: {
          tutoringMode: true,
          verbosity: true,
          stepSize: true,
          lowStimulus: true,
          avoidMetaphors: true,
          useBullets: true,
          moreExamples: true,
          frequentCheckIns: true,
          readingLevel: true,
          attentionSpanMins: true,
        },
      },
    },
  });

  if (!student) {
    throw new Error("Student not found");
  }

  const objective = await prisma.curriculumObjective.findUnique({
    where: { id: params.objectiveId },
    select: {
      id: true,
      organisationId: true,
      code: true,
      subject: true,
      keyStage: true,
      yearGroup: true,
      strand: true,
      title: true,
      statement: true,
      keywords: true,
      source: {
        select: {
          slug: true,
          name: true,
          url: true,
        },
      },
      chunks: {
        where: {
          isActive: true,
        },
        orderBy: [{ type: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          type: true,
          difficulty: true,
          content: true,
          citations: true,
          tags: true,
        },
      },
      canonicalQuestions: {
        where: {
          status: "ACTIVE",
        },
        orderBy: [{ sequence: "asc" }],
        select: {
          id: true,
          sequence: true,
          itemType: true,
          operator: true,
          lhsA: true,
          lhsB: true,
          rhs: true,
          equation: true,
          promptText: true,
          answerText: true,
          difficulty: true,
          contentJson: true,
          generatorVersion: true,
          generatorMeta: true,
        },
      },
    },
  });

  if (!objective) {
    throw new Error("Objective not found");
  }

  const childProfile = await buildCombinedChildProfile({
    studentId: params.studentId,
    assessmentSessionId: params.assessmentSessionId,
    ndscreenSessionId: params.ndscreenSessionId,
  });

  const organisation = await prisma.organisation.findUnique({
    where: { id: objective.organisationId },
    select: { id: true, slug: true, name: true },
  });

  const objectiveSignals = childProfile.recommendations.objectives.filter(
    (item) => item.objectiveId === objective.id,
  );
  const strandSignals = childProfile.recommendations.strands.filter(
    (item) => normaliseText(item.strand) === normaliseText(objective.strand),
  );
  const interests = buildChildInterests(childProfile);
  const presentationControls = buildPresentationControls(
    childProfile,
    student.preferences,
  );

  const chunksByType = objective.chunks.reduce<Record<string, typeof objective.chunks>>(
    (acc, chunk) => {
      if (!acc[chunk.type]) {
        acc[chunk.type] = [];
      }
      acc[chunk.type].push(chunk);
      return acc;
    },
    {},
  );

  const lessonSections = buildLessonSections({
    chunks: objective.chunks.map((chunk) => ({
      id: chunk.id,
      type: chunk.type,
    })),
    canonicalQuestions: objective.canonicalQuestions.map((question) => ({
      id: question.id,
    })),
  });

  return {
    organisation,
    child: {
      id: childProfile.child.id,
      displayName: childProfile.child.displayName,
      age: childProfile.child.age,
      schoolYear: childProfile.child.schoolYear,
      keyStage: childProfile.child.keyStage,
      interests,
    },
    curriculum: {
      objective: {
        id: objective.id,
        code: objective.code,
        subject: objective.subject,
        keyStage: objective.keyStage,
        yearGroup: objective.yearGroup,
        strand: objective.strand,
        title: objective.title,
        statement: objective.statement,
        keywords: objective.keywords,
      },
      source: objective.source,
    },
    canonical: {
      sourceOfTruth: true,
      questionCount: objective.canonicalQuestions.length,
      questions: objective.canonicalQuestions,
    },
    oakSupport: {
      chunkCount: objective.chunks.length,
      chunksByType,
    },
    lessonFlow: {
      sectionCount: lessonSections.length,
      sections: lessonSections,
    },
    personalization: {
      presentationControls,
      objectiveSignals,
      strandSignals,
      assessment: childProfile.assessment,
      screening: childProfile.screening,
    },
    llmContract: {
      invariant: "Canonical maths stays fixed for every child.",
      wrapper: "The LLM adapts explanation, pacing, confidence support, and familiar context around the canonical items.",
      guardrails: buildLlmGuardrails({
        displayName: childProfile.child.displayName,
        interests,
        presentationControls,
      }),
    },
  };
}

export async function buildLessonDeliveryPlanFromSelection(
  params: LessonDeliverySelectionParams,
) {
  const resolved = await resolveOakCurriculumObjective({
    organisationSlug: params.organisationSlug,
    subject: params.subject,
    keyStage: params.keyStage,
    yearGroup: params.yearGroup,
    strand: params.strand,
    objectiveCode: params.objectiveCode,
    search: params.search,
    requireCanonical: true,
    requireContent: true,
  });

  const delivery = await buildLessonDeliveryPlan({
    studentId: params.studentId,
    objectiveId: resolved.selectedObjective.id,
    assessmentSessionId: params.assessmentSessionId,
    ndscreenSessionId: params.ndscreenSessionId,
  });

  return {
    resolution: resolved,
    delivery,
  };
}
