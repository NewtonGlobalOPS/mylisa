import type { KeyStage, Subject } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { buildBespokeLesson, type BespokeLessonBuildResult } from "./bespokeLessonBuilder.service.js";

type CreateLessonPlanFromTopicInput = {
  tutorUserId: string;
  studentId: string;
  topic: string;
  subject?: Subject;
  keyStage?: KeyStage;
  yearGroup?: number;
  domain?: "NUMBER" | "ALGEBRA" | "GEOMETRY" | "DATA" | "RATIO" | "PROBABILITY";
  maxObjectives?: number;
  assessmentCadenceWeeks?: number;
};

type BuildFourWeekReviewQuizInput = {
  tutorUserId: string;
  studentId: string;
  subject?: Subject;
  weeks?: number;
  maxQuestions?: number;
};

function clean(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function phaseFromTitle(title: string, index: number) {
  const text = title.toLowerCase();
  if (text.includes("starter") || text.includes("prior") || text.includes("activate") || index === 0) {
    return "STARTER";
  }
  if (text.includes("model") || text.includes("teach") || text.includes("explain")) return "EXPLICIT_TEACH";
  if (text.includes("guided")) return "GUIDED_PRACTICE";
  if (text.includes("independent") || text.includes("practice")) return "INDEPENDENT_PRACTICE";
  if (text.includes("plenary") || text.includes("review") || text.includes("exit")) return "REVIEW";
  return "LESSON_BODY";
}

function assessmentAuthority() {
  return {
    authority: "OAK_OBJECTIVES_AND_CANONICAL_QUESTIONS",
    rule: "Oak objective IDs are the reporting spine. Oak canonical questions are authoritative assessment items where available.",
    generatedQuestionStatus: "LLM_GENERATED_ASSESSMENT_DRAFT",
    generatedQuestionUse:
      "Generated questions must not backfill absent Oak canonical questions. They may be saved only as tutor-reviewed drafts, clearly separate from Oak canonical source items.",
  };
}

function assessmentPolicy(cadenceWeeks: number) {
  return {
    cadenceWeeks,
    reportingWindow: "Use taught lesson plans, live lesson answers, and Oak objective alignment from the previous four weeks.",
    quizConstruction:
      "Use Oak canonical questions for measured objectives. Do not use LLM-generated items to fill missing Oak canonical coverage.",
    parentReporting:
      "Report progress by Oak objective, strand, confidence, taught coverage, and recent quiz evidence. Do not report generated content as a separate curriculum authority.",
  };
}

function objectiveRole(index: number) {
  if (index === 0) return "ANCHOR";
  if (index <= 2) return "SUPPORTING";
  return "EXTENSION";
}

function keyStageRank(keyStage?: KeyStage | null) {
  if (!keyStage) return null;
  return Number(keyStage.replace("KS", ""));
}

function requestedLevelIsAboveStudent(input: {
  requestedKeyStage?: KeyStage;
  requestedYearGroup?: number;
  studentKeyStage?: KeyStage | null;
  studentYearGroup?: number | null;
}) {
  const requestedRank = keyStageRank(input.requestedKeyStage);
  const studentRank = keyStageRank(input.studentKeyStage);
  if (requestedRank != null && studentRank != null && requestedRank > studentRank) return true;
  if (
    typeof input.requestedYearGroup === "number" &&
    typeof input.studentYearGroup === "number" &&
    input.requestedYearGroup > input.studentYearGroup
  ) {
    return true;
  }
  return false;
}

function buildObjectiveMix(lesson: BespokeLessonBuildResult) {
  return lesson.retrieval.objectives.map((objective, index) => ({
    objectiveId: objective.id,
    code: objective.code,
    title: objective.title,
    strand: objective.strand,
    yearGroup: objective.yearGroup,
    role: objectiveRole(index),
    targetQuestionCount: index === 0 ? 4 : index <= 2 ? 3 : 1,
    source: "OAK_OBJECTIVE",
  }));
}

function buildQuizDraft(lesson: BespokeLessonBuildResult) {
  const primaryObjective = lesson.retrieval.objectives[0] ?? null;
  const oakQuestions = lesson.retrieval.questions.slice(0, 12).map((question) => ({
    source: "OAK_CANONICAL",
    status: "ASSESSMENT_READY",
    objectiveId: question.objectiveId,
    objectiveCode: question.objectiveCode,
    objectiveTitle: question.objectiveTitle,
    canonicalQuestionId: question.id,
    promptText: question.promptText,
    answerText: question.answerText,
    difficulty: question.difficulty,
  }));

  const oakQuestionIds = new Set(lesson.retrieval.questions.map((question) => question.id));
  const generatedPracticeForTutorReview = lesson.guide.practice
    .filter((item) => !item.sourceQuestionId || !oakQuestionIds.has(item.sourceQuestionId))
    .slice(0, 10)
    .map((item, index) => ({
      source: "LLM_GENERATED",
      status: "DRAFT_REQUIRES_ALIGNMENT_REVIEW",
      objectiveId: primaryObjective?.id ?? null,
      objectiveCode: primaryObjective?.code ?? null,
      objectiveTitle: primaryObjective?.title ?? null,
      candidateId: `generated-practice-${index + 1}`,
      promptText: item.prompt,
      answerText: item.answer,
      difficulty: "MEDIUM",
      alignmentRationale: primaryObjective
        ? `Generated from the lesson guide and provisionally aligned to anchor Oak objective ${primaryObjective.code}.`
        : "Generated from the lesson guide; no Oak objective alignment available.",
    }));

  return {
    sourceMix: {
      oakCanonicalCount: oakQuestions.length,
      generatedCandidateCount: 0,
      generatedPracticeForTutorReviewCount: generatedPracticeForTutorReview.length,
    },
    generatedPracticeForTutorReview,
    items: oakQuestions,
  };
}

function buildSectionBoardSpec(section: BespokeLessonBuildResult["guide"]["lessonSections"][number]) {
  return {
    required: true,
    mode: section.workedExample ? "WORKED_EXAMPLE_BOARD" : "TUTOR_BOARD",
    title: section.title,
    display: [
      "Show the section aim.",
      "Keep key vocabulary, method steps, and the current example visible.",
      section.workedExample ? "Use the worked example problem, steps, and answer as the board spine." : "",
    ].filter(Boolean),
    workedExample: section.workedExample ?? null,
  };
}

export async function createLessonPlanFromTopic(input: CreateLessonPlanFromTopicInput) {
  const tutor = await prisma.user.findUnique({
    where: { id: input.tutorUserId },
    select: { id: true, organisationId: true },
  });
  if (!tutor) throw new Error("Tutor user not found");

  const student = await prisma.student.findFirst({
    where: { id: input.studentId, organisationId: tutor.organisationId },
    select: { id: true, organisationId: true, keyStage: true, schoolYear: true },
  });
  if (!student) throw new Error("Student not found");

  const cadenceWeeks = input.assessmentCadenceWeeks ?? 4;
  const lesson = await buildBespokeLesson({
    topic: input.topic,
    subject: input.subject ?? "MATHS",
    keyStage: input.keyStage ?? student.keyStage ?? undefined,
    yearGroup: input.yearGroup ?? student.schoolYear ?? undefined,
    domain: input.domain,
    maxObjectives: input.maxObjectives ?? 6,
  });

  const anchorObjective = lesson.retrieval.objectives[0];
  if (!anchorObjective) throw new Error("No Oak objective alignment was found for this lesson plan.");

  return prisma.lessonPlan.create({
    data: {
      organisationId: tutor.organisationId,
      studentId: student.id,
      subject: lesson.guide.subject,
      keyStage: lesson.guide.keyStage ?? undefined,
      yearGroup: lesson.guide.yearGroup ?? undefined,
      title: clean(lesson.guide.title) || `Lesson plan: ${input.topic}`,
      topic: lesson.retrieval.topic,
      status: "DRAFT",
      source: lesson.source === "llm" ? "OAK_ALIGNED_LLM" : "OAK_ALIGNED_FALLBACK",
      assessmentAuthority: "OAK_OBJECTIVES",
      assessmentCadenceWeeks: cadenceWeeks,
      teachingContextJson: {
        studentId: student.id,
        topic: input.topic,
        generatedAt: new Date().toISOString(),
        fallbackReason: lesson.fallbackReason ?? null,
      },
      oakAuthorityJson: {
        ...assessmentAuthority(),
        objectives: lesson.retrieval.objectives.map((objective) => ({
          id: objective.id,
          code: objective.code,
          title: objective.title,
          statement: objective.statement,
          strand: objective.strand,
          keyStage: objective.keyStage,
          yearGroup: objective.yearGroup,
          canonicalQuestionCount: objective.canonicalQuestionCount,
          contentChunkCount: objective.contentChunkCount,
        })),
      },
      assessmentPolicyJson: assessmentPolicy(cadenceWeeks),
      planJson: {
        guide: lesson.guide,
        retrieval: lesson.retrieval,
      },
      objectives: {
        create: lesson.retrieval.objectives.slice(0, 8).map((objective, index) => ({
          organisationId: tutor.organisationId,
          objectiveId: objective.id,
          sequence: index + 1,
          role: objectiveRole(index),
          strand: objective.strand,
          yearGroup: objective.yearGroup,
          alignmentConfidence: Math.min(0.98, Math.max(0.55, objective.score / 250)),
          alignmentRationale: objective.matchReason,
          taughtContentSummary: lesson.guide.learningObjectives[index] ?? lesson.guide.overview,
          generatedContentNotes:
            lesson.source === "llm"
              ? "Teaching content may include LLM-generated explanations and examples, aligned back to this Oak objective."
              : "Fallback teaching content generated from Oak-aligned retrieval.",
          assessmentEligible: objective.canonicalQuestionCount > 0 || index <= 2,
        })),
      },
      sections: {
        create: lesson.guide.lessonSections.map((section, index) => ({
          organisationId: tutor.organisationId,
          sequence: index + 1,
          phase: phaseFromTitle(section.title, index),
          title: section.title,
          durationMinutes: section.durationMinutes,
          source: lesson.source === "llm" ? "LLM_GENERATED" : "FALLBACK_GENERATED",
          teacherActions: section.teacherActions,
          studentActions: section.studentActions,
          workedExampleJson: section.workedExample ?? undefined,
          boardSpecJson: buildSectionBoardSpec(section),
          practiceSpecJson: {
            linkedPractice: lesson.guide.practice.slice(index, index + 3),
            checksForUnderstanding: lesson.guide.checksForUnderstanding.slice(0, 4),
            misconceptions: lesson.guide.misconceptions.slice(0, 3),
          },
          assessmentLinksJson: {
            objectiveIds: lesson.retrieval.objectives.slice(0, 3).map((objective) => objective.id),
            assessmentAuthority: "OAK_OBJECTIVES",
          },
        })),
      },
      assessmentBlueprints: {
        create: {
          organisationId: tutor.organisationId,
          cadenceWeeks,
          status: "DRAFT",
          authorityJson: assessmentAuthority(),
          objectiveMixJson: {
            cadenceWeeks,
            objectives: buildObjectiveMix(lesson),
          },
          generatedQuestionPolicyJson: assessmentPolicy(cadenceWeeks),
          quizDraftJson: buildQuizDraft(lesson),
          reportingJson: {
            reportToParentsBy: ["Oak objective", "strand", "taught coverage", "quiz performance", "confidence"],
            includeGeneratedContentNarrative:
              "Generated lesson content can be described as teaching support, but attainment is reported against Oak-aligned objectives.",
          },
        },
      },
    },
    include: {
      objectives: { include: { objective: true }, orderBy: { sequence: "asc" } },
      sections: { orderBy: { sequence: "asc" } },
      assessmentBlueprints: { orderBy: { createdAt: "desc" } },
    },
  });
}

export async function buildFourWeekReviewQuiz(input: BuildFourWeekReviewQuizInput) {
  const tutor = await prisma.user.findUnique({
    where: { id: input.tutorUserId },
    select: { id: true, organisationId: true },
  });
  if (!tutor) throw new Error("Tutor user not found");

  const student = await prisma.student.findFirst({
    where: { id: input.studentId, organisationId: tutor.organisationId },
    select: { id: true },
  });
  if (!student) throw new Error("Student not found");

  const weeks = input.weeks ?? 4;
  const maxQuestions = input.maxQuestions ?? 16;
  const windowStart = new Date(Date.now() - weeks * 7 * 24 * 60 * 60 * 1000);

  const lessonPlans = await prisma.lessonPlan.findMany({
    where: {
      organisationId: tutor.organisationId,
      studentId: student.id,
      subject: input.subject ?? "MATHS",
      createdAt: { gte: windowStart },
      status: { not: "ARCHIVED" },
    },
    orderBy: { createdAt: "asc" },
    include: {
      objectives: {
        where: { assessmentEligible: true },
        orderBy: { sequence: "asc" },
        include: {
          objective: {
            select: {
              id: true,
              code: true,
              title: true,
              statement: true,
              subject: true,
              keyStage: true,
              yearGroup: true,
              strand: true,
              canonicalQuestions: {
                where: { status: "ACTIVE" },
                orderBy: [{ difficulty: "asc" }, { sequence: "asc" }],
                take: 8,
              },
            },
          },
        },
      },
      assessmentBlueprints: { orderBy: { createdAt: "desc" }, take: 1 },
    },
  });

  const byObjective = new Map<string, {
    objective: (typeof lessonPlans)[number]["objectives"][number]["objective"];
    lessonPlanIds: string[];
    taughtContent: string[];
    role: string;
  }>();

  for (const plan of lessonPlans) {
    for (const alignment of plan.objectives) {
      const existing = byObjective.get(alignment.objectiveId);
      if (existing) {
        existing.lessonPlanIds.push(plan.id);
        if (alignment.taughtContentSummary) existing.taughtContent.push(alignment.taughtContentSummary);
        continue;
      }
      byObjective.set(alignment.objectiveId, {
        objective: alignment.objective,
        lessonPlanIds: [plan.id],
        taughtContent: alignment.taughtContentSummary ? [alignment.taughtContentSummary] : [],
        role: alignment.role,
      });
    }
  }

  const objectiveEntries = Array.from(byObjective.values());
  const oakItems = objectiveEntries.flatMap((entry) =>
    entry.objective.canonicalQuestions.slice(0, entry.role === "ANCHOR" ? 4 : 2).map((question) => ({
      source: "OAK_CANONICAL" as const,
      status: "ASSESSMENT_READY" as const,
      objectiveId: entry.objective.id,
      objectiveCode: entry.objective.code,
      objectiveTitle: entry.objective.title,
      strand: entry.objective.strand,
      canonicalQuestionId: question.id,
      promptText: question.promptText,
      answerText: question.answerText,
      difficulty: question.difficulty,
      lessonPlanIds: entry.lessonPlanIds,
    })),
  );

  const generatedCandidates = lessonPlans.flatMap((plan) => {
    const blueprint = plan.assessmentBlueprints[0];
    const draft = blueprint?.quizDraftJson;
    if (!draft || typeof draft !== "object" || !("items" in draft) || !Array.isArray((draft as any).items)) {
      return [];
    }
    return (draft as any).items
      .filter((item: any) => item?.source === "LLM_GENERATED")
      .slice(0, 3)
      .map((item: any) => ({
        ...item,
        lessonPlanIds: [plan.id],
        status: "DRAFT_REQUIRES_ALIGNMENT_REVIEW",
      }));
  });

  return {
    studentId: student.id,
    subject: input.subject ?? "MATHS",
    windowStart: windowStart.toISOString(),
    windowEnd: new Date().toISOString(),
    authority: assessmentAuthority(),
    reportingPolicy: assessmentPolicy(weeks),
    taughtCoverage: objectiveEntries.map((entry) => ({
      objectiveId: entry.objective.id,
      code: entry.objective.code,
      title: entry.objective.title,
      strand: entry.objective.strand,
      yearGroup: entry.objective.yearGroup,
      lessonPlanIds: entry.lessonPlanIds,
      taughtContent: Array.from(new Set(entry.taughtContent)).slice(0, 4),
      oakCanonicalAvailable: entry.objective.canonicalQuestions.length,
    })),
    quizDraft: {
      status: "DRAFT",
      generatedAt: new Date().toISOString(),
      oakCanonicalItems: oakItems.slice(0, maxQuestions),
      generatedCandidates: generatedCandidates.slice(0, Math.max(0, maxQuestions - oakItems.length)),
      reviewNotes: [
        "Use Oak canonical items as the assessment-ready core.",
        "Generated candidates exist to cover taught generated examples or missing item variety; keep them labelled and aligned to Oak objectives.",
        "Parent reporting should aggregate by Oak objective and taught coverage, not by generated content labels.",
      ],
    },
  };
}
