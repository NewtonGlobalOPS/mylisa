import {
  AttemptStatus,
  IntegrationSource,
  Subject,
  TaskType,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { loadPublishedCourseModules } from "./newtoncentreCourseCatalog.service.js";
import { getNdscreenChildScreening } from "./ndscreenDirect.service.js";
import { listActiveWrapperVectors } from "./wrapperVector.service.js";

type AssessmentStrandSummary = {
  strand: string;
  asked: number;
  correct: number;
  accuracy: number;
  confidence: number;
  secureYear: number | null;
  emergingYear: number | null;
  currentTargetYear: number | null;
};

type AssessmentNarrativeSummary = {
  displayBandLabel: string;
  displayBandSummary: string;
  parentNarrative: string;
  tutorNarrative: string;
  whatThisMeans: string;
  strengths: string[];
  focusAreas: string[];
  nextSteps: string[];
  tutorActions: string[];
  confidenceNote: string;
};

type CombinedChildProfileParams = {
  studentId: string;
  subject?: Subject;
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
};

type ScreeningSummary = {
  configured: boolean;
  sessionId: string | null;
  ok: boolean;
  status: string | null;
  screeningKind: string | null;
  questionSet: { key: string | null; version: number | null } | null;
  subject: {
    label: string | null;
    displayName: string | null;
    ageYears: number | null;
    schoolYear: string | null;
    locale: string | null;
    dob: string | null;
  } | null;
  intake: {
    id: string;
    schoolName: string | null;
    primaryGuardian: {
      relationship: string | null;
      firstName: string | null;
      lastName: string | null;
      email: string | null;
      phone: string | null;
    } | null;
  } | null;
  participants: Array<{
    informant: string;
    label: string;
    required: boolean;
    state: string;
    startedAt: string | null;
    completedAt: string | null;
  }>;
  report: {
    status: string | null;
    readyAt: string | null;
    generatedAt: string | null;
    errorMessage: string | null;
  } | null;
  latestResult: {
    validity: string | null;
    confidence: number | null;
    confidenceBand: string | null;
    overall: number | null;
    overallAdjusted: number | null;
    profileType: string | null;
    recommendation: string | null;
  } | null;
  learningProfile: {
    summaryText: string | null;
    profiles: string[];
    primaryProfile: string | null;
    confidence: number | null;
    confidenceBand: string | null;
    summary: string | null;
    recommendation: string | null;
  } | null;
  error: string | null;
};

type PriorityStrandRecommendation = AssessmentStrandSummary & {
  priority: number;
  reason: string;
  evidenceLabel: string;
};

type RecommendedObjectiveSignal = {
  objectiveId: string;
  code: string;
  title: string;
  yearGroup: number | null;
  strand: string;
  reason: string;
  source: string;
  priorityWeight: number;
  gapSeverity: number;
  occurrenceCount: number;
};

type YearBlendWeight = {
  year: number;
  weight: number;
  reason: string;
};

type InterventionRecommendation = {
  label: string;
  severity: "FOUNDATION" | "TARGETED" | "DELIVERY";
  reason: string;
  strand: string | null;
  targetYear: number | null;
};

type LearningReportObjective = {
  objectiveId: string;
  code: string;
  title: string;
  yearGroup: number | null;
  strand: string;
  sequence: number | null;
  priorityWeight: number;
  reason: string;
  source: string;
  status: string;
};

type LearningReportLesson = {
  lessonSessionId: string;
  coursePlanId: string | null;
  title: string;
  status: string;
  objective: {
    id: string;
    code: string;
    title: string;
    yearGroup: number | null;
    strand: string;
  };
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
  currentBlockKey: string | null;
  questionsAnswered: number;
  questionsCorrect: number;
  accuracy: number | null;
  lastActiveAt: string | null;
  progressLabel: string;
  recentEvents: Array<{
    type: string;
    blockKey: string | null;
    createdAt: string;
  }>;
};

type LearningReportCourse = {
  coursePlanId: string | null;
  title: string;
  status: string;
  subject: Subject;
  assessmentSessionId: string | null;
  ndscreenSessionId: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  source: "SAVED_COURSE_PLAN" | "ASSESSMENT_RECOMMENDATION";
};

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function schoolYearFromAge(age: number | null | undefined): number | null {
  if (typeof age !== "number" || !Number.isFinite(age)) return null;
  const year = age - 4;
  return year >= 1 && year <= 13 ? year : null;
}

function resolvePersistedSchoolYear(
  schoolYear: number | null | undefined,
  age: number | null | undefined
): number | null {
  if (typeof schoolYear === "number" && Number.isFinite(schoolYear)) {
    return schoolYear >= 1 && schoolYear <= 13 ? schoolYear : null;
  }

  return schoolYearFromAge(age);
}

function parseSchoolYearValue(value: string | null | undefined): number | null {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  const match = raw.match(/\b(\d{1,2})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) && year >= 1 && year <= 13 ? year : null;
}

function objectiveMatchesAssessmentStrand(
  strand: string,
  objective: {
    title: string;
    statement: string;
    strand: string;
    keywords: string[];
  }
): boolean {
  const text = [
    objective.title,
    objective.statement,
    objective.strand,
    ...objective.keywords,
  ]
    .join(" ")
    .toLowerCase();

  switch (strand) {
    case "NUMBER":
      return [
        "number",
        "arithmetic",
        "decimal",
        "integer",
        "place value",
        "fraction",
        "percentage",
        "powers",
        "roots",
      ].some((term) => text.includes(term));
    case "ALGEBRA":
      return [
        "algebra",
        "equation",
        "expression",
        "formula",
        "sequence",
        "graph",
        "substitute",
        "simplify",
        "expand",
      ].some((term) => text.includes(term));
    case "RATIO":
      return [
        "ratio",
        "proportion",
        "scale",
        "fraction",
        "percentage",
        "multiplicative",
      ].some((term) => text.includes(term));
    case "GEOMETRY":
      return [
        "angle",
        "shape",
        "triangle",
        "quadrilateral",
        "circle",
        "perimeter",
        "area",
        "volume",
        "geometry",
        "coordinates",
        "construction",
        "transform",
      ].some((term) => text.includes(term));
    case "DATA":
      return [
        "data",
        "statistics",
        "probability",
        "chart",
        "graph",
        "mean",
        "median",
        "mode",
        "range",
        "scatter",
      ].some((term) => text.includes(term));
    default:
      return false;
  }
}

function mapStrandsFromAttemptNotes(notes: Prisma.JsonValue | null): {
  entryYear: number | null;
  overallWorkingBand: string | null;
  overallConfidence: number | null;
  questionCount: number;
  strands: AssessmentStrandSummary[];
  report: AssessmentNarrativeSummary | null;
} {
  const raw = notes && typeof notes === "object" ? (notes as Record<string, any>) : null;
  const session = raw?.session && typeof raw.session === "object" ? raw.session : null;
  const report = raw?.report && typeof raw.report === "object" ? raw.report : null;
  const strandRecord =
    session?.strands && typeof session.strands === "object" ? session.strands : {};
  const strandValues = Object.values(strandRecord as Record<string, any>);

  const strands: AssessmentStrandSummary[] = strandValues.map((value: any) => ({
    strand: String(value?.strand ?? "UNKNOWN"),
    asked: Number(value?.asked ?? 0),
    correct: Number(value?.correct ?? 0),
    accuracy:
      Number(value?.asked ?? 0) > 0
        ? Number(value?.correct ?? 0) / Number(value?.asked ?? 1)
        : 0,
    confidence:
      typeof value?.confidence === "number" ? Number(value.confidence) : 0,
    secureYear:
      typeof value?.secureYear === "number" ? Number(value.secureYear) : null,
    emergingYear:
      typeof value?.emergingYear === "number" ? Number(value.emergingYear) : null,
    currentTargetYear:
      typeof value?.currentTargetYear === "number"
        ? Number(value.currentTargetYear)
        : null,
  }));
  const reportableStrands = strands.some((strand) => strand.asked > 0)
    ? strands.filter((strand) => strand.asked > 0)
    : strands;

  return {
    entryYear: typeof session?.entryYear === "number" ? Number(session.entryYear) : null,
    overallWorkingBand:
      typeof session?.overallWorkingBand === "string"
        ? String(session.overallWorkingBand)
        : null,
    overallConfidence:
      typeof session?.overallConfidence === "number"
        ? Number(session.overallConfidence)
        : null,
    questionCount: Array.isArray(session?.responses) ? session.responses.length : 0,
    strands: reportableStrands.sort(
      (a, b) => a.accuracy - b.accuracy || a.confidence - b.confidence
    ),
    report: report
      ? {
          displayBandLabel: String(report.displayBandLabel ?? ""),
          displayBandSummary: String(report.displayBandSummary ?? ""),
          parentNarrative: String(report.parentNarrative ?? ""),
          tutorNarrative: String(report.tutorNarrative ?? ""),
          whatThisMeans: String(report.whatThisMeans ?? ""),
          strengths: Array.isArray(report.strengths)
            ? report.strengths.map((item: unknown) => String(item)).filter(Boolean)
            : [],
          focusAreas: Array.isArray(report.focusAreas)
            ? report.focusAreas.map((item: unknown) => String(item)).filter(Boolean)
            : [],
          nextSteps: Array.isArray(report.nextSteps)
            ? report.nextSteps.map((item: unknown) => String(item)).filter(Boolean)
            : [],
          tutorActions: Array.isArray(report.tutorActions)
            ? report.tutorActions.map((item: unknown) => String(item)).filter(Boolean)
            : [],
          confidenceNote: String(report.confidenceNote ?? ""),
        }
      : null,
  };
}

function addWeightedYear(
  map: Map<number, { score: number; reasons: string[] }>,
  year: number | null,
  score: number,
  reason: string
) {
  if (year == null || !Number.isFinite(year) || score <= 0) return;
  const existing = map.get(year) ?? { score: 0, reasons: [] };
  existing.score += score;
  if (!existing.reasons.includes(reason)) {
    existing.reasons.push(reason);
  }
  map.set(year, existing);
}

function buildYearBlend(params: {
  studentSchoolYear: number | null;
  entryYear: number | null;
  priorityStrands: PriorityStrandRecommendation[];
  recommendedObjectives: RecommendedObjectiveSignal[];
}): YearBlendWeight[] {
  const weights = new Map<number, { score: number; reasons: string[] }>();

  for (const strand of params.priorityStrands) {
    const focusYear =
      strand.currentTargetYear ?? strand.secureYear ?? params.entryYear ?? params.studentSchoolYear;
    addWeightedYear(
      weights,
      focusYear,
      Math.max(1.5, 4 - strand.priority * 0.8 + (1 - strand.accuracy) * 2),
      `${strand.strand} is currently targeting Year ${focusYear ?? "?"}.`
    );
  }

  for (const objective of params.recommendedObjectives) {
    addWeightedYear(
      weights,
      objective.yearGroup,
      objective.priorityWeight + objective.gapSeverity,
      `Objective pressure is accumulating around Year ${objective.yearGroup ?? "?"}.`
    );
  }

  const total = Array.from(weights.values()).reduce((sum, entry) => sum + entry.score, 0);

  return Array.from(weights.entries())
    .map(([year, entry]) => ({
      year,
      weight: total > 0 ? Number(((entry.score / total) * 100).toFixed(1)) : 0,
      reason: entry.reasons.join(" "),
    }))
    .sort((a, b) => b.weight - a.weight || a.year - b.year);
}

function buildInterventions(params: {
  entryYear: number | null;
  priorityStrands: PriorityStrandRecommendation[];
  screening: ScreeningSummary | null;
}): InterventionRecommendation[] {
  const out: InterventionRecommendation[] = [];

  for (const strand of params.priorityStrands) {
    if (
      params.entryYear != null &&
      strand.currentTargetYear != null &&
      strand.currentTargetYear < params.entryYear
    ) {
      out.push({
        label: `Year ${strand.currentTargetYear} rebuild intervention`,
        severity: "FOUNDATION",
        reason: `${strand.strand} is not yet secure at the entry layer, so this strand should rebuild from Year ${strand.currentTargetYear} before blending back up.`,
        strand: strand.strand,
        targetYear: strand.currentTargetYear,
      });
      continue;
    }

    if (strand.asked >= 2 && strand.accuracy < 0.5) {
      out.push({
        label: `${strand.strand} targeted intervention`,
        severity: "TARGETED",
        reason: `${strand.strand} accuracy is still below 50%, so this strand needs explicit reteaching and tighter checking.`,
        strand: strand.strand,
        targetYear: strand.currentTargetYear,
      });
    }
  }

  const supportSignal =
    params.screening?.learningProfile?.primaryProfile ??
    params.screening?.latestResult?.profileType ??
    null;

  if (supportSignal) {
    out.push({
      label: "Confidence-first delivery intervention",
      severity: "DELIVERY",
      reason: `Screening suggests a ${supportSignal.toLowerCase()} presentation, so the course should use short steps, explicit scaffolds, and confidence-first pacing.`,
      strand: null,
      targetYear: null,
    });
  }

  return out.slice(0, 4);
}

function progressLabel(input: {
  status: string;
  questionsAnswered: number;
  questionsCorrect: number;
  endedAt: Date | null;
}) {
  if (input.endedAt || input.status === "COMPLETED") {
    return input.questionsAnswered > 0
      ? `Completed with ${input.questionsCorrect}/${input.questionsAnswered} correct.`
      : "Completed; no question responses were recorded.";
  }

  if (input.questionsAnswered > 0) {
    return `In progress with ${input.questionsCorrect}/${input.questionsAnswered} correct so far.`;
  }

  if (input.status === "LIVE" || input.status === "ACTIVE") {
    return "Live lesson started; no question responses recorded yet.";
  }

  return "Lesson planned; progress will appear once the learner starts.";
}

async function buildLearningReport(params: {
  studentId: string;
  subject: Subject;
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
  courseRecommendation: Awaited<ReturnType<typeof buildCourseRecommendation>>;
  recommendedObjectives: RecommendedObjectiveSignal[];
}) {
  const coursePlan = await prisma.coursePlan.findFirst({
    where: {
      studentId: params.studentId,
      subject: params.subject,
      ...(params.assessmentSessionId
        ? { assessmentSessionId: params.assessmentSessionId }
        : {}),
    },
    orderBy: [{ updatedAt: "desc" }, { createdAt: "desc" }],
    include: {
      items: {
        orderBy: { sequence: "asc" },
        include: {
          objective: {
            select: {
              id: true,
              code: true,
              title: true,
              yearGroup: true,
              strand: true,
            },
          },
        },
      },
    },
  });

  const course: LearningReportCourse = coursePlan
    ? {
        coursePlanId: coursePlan.id,
        title: coursePlan.title,
        status: coursePlan.status,
        subject: coursePlan.subject,
        assessmentSessionId: coursePlan.assessmentSessionId,
        ndscreenSessionId: coursePlan.ndscreenSessionId,
        createdAt: coursePlan.createdAt.toISOString(),
        updatedAt: coursePlan.updatedAt.toISOString(),
        source: "SAVED_COURSE_PLAN",
      }
    : {
        coursePlanId: null,
        title: params.courseRecommendation.label,
        status: "RECOMMENDED",
        subject: params.subject,
        assessmentSessionId: params.assessmentSessionId ?? null,
        ndscreenSessionId: params.ndscreenSessionId ?? null,
        createdAt: null,
        updatedAt: null,
        source: "ASSESSMENT_RECOMMENDATION",
      };

  const objectives: LearningReportObjective[] = coursePlan
    ? coursePlan.items.map((item) => ({
        objectiveId: item.objectiveId,
        code: item.objective.code,
        title: item.objective.title,
        yearGroup: item.objective.yearGroup,
        strand: item.objective.strand,
        sequence: item.sequence,
        priorityWeight: item.priorityWeight,
        reason: item.reason,
        source: "COURSE_PLAN",
        status: item.status,
      }))
    : params.recommendedObjectives.map((objective, index) => ({
        objectiveId: objective.objectiveId,
        code: objective.code,
        title: objective.title,
        yearGroup: objective.yearGroup,
        strand: objective.strand,
        sequence: index + 1,
        priorityWeight: objective.priorityWeight,
        reason: objective.reason,
        source: objective.source,
        status: "RECOMMENDED",
      }));

  const lessonWhere: Prisma.LessonSessionWhereInput = {
    status: { not: "ARCHIVED" },
    objective: {
      subject: params.subject,
    },
    participants: {
      some: {
        studentId: params.studentId,
      },
    },
    ...(coursePlan
      ? {
          OR: [
            { coursePlanId: coursePlan.id },
            {
              objectiveId: {
                in: objectives.map((objective) => objective.objectiveId),
              },
            },
          ],
        }
      : {}),
  };

  const lessons = await prisma.lessonSession.findMany({
    where: lessonWhere,
    orderBy: [{ startedAt: "desc" }, { updatedAt: "desc" }],
    take: 12,
    select: {
      id: true,
      coursePlanId: true,
      title: true,
      status: true,
      startedAt: true,
      endedAt: true,
      updatedAt: true,
      currentBlockKey: true,
      objective: {
        select: {
          id: true,
          code: true,
          title: true,
          yearGroup: true,
          strand: true,
        },
      },
      participants: {
        where: {
          studentId: params.studentId,
        },
        take: 1,
        select: {
          questionsAnswered: true,
          questionsCorrect: true,
          lastActiveAt: true,
        },
      },
      events: {
        where: {
          OR: [{ studentId: params.studentId }, { studentId: null }],
        },
        orderBy: { createdAt: "desc" },
        take: 4,
        select: {
          type: true,
          blockKey: true,
          createdAt: true,
        },
      },
    },
  });

  const lessonProgress: LearningReportLesson[] = lessons.map((lesson) => {
    const participant = lesson.participants[0];
    const questionsAnswered = participant?.questionsAnswered ?? 0;
    const questionsCorrect = participant?.questionsCorrect ?? 0;

    return {
      lessonSessionId: lesson.id,
      coursePlanId: lesson.coursePlanId,
      title: lesson.title,
      status: lesson.status,
      objective: lesson.objective,
      startedAt: lesson.startedAt ? lesson.startedAt.toISOString() : null,
      endedAt: lesson.endedAt ? lesson.endedAt.toISOString() : null,
      updatedAt: lesson.updatedAt.toISOString(),
      currentBlockKey: lesson.currentBlockKey,
      questionsAnswered,
      questionsCorrect,
      accuracy:
        questionsAnswered > 0
          ? Number((questionsCorrect / questionsAnswered).toFixed(3))
          : null,
      lastActiveAt: participant?.lastActiveAt
        ? participant.lastActiveAt.toISOString()
        : null,
      progressLabel: progressLabel({
        status: lesson.status,
        questionsAnswered,
        questionsCorrect,
        endedAt: lesson.endedAt,
      }),
      recentEvents: lesson.events.map((event) => ({
        type: event.type,
        blockKey: event.blockKey,
        createdAt: event.createdAt.toISOString(),
      })),
    };
  });

  const completedLessons = lessonProgress.filter(
    (lesson) => lesson.endedAt || lesson.status === "COMPLETED"
  ).length;
  const totalQuestionsAnswered = lessonProgress.reduce(
    (sum, lesson) => sum + lesson.questionsAnswered,
    0
  );
  const totalQuestionsCorrect = lessonProgress.reduce(
    (sum, lesson) => sum + lesson.questionsCorrect,
    0
  );

  return {
    course,
    objectives,
    lessons: lessonProgress,
    progressSummary: {
      plannedObjectiveCount: objectives.length,
      lessonCount: lessonProgress.length,
      completedLessonCount: completedLessons,
      inProgressLessonCount: lessonProgress.filter(
        (lesson) => lesson.status === "LIVE" || lesson.status === "ACTIVE"
      ).length,
      totalQuestionsAnswered,
      totalQuestionsCorrect,
      overallLessonAccuracy:
        totalQuestionsAnswered > 0
          ? Number((totalQuestionsCorrect / totalQuestionsAnswered).toFixed(3))
          : null,
    },
  };
}

async function buildCourseRecommendation(params: {
  subject: Subject;
  studentSchoolYear: number | null;
  entryYear: number | null;
  overallWorkingBand: string | null;
  screening: ScreeningSummary | null;
  priorityStrands: PriorityStrandRecommendation[];
  recommendedObjectives: RecommendedObjectiveSignal[];
}) {
  const targetYear =
    params.entryYear ??
    params.studentSchoolYear ??
    (params.screening?.subject?.schoolYear
      ? parseSchoolYearValue(params.screening.subject.schoolYear)
      : null);

  const supportSignal =
    params.screening?.learningProfile?.primaryProfile ??
    params.screening?.latestResult?.profileType ??
    null;

  const yearBlend = buildYearBlend({
    studentSchoolYear: params.studentSchoolYear,
    entryYear: params.entryYear,
    priorityStrands: params.priorityStrands,
    recommendedObjectives: params.recommendedObjectives,
  });
  const interventions = buildInterventions({
    entryYear: params.entryYear,
    priorityStrands: params.priorityStrands,
    screening: params.screening,
  });
  const dominantYear = yearBlend[0]?.year ?? targetYear;
  const blendedYears = yearBlend.filter((item) => item.weight >= 20).slice(0, 2);

  const supportRationale = supportSignal
    ? ` Screening suggests a ${supportSignal.toLowerCase()} presentation, so the course should keep instructions explicit, chunked, and confidence-first.`
    : "";

  const hasFoundationIntervention = interventions.some(
    (item) => item.severity === "FOUNDATION"
  );
  const subjectLabel = params.subject === Subject.SCIENCE ? "science" : "maths";
  const blendedLabel =
    blendedYears.length >= 2
      ? `Blended Year ${blendedYears[0].year} / Year ${blendedYears[1].year} ${subjectLabel} course`
      : dominantYear != null
      ? `Year ${dominantYear} ${subjectLabel} course`
      : `Assessment-led ${subjectLabel} course`;

  let label = blendedLabel;
  let intensity = "ADAPTIVE";
  let rationale =
    "Assessment evidence is still settling, so the safest course shape is adaptive, broad enough to sample, and deliberate about known weak spots.";

  if (hasFoundationIntervention || params.overallWorkingBand === "BELOW_ENTRY") {
    label =
      dominantYear != null
        ? `Intervention-led rebuild course around Year ${dominantYear}`
        : "Intervention-led rebuild course";
    intensity = "INTERVENTION";
    rationale =
      "Assessment evidence shows at least one strand is still fragile below the entry layer, so the plan should rebuild those prerequisites first and then blend upward once consistency appears.";
  } else if (blendedYears.length >= 2) {
    intensity = "BLENDED";
    rationale =
      `Assessment evidence is split across ${blendedYears
        .map((item) => `Year ${item.year}`)
        .join(" and ")}, so the next course should mix secure-core modules with higher-year bridge work instead of forcing a single flat level.`;
  } else if (params.overallWorkingBand === "ENTRY_SECURE") {
    intensity = "SECURE";
    rationale =
      "The child is secure at the entry layer overall, so the next course should deepen consistency while keeping a close eye on weaker strands.";
  } else if (
    params.overallWorkingBand === "ENTRY_SECURE_NEXT_EMERGING" ||
    params.overallWorkingBand === "NEXT_DEVELOPING"
  ) {
    intensity = "BRIDGE";
    rationale =
      "The child is broadly secure at entry with emerging higher-year readiness, so the course should bridge upward while protecting weaker domains with planned revisits.";
  } else if (params.overallWorkingBand === "NEXT_SECURE") {
    intensity = "PROGRESSION";
    rationale =
      "Assessment evidence supports progression, but the course should still weight the weaker strands instead of treating all domains as equally ready.";
  }

  const courseCatalog = await loadPublishedCourseModules({
    subject: params.subject,
    schoolYear: dominantYear ?? targetYear,
  });

  const moduleObjectiveCodes = Array.from(
    new Set(
      courseCatalog.modules
        .map((module) => module.objectiveCode)
        .filter((code): code is string => Boolean(code))
    )
  );

  const moduleObjectives = moduleObjectiveCodes.length
    ? await prisma.curriculumObjective.findMany({
        where: {
          subject: params.subject,
          code: { in: moduleObjectiveCodes },
        },
        select: {
          code: true,
          title: true,
          statement: true,
          yearGroup: true,
          strand: true,
          keywords: true,
        },
      })
    : [];

  const moduleObjectiveMap = new Map(moduleObjectives.map((row) => [row.code, row]));
  const recommendedObjectiveMap = new Map(
    params.recommendedObjectives.map((objective) => [objective.code, objective])
  );
  const yearWeightMap = new Map(yearBlend.map((item) => [item.year, item.weight]));

  const weightedModules = courseCatalog.modules
    .map((module) => {
      const linkedObjective =
        module.objectiveCode != null
          ? moduleObjectiveMap.get(module.objectiveCode) ?? null
          : null;
      const recommendedMatch =
        module.objectiveCode != null
          ? recommendedObjectiveMap.get(module.objectiveCode) ?? null
          : null;
      const matchedPriorityStrand = linkedObjective
        ? params.priorityStrands.find((strand) =>
            objectiveMatchesAssessmentStrand(strand.strand, linkedObjective)
          ) ?? null
        : null;

      let score = 0;
      const reasons: string[] = [];

      if (recommendedMatch) {
        score += 110 + recommendedMatch.priorityWeight * 12 + recommendedMatch.gapSeverity * 22;
        reasons.push(`Exact match for ${recommendedMatch.code}.`);
      }

      if (linkedObjective?.yearGroup != null) {
        const yearWeight = yearWeightMap.get(linkedObjective.yearGroup) ?? 0;
        if (yearWeight > 0) {
          score += yearWeight * 0.8;
          reasons.push(`Supports the Year ${linkedObjective.yearGroup} blend.`);
        }
      }

      if (matchedPriorityStrand) {
        score += Math.max(8, 28 - matchedPriorityStrand.priority * 4);
        reasons.push(`Aligned to priority ${matchedPriorityStrand.strand}.`);
      }

      if (
        interventions.some(
          (item) =>
            item.targetYear != null &&
            linkedObjective?.yearGroup != null &&
            item.targetYear === linkedObjective.yearGroup
        )
      ) {
        score += 12;
        reasons.push("Supports an intervention year focus.");
      }

      return {
        moduleId: module.moduleId,
        title: module.moduleTitle,
        sortOrder: module.sortOrder,
        objectiveCode: module.objectiveCode,
        yearGroup: linkedObjective?.yearGroup ?? null,
        strand: linkedObjective?.strand ?? null,
        rawScore: score,
        reasons,
      };
    })
    .filter((module) => module.rawScore > 0)
    .sort((a, b) => b.rawScore - a.rawScore || a.sortOrder - b.sortOrder)
    .slice(0, 10);

  const totalModuleScore = weightedModules.reduce((sum, module) => sum + module.rawScore, 0);

  return {
    label,
    targetYear: dominantYear ?? targetYear,
    intensity,
    rationale: rationale + supportRationale,
    yearBlend,
    interventions,
    matchedCourse: courseCatalog.course
      ? {
          slug: courseCatalog.course.slug,
          title: courseCatalog.course.title,
          level: courseCatalog.course.level,
          versionNumber: courseCatalog.course.versionNumber,
          source: courseCatalog.source,
        }
      : null,
    weightedModules: weightedModules.map((module) => ({
      moduleId: module.moduleId,
      title: module.title,
      sortOrder: module.sortOrder,
      objectiveCode: module.objectiveCode,
      yearGroup: module.yearGroup,
      strand: module.strand,
      weight:
        totalModuleScore > 0
          ? Number(((module.rawScore / totalModuleScore) * 100).toFixed(1))
          : 0,
      reason: module.reasons.join(" "),
    })),
  };
}

async function fetchNdscreenSummary(
  ndscreenSessionId: string | undefined
): Promise<ScreeningSummary | null> {
  const sessionId = String(ndscreenSessionId ?? "").trim();
  if (!sessionId) return null;

  if (!String(process.env.NDSCREEN_EXPORT_TOKEN ?? "").trim()) {
    return {
      configured: false,
      sessionId,
      ok: false,
      status: null,
      screeningKind: null,
      questionSet: null,
      subject: null,
      intake: null,
      participants: [],
      report: null,
      latestResult: null,
      learningProfile: null,
      error: "ndscreen integration is not configured in MyLisa.",
    };
  }

  try {
    const data = await getNdscreenChildScreening(sessionId);

    return {
      configured: true,
      sessionId,
      ok: true,
      status: typeof data?.status === "string" ? data.status : null,
      screeningKind: typeof data?.screeningKind === "string" ? data.screeningKind : null,
      questionSet: data?.questionSet
        ? {
            key: typeof data.questionSet.key === "string" ? data.questionSet.key : null,
            version:
              typeof data.questionSet.version === "number"
                ? data.questionSet.version
                : null,
        }
        : null,
      subject: data?.child
        ? {
            label: typeof data.child.displayName === "string" ? data.child.displayName : null,
            displayName:
              typeof data.child.displayName === "string"
                ? data.child.displayName
                : null,
            ageYears:
              typeof data.child.ageYears === "number" ? data.child.ageYears : null,
            schoolYear:
              typeof data.child.schoolYear === "string"
                ? data.child.schoolYear
                : null,
            locale: typeof data.child.locale === "string" ? data.child.locale : null,
            dob: typeof data.child.dob === "string" ? data.child.dob : null,
          }
        : null,
      intake: data?.child || data?.guardian
        ? {
            id: sessionId,
            schoolName:
              typeof data.child?.schoolName === "string"
                ? data.child.schoolName
                : null,
            primaryGuardian: data.guardian
              ? {
                  relationship:
                    typeof data.guardian.relationship === "string"
                      ? data.guardian.relationship
                      : null,
                  firstName:
                    typeof data.guardian.firstName === "string"
                      ? data.guardian.firstName
                      : null,
                  lastName:
                    typeof data.guardian.lastName === "string"
                      ? data.guardian.lastName
                      : null,
                  email:
                    typeof data.guardian.email === "string"
                      ? data.guardian.email
                      : null,
                  phone:
                    typeof data.guardian.phone === "string"
                      ? data.guardian.phone
                      : null,
                }
              : null,
          }
        : null,
      participants: [],
      report: data?.report
        ? {
            status: typeof data.report.status === "string" ? data.report.status : null,
            readyAt: typeof data.report.readyAt === "string" ? data.report.readyAt : null,
            generatedAt:
              typeof data.report.generatedAt === "string"
                ? data.report.generatedAt
                : null,
            errorMessage:
              typeof data.report.errorMessage === "string"
                ? data.report.errorMessage
                : null,
          }
        : null,
      latestResult: data?.latestResult
        ? {
            validity:
              typeof data.latestResult.validity === "string"
                ? data.latestResult.validity
                : null,
            confidence:
              typeof data.latestResult.confidence === "number"
                ? data.latestResult.confidence
                : null,
            confidenceBand:
              typeof data.latestResult.confidenceBand === "string"
                ? data.latestResult.confidenceBand
                : null,
            overall:
              typeof data.latestResult.overall === "number"
                ? data.latestResult.overall
                : null,
            overallAdjusted:
              typeof data.latestResult.overallAdjusted === "number"
                ? data.latestResult.overallAdjusted
                : null,
            profileType:
              typeof data.latestResult.profileType === "string"
                ? data.latestResult.profileType
                : null,
            recommendation:
              typeof data.latestResult.recommendation === "string"
                ? data.latestResult.recommendation
                : null,
          }
        : null,
      learningProfile: data?.learningProfile
        ? {
            summaryText:
              typeof data.learningProfile.summaryText === "string"
                ? data.learningProfile.summaryText
                : null,
            profiles: Array.isArray(data.learningProfile.profiles)
              ? data.learningProfile.profiles.map((value: unknown) => String(value))
              : [],
            primaryProfile:
              typeof data.learningProfile.primaryProfile === "string"
                ? data.learningProfile.primaryProfile
                : null,
            confidence:
              typeof data.learningProfile.confidence === "number"
                ? data.learningProfile.confidence
                : null,
            confidenceBand:
              typeof data.learningProfile.confidenceBand === "string"
                ? data.learningProfile.confidenceBand
                : null,
            summary:
              typeof data.learningProfile.summary === "string"
                ? data.learningProfile.summary
                : null,
            recommendation:
              typeof data.learningProfile.recommendation === "string"
                ? data.learningProfile.recommendation
                : null,
          }
        : null,
      error: null,
    };
  } catch (error) {
    return {
      configured: true,
      sessionId,
      ok: false,
      status: null,
      screeningKind: null,
      questionSet: null,
      subject: null,
      intake: null,
      participants: [],
      report: null,
      latestResult: null,
      learningProfile: null,
      error: error instanceof Error ? error.message : "ndscreen request failed",
    };
  }
}

export async function buildCombinedChildProfile(
  params: CombinedChildProfileParams
) {
  const requestedSubject = params.subject ?? Subject.MATHS;
  const student = await prisma.student.findUnique({
    where: { id: params.studentId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      age: true,
      schoolYear: true,
      keyStage: true,
      subjects: true,
      guardianEmail: true,
      integrationLinks: {
        where: {
          ndscreenSessionId: {
            not: null,
          },
          source: {
            in: [IntegrationSource.NEWTONCENTRE, IntegrationSource.NDSCREEN],
          },
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
        select: {
          externalId: true,
          ndscreenSessionId: true,
        },
      },
      attempts: {
        where: {
          taskType: TaskType.ASSESSMENT,
          subject: {
            in: [Subject.MATHS, Subject.SCIENCE],
          },
        },
        orderBy: [{ submittedAt: "desc" }, { updatedAt: "desc" }],
        take: 10,
        select: {
          id: true,
          subject: true,
          status: true,
          score: true,
          createdAt: true,
          updatedAt: true,
          submittedAt: true,
        },
      },
    },
  });

  if (!student) {
    throw new Error("Student not found");
  }

  const availableAssessments = [Subject.MATHS, Subject.SCIENCE]
    .map((assessmentSubject) => {
      const subjectAttempts = student.attempts.filter(
        (item) => item.subject === assessmentSubject
      );
      const attempt =
        subjectAttempts.find((item) => item.status === AttemptStatus.SUBMITTED) ??
        subjectAttempts[0];
      return attempt
        ? {
            id: attempt.id,
            subject: attempt.subject,
            status: attempt.status,
            score: attempt.score,
            createdAt: attempt.createdAt.toISOString(),
            updatedAt: attempt.updatedAt.toISOString(),
            submittedAt: attempt.submittedAt?.toISOString() ?? null,
          }
        : null;
    })
    .filter((item): item is NonNullable<typeof item> => Boolean(item));

  const assessmentAttemptSelect = {
    id: true,
    subject: true,
    status: true,
    score: true,
    createdAt: true,
    updatedAt: true,
    submittedAt: true,
    notes: true,
    items: {
      select: {
        objectiveId: true,
        isCorrect: true,
        objective: {
          select: {
            id: true,
            code: true,
            title: true,
            statement: true,
            yearGroup: true,
            strand: true,
            keywords: true,
          },
        },
      },
    },
  } satisfies Prisma.AttemptSelect;

  const requestedAssessmentAttempt = params.assessmentSessionId
    ? await prisma.attempt.findFirst({
        where: {
          id: params.assessmentSessionId,
          studentId: student.id,
          taskType: TaskType.ASSESSMENT,
          subject: requestedSubject,
          status: AttemptStatus.SUBMITTED,
        },
        select: assessmentAttemptSelect,
      })
    : null;

  const assessmentAttempt = requestedAssessmentAttempt ??
    (await prisma.attempt.findFirst({
        where: {
          studentId: student.id,
          subject: requestedSubject,
          taskType: TaskType.ASSESSMENT,
          status: AttemptStatus.SUBMITTED,
        },
        orderBy: [{ submittedAt: "desc" }, { updatedAt: "desc" }],
        select: assessmentAttemptSelect,
      })) ??
      (await prisma.attempt.findFirst({
        where: {
          studentId: student.id,
          subject: requestedSubject,
          taskType: TaskType.ASSESSMENT,
        },
        orderBy: [{ updatedAt: "desc" }],
        select: assessmentAttemptSelect,
      }));

  const subject = assessmentAttempt?.subject ?? requestedSubject;

  const assessmentSummary = assessmentAttempt
    ? mapStrandsFromAttemptNotes(assessmentAttempt.notes)
    : {
        entryYear: null,
        overallWorkingBand: null,
        overallConfidence: null,
        questionCount: 0,
        strands: [],
        report: null,
      };

  const linkedNdscreenSessionId =
    String(params.ndscreenSessionId ?? "").trim() ||
    student.integrationLinks[0]?.ndscreenSessionId ||
    undefined;

  const screening = await fetchNdscreenSummary(linkedNdscreenSessionId);
  const wrapperVectors = await listActiveWrapperVectors(student.id);

  const studentSchoolYear =
    screening?.subject?.schoolYear != null
      ? parseSchoolYearValue(screening.subject.schoolYear)
      : assessmentSummary.entryYear != null
      ? assessmentSummary.entryYear + 1
      : resolvePersistedSchoolYear(student.schoolYear, student.age);

  const priorityStrands = assessmentSummary.strands
    .filter((strand) => strand.asked > 0)
    .sort((a, b) => {
      const aSecure = a.secureYear == null ? -1 : a.secureYear;
      const bSecure = b.secureYear == null ? -1 : b.secureYear;
      return (
        aSecure - bSecure ||
        a.accuracy - b.accuracy ||
        a.confidence - b.confidence ||
        a.asked - b.asked
      );
    })
    .slice(0, 3)
    .map((strand, index) => ({
      ...strand,
      priority: index + 1,
      evidenceLabel:
        strand.asked < 3
          ? `${strand.correct}/${strand.asked} correct`
          : `${Math.round(strand.accuracy * 100)}% accuracy`,
      reason:
        strand.asked < 3
          ? "This strand has only light evidence so far and should be rechecked before treating it as a secure gap."
          : strand.secureYear == null
          ? "This strand still needs secure baseline evidence."
          : strand.emergingYear == null
          ? "This strand is secure at the current level but needs the next layer building."
          : "This strand is ready to progress, but it should still be tracked in the course.",
    }));

  const incorrectObjectiveMap = new Map<
    string,
    {
      objectiveId: string;
      code: string;
      title: string;
      yearGroup: number | null;
      strand: string;
      count: number;
    }
  >();

  for (const item of assessmentAttempt?.items ?? []) {
    if (item.isCorrect !== false || !item.objectiveId || !item.objective) continue;
    const existing = incorrectObjectiveMap.get(item.objectiveId);
    if (existing) {
      existing.count += 1;
      continue;
    }
    incorrectObjectiveMap.set(item.objectiveId, {
      objectiveId: item.objectiveId,
      code: item.objective.code,
      title: item.objective.title,
      yearGroup: item.objective.yearGroup,
      strand: item.objective.strand,
      count: 1,
    });
  }

  const weakestMastery = await prisma.objectiveMastery.findMany({
    where: {
      studentId: student.id,
      objective: {
        subject,
      },
    },
    orderBy: [{ masteryScore: "asc" }, { updatedAt: "desc" }],
    take: 6,
    select: {
      objectiveId: true,
      masteryScore: true,
      objective: {
        select: {
          code: true,
          title: true,
          statement: true,
          yearGroup: true,
          strand: true,
          keywords: true,
        },
      },
    },
  });

  const recommendedObjectives: RecommendedObjectiveSignal[] = [];
  const usedObjectiveIds = new Set<string>();

  for (const item of Array.from(incorrectObjectiveMap.values()).sort(
    (a, b) => b.count - a.count
  )) {
    if (usedObjectiveIds.has(item.objectiveId)) continue;
    usedObjectiveIds.add(item.objectiveId);
    recommendedObjectives.push({
      objectiveId: item.objectiveId,
      code: item.code,
      title: item.title,
      yearGroup: item.yearGroup,
      strand: item.strand,
      reason:
        item.count > 1
          ? `Missed ${item.count} times in the latest ${subject.toLowerCase()} assessment.`
          : `Missed in the latest ${subject.toLowerCase()} assessment.`,
      source: "ASSESSMENT_ATTEMPT",
      priorityWeight: 5,
      gapSeverity: Math.min(3, item.count),
      occurrenceCount: item.count,
    });
    if (recommendedObjectives.length >= 6) break;
  }

  for (const mastery of weakestMastery) {
    if (usedObjectiveIds.has(mastery.objectiveId)) continue;
    usedObjectiveIds.add(mastery.objectiveId);
    recommendedObjectives.push({
      objectiveId: mastery.objectiveId,
      code: mastery.objective.code,
      title: mastery.objective.title,
      yearGroup: mastery.objective.yearGroup,
      strand: mastery.objective.strand,
      reason: `Historic mastery is low (${Math.round(mastery.masteryScore * 100)}%).`,
      source: "OBJECTIVE_MASTERY",
      priorityWeight: 3,
      gapSeverity: Number((1 - mastery.masteryScore).toFixed(2)) * 2,
      occurrenceCount: 1,
    });
    if (recommendedObjectives.length >= 6) break;
  }

  if (recommendedObjectives.length < 6 && priorityStrands.length > 0) {
    const targetYears = [
      assessmentSummary.entryYear,
      assessmentSummary.entryYear != null ? assessmentSummary.entryYear + 1 : null,
      studentSchoolYear,
    ].filter((value): value is number => typeof value === "number");

    const fallbackObjectives = await prisma.curriculumObjective.findMany({
      where: {
        subject,
        isActive: true,
        ...(targetYears.length > 0
          ? {
              yearGroup: {
                in: Array.from(new Set(targetYears)),
              },
            }
          : {}),
      },
      orderBy: [{ yearGroup: "asc" }, { code: "asc" }],
      take: 80,
      select: {
        id: true,
        code: true,
        title: true,
        statement: true,
        yearGroup: true,
        strand: true,
        keywords: true,
      },
    });

    for (const objective of fallbackObjectives) {
      if (usedObjectiveIds.has(objective.id)) continue;

      const matchedStrand = priorityStrands.find((strand) =>
        objectiveMatchesAssessmentStrand(strand.strand, objective)
      );

      if (!matchedStrand) continue;

      usedObjectiveIds.add(objective.id);
      recommendedObjectives.push({
        objectiveId: objective.id,
        code: objective.code,
        title: objective.title,
        yearGroup: objective.yearGroup,
        strand: objective.strand,
        reason: `Aligned to priority ${matchedStrand.strand} work for the next course build.`,
        source: "CURRICULUM_FALLBACK",
        priorityWeight: Math.max(1, 4 - matchedStrand.priority),
        gapSeverity: 1,
        occurrenceCount: 1,
      });

      if (recommendedObjectives.length >= 6) break;
    }
  }

  const courseRecommendation = await buildCourseRecommendation({
    subject,
    studentSchoolYear,
    entryYear: assessmentSummary.entryYear,
    overallWorkingBand: assessmentSummary.overallWorkingBand,
    screening,
    priorityStrands,
    recommendedObjectives,
  });
  const learningReport = await buildLearningReport({
    studentId: student.id,
    subject,
    assessmentSessionId: assessmentAttempt?.id ?? params.assessmentSessionId,
    ndscreenSessionId: linkedNdscreenSessionId,
    courseRecommendation,
    recommendedObjectives,
  });
  const latestStoredReport = await prisma.storedReport.findFirst({
    where: {
      studentId: student.id,
      subject,
      ...(assessmentAttempt?.id ? { attemptId: assessmentAttempt.id } : {}),
    },
    orderBy: {
      generatedAt: "desc",
    },
    select: {
      id: true,
      title: true,
      filename: true,
      mimeType: true,
      sizeBytes: true,
      generatedAt: true,
      publicToken: true,
    },
  });

  return {
    child: {
      id: student.id,
      firstName: student.firstName,
      lastName: student.lastName,
      displayName:
        [student.firstName, student.lastName].filter(Boolean).join(" ").trim() ||
        screening?.subject?.displayName ||
        "Student",
      age: student.age,
      schoolYear: studentSchoolYear,
      keyStage: student.keyStage,
      subjects: student.subjects,
      guardianEmail: student.guardianEmail ?? screening?.intake?.primaryGuardian?.email ?? null,
    },
    assessment: assessmentAttempt
      ? {
          sessionId: assessmentAttempt.id,
          subject,
          status: assessmentAttempt.status,
          score: assessmentAttempt.score,
          createdAt: assessmentAttempt.createdAt.toISOString(),
          updatedAt: assessmentAttempt.updatedAt.toISOString(),
          submittedAt: assessmentAttempt.submittedAt
            ? assessmentAttempt.submittedAt.toISOString()
            : null,
          entryYear: assessmentSummary.entryYear,
          overallWorkingBand: assessmentSummary.overallWorkingBand,
          overallConfidence: assessmentSummary.overallConfidence,
          questionCount: assessmentSummary.questionCount,
          strands: assessmentSummary.strands,
          report: assessmentSummary.report,
        }
      : null,
    screening,
    storedReport: latestStoredReport
      ? {
          id: latestStoredReport.id,
          title: latestStoredReport.title,
          filename: latestStoredReport.filename,
          mimeType: latestStoredReport.mimeType,
          sizeBytes: Number(latestStoredReport.sizeBytes),
          generatedAt: latestStoredReport.generatedAt.toISOString(),
          downloadUrl: `/api/reports/${latestStoredReport.id}/pdf`,
          parentViewUrl: `/public/reports/${latestStoredReport.publicToken}/pdf`,
        }
      : null,
    wrapperVectors,
    learningReport,
    availableAssessments,
    recommendations: {
      course: courseRecommendation,
      deliveryProfile: {
        pace:
          screening?.learningProfile?.primaryProfile ||
          screening?.latestResult?.profileType
            ? "SHORT_STEPS"
            : "STANDARD",
        scaffolding:
          screening?.learningProfile?.primaryProfile ||
          screening?.questionSet?.key?.includes("learning")
            ? "HIGH"
            : "MEDIUM",
        confidencePriority:
          screening?.learningProfile?.summary ||
          screening?.latestResult?.recommendation ||
          wrapperVectors.length > 0
            ? "HIGH"
            : "MEDIUM",
        rationale:
          screening?.learningProfile?.recommendation ??
          screening?.latestResult?.recommendation ??
          (wrapperVectors.length > 0
            ? `Wrapper vectors are available (${wrapperVectors
                .slice(0, 2)
                .map((item) => item.title)
                .join(", ")}), so the lesson should adapt delivery explicitly around them.`
            : "Use the assessment evidence to keep the course adaptive and strand-led."),
      },
      strands: priorityStrands,
      objectives: recommendedObjectives,
    },
  };
}
