import {
  AttemptStatus,
  IntegrationSource,
  Subject,
  TaskType,
  type Prisma,
} from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { loadPublishedCourseModules } from "./newtoncentreCourseCatalog.service.js";

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

type CombinedChildProfileParams = {
  studentId: string;
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

function normalizeText(value: string | null | undefined): string {
  return (value ?? "").trim().toLowerCase();
}

function schoolYearFromAge(age: number | null | undefined): number | null {
  if (typeof age !== "number" || !Number.isFinite(age)) return null;
  const year = age - 4;
  return year >= 1 && year <= 13 ? year : null;
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
} {
  const raw = notes && typeof notes === "object" ? (notes as Record<string, any>) : null;
  const session = raw?.session && typeof raw.session === "object" ? raw.session : null;
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
    strands: strands.sort((a, b) => a.accuracy - b.accuracy || a.confidence - b.confidence),
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

async function buildCourseRecommendation(params: {
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
  const blendedLabel =
    blendedYears.length >= 2
      ? `Blended Year ${blendedYears[0].year} / Year ${blendedYears[1].year} maths course`
      : dominantYear != null
      ? `Year ${dominantYear} maths course`
      : "Assessment-led maths course";

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
    subject: Subject.MATHS,
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
          subject: Subject.MATHS,
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

  const baseUrl = String(
    process.env.NDSCREEN_API_BASE_URL ?? "http://127.0.0.1:4020"
  ).trim();
  const token = String(process.env.NDSCREEN_EXPORT_TOKEN ?? "").trim();

  if (!baseUrl || !token) {
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
    const res = await fetch(
      `${baseUrl.replace(/\/+$/, "")}/api/integrations/newtoncentre/sessions/${encodeURIComponent(
        sessionId
      )}/status`,
      {
        headers: {
          Authorization: `Bearer ${token}`,
        },
      }
    );

    const data = await res.json().catch(() => null);

    if (!res.ok) {
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
        error: data?.error ?? `ndscreen lookup failed (${res.status})`,
      };
    }

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
      subject: data?.subject
        ? {
            label: typeof data.subject.label === "string" ? data.subject.label : null,
            displayName:
              typeof data.subject.displayName === "string"
                ? data.subject.displayName
                : null,
            ageYears:
              typeof data.subject.ageYears === "number" ? data.subject.ageYears : null,
            schoolYear:
              typeof data.subject.schoolYear === "string"
                ? data.subject.schoolYear
                : null,
            locale: typeof data.subject.locale === "string" ? data.subject.locale : null,
            dob: typeof data.subject.dob === "string" ? data.subject.dob : null,
          }
        : null,
      intake: data?.intake
        ? {
            id: String(data.intake.id),
            schoolName:
              typeof data.intake.schoolName === "string"
                ? data.intake.schoolName
                : null,
            primaryGuardian: data.intake.primaryGuardian
              ? {
                  relationship:
                    typeof data.intake.primaryGuardian.relationship === "string"
                      ? data.intake.primaryGuardian.relationship
                      : null,
                  firstName:
                    typeof data.intake.primaryGuardian.firstName === "string"
                      ? data.intake.primaryGuardian.firstName
                      : null,
                  lastName:
                    typeof data.intake.primaryGuardian.lastName === "string"
                      ? data.intake.primaryGuardian.lastName
                      : null,
                  email:
                    typeof data.intake.primaryGuardian.email === "string"
                      ? data.intake.primaryGuardian.email
                      : null,
                  phone:
                    typeof data.intake.primaryGuardian.phone === "string"
                      ? data.intake.primaryGuardian.phone
                      : null,
                }
              : null,
          }
        : null,
      participants: Array.isArray(data?.participants)
        ? data.participants.map((participant: any) => ({
            informant: String(participant?.informant ?? ""),
            label: String(participant?.label ?? participant?.informant ?? ""),
            required: Boolean(participant?.required),
            state: String(participant?.state ?? "UNKNOWN"),
            startedAt:
              typeof participant?.startedAt === "string" ? participant.startedAt : null,
            completedAt:
              typeof participant?.completedAt === "string"
                ? participant.completedAt
                : null,
          }))
        : [],
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
  const student = await prisma.student.findUnique({
    where: { id: params.studentId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      age: true,
      keyStage: true,
      subjects: true,
      guardianEmail: true,
      integrationLinks: {
        where: { source: IntegrationSource.NEWTONCENTRE },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
        select: {
          externalId: true,
          ndscreenSessionId: true,
        },
      },
    },
  });

  if (!student) {
    throw new Error("Student not found");
  }

  const assessmentAttemptSelect = {
    id: true,
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

  const assessmentAttempt = params.assessmentSessionId
    ? await prisma.attempt.findFirst({
        where: {
          id: params.assessmentSessionId,
          studentId: student.id,
          subject: Subject.MATHS,
          taskType: TaskType.ASSESSMENT,
        },
        select: assessmentAttemptSelect,
      })
    : await prisma.attempt.findFirst({
        where: {
          studentId: student.id,
          subject: Subject.MATHS,
          taskType: TaskType.ASSESSMENT,
          status: AttemptStatus.SUBMITTED,
        },
        orderBy: [{ submittedAt: "desc" }, { updatedAt: "desc" }],
        select: assessmentAttemptSelect,
      }) ??
      (await prisma.attempt.findFirst({
        where: {
          studentId: student.id,
          subject: Subject.MATHS,
          taskType: TaskType.ASSESSMENT,
        },
        orderBy: [{ updatedAt: "desc" }],
        select: assessmentAttemptSelect,
      }));

  const assessmentSummary = assessmentAttempt
    ? mapStrandsFromAttemptNotes(assessmentAttempt.notes)
    : {
        entryYear: null,
        overallWorkingBand: null,
        overallConfidence: null,
        questionCount: 0,
        strands: [],
      };

  const linkedNdscreenSessionId =
    String(params.ndscreenSessionId ?? "").trim() ||
    student.integrationLinks[0]?.ndscreenSessionId ||
    undefined;

  const screening = await fetchNdscreenSummary(linkedNdscreenSessionId);

  const studentSchoolYear =
    screening?.subject?.schoolYear != null
      ? parseSchoolYearValue(screening.subject.schoolYear)
      : assessmentSummary.entryYear != null
      ? assessmentSummary.entryYear + 1
      : schoolYearFromAge(student.age);

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
      reason:
        strand.secureYear == null
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
        subject: Subject.MATHS,
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
          ? `Missed ${item.count} times in the latest maths assessment.`
          : "Missed in the latest maths assessment.",
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
        subject: Subject.MATHS,
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
    studentSchoolYear,
    entryYear: assessmentSummary.entryYear,
    overallWorkingBand: assessmentSummary.overallWorkingBand,
    screening,
    priorityStrands,
    recommendedObjectives,
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
        }
      : null,
    screening,
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
          screening?.latestResult?.recommendation
            ? "HIGH"
            : "MEDIUM",
        rationale:
          screening?.learningProfile?.recommendation ??
          screening?.latestResult?.recommendation ??
          "Use the assessment evidence to keep the course adaptive and strand-led.",
      },
      strands: priorityStrands,
      objectives: recommendedObjectives,
    },
  };
}
