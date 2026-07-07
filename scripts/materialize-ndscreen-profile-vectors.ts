import "dotenv/config";
import { IntegrationSource } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";

type NdscreenChildScreening = {
  sessionId: string;
  status: string | null;
  screeningKind: string | null;
  questionSet: {
    key: string | null;
    version: number | null;
  } | null;
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
  clinicalProfile: {
    primaryClassification: string | null;
    summary: string | null;
    confidence: number | null;
    confidenceBand: string | null;
    recommendation: string | null;
    functionalImpact: string | null;
    validityComment: string | null;
    caution: string | null;
    keyElevatedDomains: Array<{
      code: string | null;
      label: string | null;
      score: number | null;
      interpretation: string | null;
    }>;
    clinicalJustification: string[];
    differentialConsiderations: Array<{
      condition: string | null;
      fit: string | null;
      rationale: string | null;
    }>;
  } | null;
  scoredDomains: {
    summary: {
      adhd: number | null;
      autism: number | null;
      emotion: number | null;
      overall: number | null;
      overallAdjusted: number | null;
      learningOverall: number | null;
      learningOverallAdjusted: number | null;
      learningImpactOverall: number | null;
      functionalImpact: number | null;
      agreement: number | null;
    };
    neurodevelopmentalDomains: {
      combined: Record<string, number> | null;
      child: Record<string, number> | null;
      parent: Record<string, number> | null;
    };
    learningDomains: {
      combined: Record<string, number> | null;
      child: Record<string, number> | null;
      parent: Record<string, number> | null;
      impact: Record<string, number> | null;
      profileLabels: string[];
      keyChallenges: Array<{
        code: string;
        label: string;
        score: number;
        band: string;
      }>;
      keyStrengths: Array<{
        code: string;
        label: string;
        score: number;
        band: string;
      }>;
    };
    impact: Record<string, unknown> | null;
    agreement: Record<string, unknown> | null;
    validity: Record<string, unknown> | null;
  } | null;
};

type VectorSpec = {
  title: string;
  content: string;
  scope: string;
  sortOrder: number;
};

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function compactParts(parts: Array<string | null | undefined>) {
  return parts.map(cleanText).filter(Boolean);
}

function percent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value * 100)}%`
    : null;
}

function score(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? value.toFixed(2)
    : null;
}

function labelForDomain(code: string) {
  const labels: Record<string, string> = {
    A1_ATTENTION_SUSTAIN: "attention sustain",
    A2_DISTRACTIBILITY: "distractibility",
    A3_IMPULSIVITY: "impulsivity",
    A4_RESTLESSNESS: "restlessness",
    B1_SOCIAL_RECIPROCITY: "social reciprocity",
    B2_SOCIAL_CUES: "social cues",
    B3_FLEXIBILITY_TRANSITIONS: "flexibility/transitions",
    B4_SENSORY_SENSITIVITY: "sensory sensitivity",
    C1_EMOTIONAL_REGULATION: "emotional regulation",
    L1_READING_LANGUAGE: "reading/language",
    L2_MATH_PROCESSING: "math processing",
    L3_WRITTEN_EXPRESSION: "written expression",
    L4_EXECUTIVE_FUNCTION: "executive function",
    L5_PROCESSING_SPEED: "processing speed",
    L6_EMOTIONAL_LEARNING: "emotional learning",
    L7_SENSORY_ENVIRONMENT: "sensory/environment",
    L8_AUDITORY_PROCESSING: "auditory processing",
  };
  return labels[code] ?? code;
}

function formatDomainScores(domains: Record<string, number> | null | undefined, codes: string[]) {
  if (!domains) return null;
  const parts = codes
    .filter((code) => typeof domains[code] === "number")
    .map((code) => `${labelForDomain(code)} ${score(domains[code])}`);
  return parts.length ? parts.join("; ") : null;
}

function topDomainScores(domains: Record<string, number> | null | undefined, limit = 5) {
  if (!domains) return [];
  return Object.entries(domains)
    .filter((entry): entry is [string, number] => typeof entry[1] === "number")
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([code, value]) => `${labelForDomain(code)} ${score(value)}`);
}

function textIncludesAny(text: string, terms: string[]) {
  const normalized = text.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function buildNeurodevelopmentalSignal(screening: NdscreenChildScreening): VectorSpec | null {
  const result = screening.latestResult;
  const learning = screening.learningProfile;
  const clinical = screening.clinicalProfile;
  const scored = screening.scoredDomains;
  const profileType = cleanText(result?.profileType);
  const questionSetKey = cleanText(screening.questionSet?.key);
  const differential = clinical?.differentialConsiderations ?? [];
  const adhdDiff = differential.find((item) => item.condition === "ADHD");
  const autismDiff = differential.find((item) => item.condition === "AUTISM");
  const text = compactParts([
    profileType,
    questionSetKey,
    result?.recommendation,
    clinical?.primaryClassification,
    clinical?.summary,
    clinical?.recommendation,
    adhdDiff?.rationale,
    autismDiff?.rationale,
    learning?.primaryProfile,
    ...(learning?.profiles ?? []),
    learning?.summaryText,
    learning?.summary,
    learning?.recommendation,
  ]).join("\n");

  const adhdSignals: string[] = [];
  const autismSignals: string[] = [];

  if (clinical?.primaryClassification === "ADHD") {
    adhdSignals.push("Clinical screening profile primary classification is ADHD.");
  }
  if (adhdDiff?.fit) {
    adhdSignals.push(`ADHD differential fit: ${adhdDiff.fit}. ${adhdDiff.rationale ?? ""}`.trim());
  }
  if (scored?.summary.adhd != null) {
    adhdSignals.push(`ADHD domain score: ${score(scored.summary.adhd)}.`);
  }
  if (profileType === "ATTENTION_IMPULSE") {
    adhdSignals.push("NDSCREEN result profile type is ATTENTION_IMPULSE.");
  }
  if (textIncludesAny(text, ["adhd", "attention", "impuls", "executive function", "executive-function"])) {
    adhdSignals.push("Screening text references attention, impulsivity, or executive-function support needs.");
  }

  if (clinical?.primaryClassification === "AUTISM") {
    autismSignals.push("Clinical screening profile primary classification is AUTISM.");
  }
  if (autismDiff?.fit) {
    autismSignals.push(`Autism differential fit: ${autismDiff.fit}. ${autismDiff.rationale ?? ""}`.trim());
  }
  if (scored?.summary.autism != null) {
    autismSignals.push(`Autism/ASC domain score: ${score(scored.summary.autism)}.`);
  }
  if (profileType === "SOCIAL_FLEX_SENSORY") {
    autismSignals.push("NDSCREEN result profile type is SOCIAL_FLEX_SENSORY.");
  }
  if (textIncludesAny(text, ["autism", "autistic", "asd", "social communication", "sensory", "flexibility", "transitions"])) {
    autismSignals.push("Screening text references autism-linked social communication, flexibility, transitions, or sensory support needs.");
  }

  if (!adhdSignals.length && !autismSignals.length) return null;

  const content = compactParts([
    "These are screening-derived learning support indicators, not diagnoses.",
    clinical?.summary ? `Clinical screening summary: ${clinical.summary}` : null,
    adhdSignals.length ? `ADHD-type indicator: ${Array.from(new Set(adhdSignals)).join(" ")}` : null,
    autismSignals.length ? `Autism-linked indicator: ${Array.from(new Set(autismSignals)).join(" ")}` : null,
    formatDomainScores(scored?.neurodevelopmentalDomains.combined, [
      "A1_ATTENTION_SUSTAIN",
      "A2_DISTRACTIBILITY",
      "A3_IMPULSIVITY",
      "A4_RESTLESSNESS",
    ])
      ? `ADHD-related scored domains: ${formatDomainScores(scored?.neurodevelopmentalDomains.combined, [
          "A1_ATTENTION_SUSTAIN",
          "A2_DISTRACTIBILITY",
          "A3_IMPULSIVITY",
          "A4_RESTLESSNESS",
        ])}.`
      : null,
    formatDomainScores(scored?.neurodevelopmentalDomains.combined, [
      "B1_SOCIAL_RECIPROCITY",
      "B2_SOCIAL_CUES",
      "B3_FLEXIBILITY_TRANSITIONS",
      "B4_SENSORY_SENSITIVITY",
    ])
      ? `Autism-linked scored domains: ${formatDomainScores(scored?.neurodevelopmentalDomains.combined, [
          "B1_SOCIAL_RECIPROCITY",
          "B2_SOCIAL_CUES",
          "B3_FLEXIBILITY_TRANSITIONS",
          "B4_SENSORY_SENSITIVITY",
        ])}.`
      : null,
    scored?.summary.functionalImpact != null
      ? `Functional impact score: ${score(scored.summary.functionalImpact)}.`
      : null,
    scored?.summary.agreement != null
      ? `Cross-informant agreement score: ${score(scored.summary.agreement)}.`
      : null,
    result?.confidenceBand || result?.confidence
      ? `Screening confidence: ${compactParts([result.confidenceBand, percent(result.confidence)]).join(" ")}.`
      : null,
    result?.recommendation ? `Next-step recommendation: ${result.recommendation}.` : null,
  ]).join("\n");

  return {
    title: "NDSCREEN: ADHD/autism indicators",
    content,
    scope: "NEURODEVELOPMENTAL_PROFILE",
    sortOrder: 5,
  };
}

function buildScoredDomainVector(screening: NdscreenChildScreening): VectorSpec | null {
  const scored = screening.scoredDomains;
  const clinical = screening.clinicalProfile;
  if (!scored) return null;

  const keyElevated = clinical?.keyElevatedDomains ?? [];
  const learningChallenges = scored.learningDomains.keyChallenges ?? [];
  const learningStrengths = scored.learningDomains.keyStrengths ?? [];
  const content = compactParts([
    "Use these scored domains as the evidence base for lesson personalization. They are screening data, not diagnoses.",
    `Profile type: ${screening.latestResult?.profileType ?? "unknown"}. Primary clinical classification: ${clinical?.primaryClassification ?? "unknown"}.`,
    `Summary scores: ADHD ${score(scored.summary.adhd)}, autism/ASC ${score(scored.summary.autism)}, emotion ${score(scored.summary.emotion)}, functional impact ${score(scored.summary.functionalImpact)}, agreement ${score(scored.summary.agreement)}.`,
    `ADHD-related domains: ${formatDomainScores(scored.neurodevelopmentalDomains.combined, [
      "A1_ATTENTION_SUSTAIN",
      "A2_DISTRACTIBILITY",
      "A3_IMPULSIVITY",
      "A4_RESTLESSNESS",
    ]) ?? "not available"}.`,
    `Autism-linked domains: ${formatDomainScores(scored.neurodevelopmentalDomains.combined, [
      "B1_SOCIAL_RECIPROCITY",
      "B2_SOCIAL_CUES",
      "B3_FLEXIBILITY_TRANSITIONS",
      "B4_SENSORY_SENSITIVITY",
    ]) ?? "not available"}.`,
    `Other regulation domain: ${formatDomainScores(scored.neurodevelopmentalDomains.combined, [
      "C1_EMOTIONAL_REGULATION",
    ]) ?? "not available"}.`,
    topDomainScores(scored.neurodevelopmentalDomains.combined).length
      ? `Top neurodevelopmental domains: ${topDomainScores(scored.neurodevelopmentalDomains.combined).join("; ")}.`
      : null,
    keyElevated.length
      ? `Clinical key elevated domains: ${keyElevated
          .map((item) => `${item.label ?? item.code}: ${score(item.score)} (${item.interpretation ?? "no interpretation"})`)
          .join("; ")}.`
      : null,
    topDomainScores(scored.learningDomains.combined).length
      ? `Learning domains: ${topDomainScores(scored.learningDomains.combined, 8).join("; ")}.`
      : null,
    learningChallenges.length
      ? `Learning challenges: ${learningChallenges
          .map((item) => `${item.label} ${score(item.score)} ${item.band}`)
          .join("; ")}.`
      : null,
    learningStrengths.length
      ? `Learning strengths: ${learningStrengths
          .map((item) => `${item.label} ${score(item.score)} ${item.band}`)
          .join("; ")}.`
      : null,
    clinical?.clinicalJustification?.length
      ? `Clinical reasoning: ${clinical.clinicalJustification.slice(0, 6).join(" ")}`
      : null,
  ]).join("\n");

  return {
    title: "NDSCREEN: Scored domain evidence",
    content,
    scope: "SCORED_DOMAIN_EVIDENCE",
    sortOrder: 6,
  };
}

function getNdscreenBaseUrl() {
  return cleanText(process.env.NDSCREEN_API_BASE_URL || "http://127.0.0.1:4098").replace(/\/+$/, "");
}

function getNdscreenExportToken() {
  const token = cleanText(process.env.NDSCREEN_EXPORT_TOKEN);
  if (!token) throw new Error("Missing NDSCREEN_EXPORT_TOKEN");
  return token;
}

async function listNdscreenChildScreenings() {
  const response = await fetch(`${getNdscreenBaseUrl()}/api/integrations/mylisa/children`, {
    headers: {
      authorization: `Bearer ${getNdscreenExportToken()}`,
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? `NDSCREEN children export failed (${response.status})`);
  }

  return (data?.items ?? []) as NdscreenChildScreening[];
}

function buildVectorSpecs(screening: NdscreenChildScreening): VectorSpec[] {
  const specs: VectorSpec[] = [];
  const learning = screening.learningProfile;
  const result = screening.latestResult;
  const report = screening.report;
  const neurodevelopmentalSignal = buildNeurodevelopmentalSignal(screening);
  const scoredDomainVector = buildScoredDomainVector(screening);

  if (neurodevelopmentalSignal) {
    specs.push(neurodevelopmentalSignal);
  }
  if (scoredDomainVector) {
    specs.push(scoredDomainVector);
  }

  if (learning) {
    const profileLabels = Array.isArray(learning.profiles) ? learning.profiles.filter(Boolean) : [];
    const content = compactParts([
      learning.primaryProfile ? `Primary profile: ${learning.primaryProfile}.` : null,
      learning.confidenceBand || learning.confidence
        ? `Learning confidence: ${compactParts([learning.confidenceBand, percent(learning.confidence)]).join(" ")}.`
        : null,
      profileLabels.length ? `Profile flags: ${profileLabels.join(", ")}.` : null,
      learning.summary || learning.summaryText,
      learning.recommendation ? `Recommended support: ${learning.recommendation}` : null,
    ]).join("\n");

    if (content) {
      specs.push({
        title: "NDSCREEN: Learning profile",
        content,
        scope: "LEARNING_PROFILE",
        sortOrder: 10,
      });
    }
  }

  if (result) {
    const content = compactParts([
      result.profileType ? `Result profile type: ${result.profileType}.` : null,
      result.confidenceBand || result.confidence
        ? `Result confidence: ${compactParts([result.confidenceBand, percent(result.confidence)]).join(" ")}.`
        : null,
      result.overall != null ? `Overall score: ${percent(result.overall)}.` : null,
      result.overallAdjusted != null ? `Adjusted score: ${percent(result.overallAdjusted)}.` : null,
      result.validity ? `Validity: ${result.validity}.` : null,
      result.recommendation ? `Result recommendation: ${result.recommendation}.` : null,
    ]).join("\n");

    if (content) {
      specs.push({
        title: "NDSCREEN: Result summary",
        content,
        scope: "SCREENING_RESULT",
        sortOrder: 20,
      });
    }
  }

  const controlContent = compactParts([
    screening.status ? `Screening status: ${screening.status}.` : null,
    screening.screeningKind ? `Screening kind: ${screening.screeningKind}.` : null,
    screening.questionSet?.key
      ? `Question set: ${screening.questionSet.key}${
          screening.questionSet.version != null ? ` v${screening.questionSet.version}` : ""
        }.`
      : null,
    report?.status ? `Report status: ${report.status}.` : null,
    report?.readyAt ? `Report ready at: ${report.readyAt}.` : null,
    report?.generatedAt ? `Report generated at: ${report.generatedAt}.` : null,
    report?.errorMessage ? `Report error: ${report.errorMessage}.` : null,
  ]).join("\n");

  if (controlContent) {
    specs.push({
      title: "NDSCREEN: Report control",
      content: controlContent,
      scope: "SCREENING_CONTROL",
      sortOrder: 30,
    });
  }

  return specs;
}

async function upsertVector(input: {
  organisationId: string;
  studentId: string;
  spec: VectorSpec;
}) {
  const existing = await prisma.wrapperVector.findFirst({
    where: {
      studentId: input.studentId,
      source: "NDSCREEN",
      title: input.spec.title,
    },
    select: { id: true },
  });

  if (existing) {
    await prisma.wrapperVector.update({
      where: { id: existing.id },
      data: {
        content: input.spec.content,
        scope: input.spec.scope,
        sortOrder: input.spec.sortOrder,
        isActive: true,
      },
    });
    return "updated" as const;
  }

  await prisma.wrapperVector.create({
    data: {
      organisationId: input.organisationId,
      studentId: input.studentId,
      title: input.spec.title,
      content: input.spec.content,
      scope: input.spec.scope,
      source: "NDSCREEN",
      sortOrder: input.spec.sortOrder,
      isActive: true,
    },
  });
  return "created" as const;
}

async function deactivateStaleNdscreenVectors(input: {
  studentId: string;
  activeTitles: string[];
}) {
  await prisma.wrapperVector.updateMany({
    where: {
      studentId: input.studentId,
      source: "NDSCREEN",
      title: {
        notIn: input.activeTitles,
      },
      isActive: true,
    },
    data: {
      isActive: false,
    },
  });
}

async function main() {
  const apply = hasFlag("--apply");
  const screenings = await listNdscreenChildScreenings();
  const screeningBySessionId = new Map(screenings.map((screening) => [screening.sessionId, screening]));

  const links = await prisma.studentIntegrationLink.findMany({
    where: {
      source: IntegrationSource.NDSCREEN,
      ndscreenSessionId: { not: null },
    },
    orderBy: [{ updatedAt: "desc" }],
    select: {
      studentId: true,
      ndscreenSessionId: true,
      student: {
        select: {
          organisationId: true,
        },
      },
    },
  });
  const latestLinkByStudentId = new Map<string, (typeof links)[number]>();
  for (const link of links) {
    if (!latestLinkByStudentId.has(link.studentId)) {
      latestLinkByStudentId.set(link.studentId, link);
    }
  }
  const latestLinks = Array.from(latestLinkByStudentId.values());

  let created = 0;
  let updated = 0;
  let skippedMissingScreening = 0;
  let skippedNoVectorContent = 0;
  let plannedVectors = 0;

  for (const link of latestLinks) {
    const sessionId = link.ndscreenSessionId;
    const screening = sessionId ? screeningBySessionId.get(sessionId) : null;
    if (!screening) {
      skippedMissingScreening += 1;
      continue;
    }

    const specs = buildVectorSpecs(screening);
    if (!specs.length) {
      skippedNoVectorContent += 1;
      continue;
    }

    plannedVectors += specs.length;

    if (!apply) continue;

    for (const spec of specs) {
      const result = await upsertVector({
        organisationId: link.student.organisationId,
        studentId: link.studentId,
        spec,
      });
      if (result === "created") created += 1;
      if (result === "updated") updated += 1;
    }

    await deactivateStaleNdscreenVectors({
      studentId: link.studentId,
      activeTitles: specs.map((spec) => spec.title),
    });
  }

  console.log(
    JSON.stringify(
      {
        mode: apply ? "apply" : "dry-run",
        linkedSessions: links.length,
        latestLinkedStudents: latestLinks.length,
        plannedVectors,
        created,
        updated,
        skippedMissingScreening,
        skippedNoVectorContent,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
