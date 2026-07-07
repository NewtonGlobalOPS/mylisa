import type {
  AssessmentNarrativeReport,
  AssessmentResult,
  AssessmentSession,
} from "./assessmentEngine.js";
import { llmJson } from "../lib/llmJson.js";

type AssessmentQuestionReview = {
  prompt: string;
  response: string;
  correctAnswer: string;
  isCorrect: boolean;
  strand: string;
  difficulty: string;
  yearGroup: number;
};

type AssessmentReportInput = {
  studentName: string;
  session: AssessmentSession;
  result: AssessmentResult;
  questions: AssessmentQuestionReview[];
};

function formatBandLabel(session: AssessmentSession, result: AssessmentResult): string {
  const entryYear = session.entryYear;

  switch (result.overallWorkingBand) {
    case "BELOW_ENTRY":
      return `Developing towards Year ${entryYear}`;
    case "ENTRY_SECURE":
      return `Secure in Year ${entryYear}`;
    case "ENTRY_SECURE_NEXT_EMERGING":
      return `Secure in Year ${entryYear} and beginning Year ${entryYear + 1}`;
    case "NEXT_DEVELOPING":
      return `Developing into Year ${entryYear + 1}`;
    case "NEXT_SECURE":
      return `Secure in Year ${entryYear + 1}`;
    case "INSUFFICIENT_EVIDENCE":
    default: {
      const secureAtEntry = result.strands.filter(
        (strand) => (strand.secureYear ?? Number.NEGATIVE_INFINITY) >= entryYear
      ).length;
      const emergingAtEntry = result.strands.filter(
        (strand) =>
          (strand.emergingYear ?? Number.NEGATIVE_INFINITY) >= entryYear ||
          (strand.secureYear ?? Number.NEGATIVE_INFINITY) >= entryYear
      ).length;

      if (secureAtEntry >= 2) {
        return `Building Year ${entryYear} security`;
      }

      if (emergingAtEntry >= 2) {
        return `Working around Year ${entryYear}`;
      }

      return `Developing towards Year ${entryYear}`;
    }
  }
}

function subjectLabel(session: AssessmentSession): "maths" | "science" {
  return String(session.subject).toUpperCase() === "SCIENCE" ? "science" : "maths";
}

function formatBandSummary(session: AssessmentSession, result: AssessmentResult): string {
  const entryYear = session.entryYear;
  const subject = subjectLabel(session);

  switch (result.overallWorkingBand) {
    case "BELOW_ENTRY":
      return `The assessment shows that ${session.childCurrentYear ? "this learner" : "the learner"} is still consolidating several foundations below the typical Year ${entryYear} starting point.`;
    case "ENTRY_SECURE":
      return `The assessment shows secure learning across most Year ${entryYear} content, with a good platform for the next stage of learning.`;
    case "ENTRY_SECURE_NEXT_EMERGING":
      return `The assessment shows secure Year ${entryYear} understanding and early readiness for some Year ${entryYear + 1} ideas.`;
    case "NEXT_DEVELOPING":
      return `The assessment shows a strong Year ${entryYear} base with developing success in Year ${entryYear + 1} content.`;
    case "NEXT_SECURE":
      return `The assessment shows secure understanding at Year ${entryYear + 1}, which is ahead of the entry starting point.`;
    case "INSUFFICIENT_EVIDENCE":
    default:
      return `The assessment found a mixed profile: some areas are secure at Year ${entryYear}, while others still need consolidation before the picture is fully even across ${subject}.`;
  }
}

function sentenceCaseStrand(strand: string): string {
  const value = strand.toLowerCase();
  return value.charAt(0).toUpperCase() + value.slice(1);
}

function strandLearningFocus(strand: string, session?: AssessmentSession): string {
  if (subjectLabel(session ?? ({ subject: "MATHS" } as AssessmentSession)) === "science") {
    return `${sentenceCaseStrand(strand)} understanding`;
  }

  switch (strand) {
    case "NUMBER":
      return "number fluency, place value, and efficient calculation";
    case "RATIO":
      return "fractions, proportional reasoning, and multiplicative thinking";
    case "GEOMETRY":
      return "shape, space, perimeter, and geometric reasoning";
    case "DATA":
      return "interpreting information, comparing values, and solving measure-based problems";
    case "ALGEBRA":
      return "patterns, rules, and simple algebraic thinking";
    default:
      return `${sentenceCaseStrand(strand)} understanding`;
  }
}

function describePromptTheme(prompt: string, session?: AssessmentSession): string {
  const normalized = prompt.toLowerCase();

  if (normalized.includes("perimeter")) return "perimeter";
  if (normalized.includes("equivalent fraction")) return "equivalent fractions";
  if (normalized.includes("fraction")) return "fractions";
  if (normalized.includes("coordinate")) return "coordinates";
  if (normalized.includes("sequence")) return "number patterns";
  if (normalized.includes("compare") || normalized.includes("difference"))
    return "comparison and difference questions";
  if (normalized.includes("symmetry")) return "symmetry";
  if (normalized.includes("clock") || normalized.includes("time")) return "time";

  return subjectLabel(session ?? ({ subject: "MATHS" } as AssessmentSession)) === "science"
    ? "scientific reasoning"
    : "multi-step maths reasoning";
}

function buildConfidenceNote(result: AssessmentResult): string {
  const percentage = Math.round(result.overallConfidence * 100);

  if (result.overallConfidence >= 0.8) {
    return `Confidence in this profile is strong at ${percentage}%, so it is reasonable to use it to plan the next block of learning.`;
  }

  if (result.overallConfidence >= 0.6) {
    return `Confidence in this profile is moderate at ${percentage}%, which means it is a useful working picture for planning the next teaching steps.`;
  }

  return `Confidence in this profile is still developing at ${percentage}%, so the next teaching block should confirm understanding while building security in the weakest areas.`;
}

function buildFallbackAssessmentReport(
  input: AssessmentReportInput
): AssessmentNarrativeReport {
  const { studentName, session, result, questions } = input;
  const entryYear = session.entryYear;
  const displayBandLabel = formatBandLabel(session, result);
  const displayBandSummary = formatBandSummary(session, result);
  const answeredStrands = result.strands.filter((strand) => strand.asked > 0);
  const strongest = [...answeredStrands]
    .sort((a, b) => {
      if (b.accuracy !== a.accuracy) return b.accuracy - a.accuracy;
      return b.confidence - a.confidence;
    })
    .slice(0, 2);
  const weakest = [...answeredStrands]
    .sort((a, b) => {
      if (a.accuracy !== b.accuracy) return a.accuracy - b.accuracy;
      return a.confidence - b.confidence;
    })
    .slice(0, 2);

  const wrongQuestions = questions.filter((question) => !question.isCorrect);
  const weakestThemes = wrongQuestions
    .slice(0, 4)
    .map((question) => describePromptTheme(question.prompt, session));
  const primaryWeakTheme = weakestThemes[0] ?? "core fluency";
  const secondaryWeakTheme =
    weakestThemes[1] ?? weakestThemes[0] ?? `${subjectLabel(session)} reasoning`;

  const strengths =
    strongest.length > 0
      ? strongest.map((strand) => {
          const secureText =
            strand.secureYear != null
              ? `secure at Year ${strand.secureYear}`
              : strand.emergingYear != null
              ? `showing emerging strength at Year ${strand.emergingYear}`
              : "showing positive evidence";

          return `${sentenceCaseStrand(strand.strand)} was a relative strength, with ${Math.round(
            strand.accuracy * 100
          )}% accuracy and evidence ${secureText}.`;
        })
      : ["The assessment collected enough evidence to begin shaping a targeted learning plan."];

  const focusAreas =
    weakest.length > 0
      ? weakest.map((strand) => {
          const relatedMiss = wrongQuestions.find(
            (question) => question.strand === strand.strand
          );
          const theme = relatedMiss
            ? describePromptTheme(relatedMiss.prompt, session)
            : strandLearningFocus(strand.strand, session);

          return `${sentenceCaseStrand(strand.strand)} needs the most support next. Accuracy was ${Math.round(
            strand.accuracy * 100
          )}% across ${strand.asked} questions, with the clearest gap in ${theme}.`;
        })
      : [`The next teaching block should continue building consistency around Year ${entryYear}.`];

  const nextSteps = [
    `Teach from a ${displayBandLabel.toLowerCase()} starting point, using Year ${entryYear} material as the default anchor before extending further.`,
    `Plan short, regular practice on ${primaryWeakTheme} and ${secondaryWeakTheme}, using worked examples first and then independent checks.`,
    `Keep confidence high by mixing one secure strand with one developing strand in each lesson, so ${studentName} can experience success while closing gaps.`,
  ];

  const tutorActions = [
    `Start the next lesson sequence with ${weakest
      .map((strand) => strandLearningFocus(strand.strand, session))
      .slice(0, 2)
      .join(" and ")}.`,
    `Use retrieval and error-correction on missed question types, especially ${primaryWeakTheme}.`,
    `Review for secure Year ${entryYear} consistency before pushing heavily into Year ${
      entryYear + 1
    } content.`,
  ];

  const parentNarrative =
    result.overallWorkingBand === "INSUFFICIENT_EVIDENCE"
      ? `${studentName} is showing a mixed but useful assessment profile. Some parts of Year ${entryYear} learning look secure already, while other parts still need more practice before everything feels steady and connected.`
      : `${studentName} has completed an adaptive ${subjectLabel(session)} assessment that adjusted as evidence built. The current picture places ${studentName} at ${displayBandLabel.toLowerCase()}, which gives us a practical starting point for teaching next.`;

  const tutorNarrative = `Assessment evidence suggests the learner should be taught from ${displayBandLabel.toLowerCase()}. The strongest current evidence sits in ${strongest
    .map((strand) => sentenceCaseStrand(strand.strand))
    .join(" and ") || "the better-performing strands"}, while the main friction is in ${weakest
    .map((strand) => sentenceCaseStrand(strand.strand))
    .join(" and ") || "the least secure strands"}.`;

  const whatThisMeans = `This outcome should be read as a teaching starting point, not a ceiling. The adaptive assessment has identified where learning is secure, where it is still emerging, and where immediate consolidation will make the biggest difference.`;

  return {
    displayBandLabel,
    displayBandSummary,
    parentNarrative,
    tutorNarrative,
    whatThisMeans,
    strengths,
    focusAreas,
    nextSteps,
    tutorActions,
    confidenceNote: buildConfidenceNote(result),
  };
}

function stripJsonFence(raw: string): string {
  return raw.replace(/^```json\s*/i, "").replace(/^```\s*/i, "").replace(/\s*```$/i, "").trim();
}

function coerceStringArray(value: unknown, fallback: string[]): string[] {
  if (!Array.isArray(value)) return fallback;
  const next = value
    .map((entry) => (typeof entry === "string" ? entry.trim() : ""))
    .filter(Boolean)
    .slice(0, 5);
  return next.length > 0 ? next : fallback;
}

function parseAssessmentNarrativeReport(
  raw: string,
  fallback: AssessmentNarrativeReport
): AssessmentNarrativeReport {
  try {
    const parsed = JSON.parse(stripJsonFence(raw)) as Record<string, unknown>;
    const getString = (key: keyof AssessmentNarrativeReport, defaultValue: string) =>
      typeof parsed[key] === "string" && String(parsed[key]).trim().length > 0
        ? String(parsed[key]).trim()
        : defaultValue;

    return {
      displayBandLabel: getString("displayBandLabel", fallback.displayBandLabel),
      displayBandSummary: getString("displayBandSummary", fallback.displayBandSummary),
      parentNarrative: getString("parentNarrative", fallback.parentNarrative),
      tutorNarrative: getString("tutorNarrative", fallback.tutorNarrative),
      whatThisMeans: getString("whatThisMeans", fallback.whatThisMeans),
      strengths: coerceStringArray(parsed.strengths, fallback.strengths),
      focusAreas: coerceStringArray(parsed.focusAreas, fallback.focusAreas),
      nextSteps: coerceStringArray(parsed.nextSteps, fallback.nextSteps),
      tutorActions: coerceStringArray(parsed.tutorActions, fallback.tutorActions),
      confidenceNote: getString("confidenceNote", fallback.confidenceNote),
    };
  } catch {
    return fallback;
  }
}

async function maybeRewriteAssessmentReportWithLlm(
  input: AssessmentReportInput,
  fallback: AssessmentNarrativeReport
): Promise<AssessmentNarrativeReport> {
  try {
    const compactQuestionEvidence = input.questions.slice(0, 8).map((question) => ({
      prompt: question.prompt,
      strand: question.strand,
      yearGroup: question.yearGroup,
      difficulty: question.difficulty,
      response: question.response,
      correctAnswer: question.correctAnswer,
      isCorrect: question.isCorrect,
    }));

    const prompt = JSON.stringify(
      {
        studentName: input.studentName,
        subject: subjectLabel(input.session),
        childCurrentYear: input.session.childCurrentYear,
        entryYear: input.session.entryYear,
        overallWorkingBand: input.result.overallWorkingBand,
        overallConfidence: input.result.overallConfidence,
        questionCount: input.result.questionCount,
        completionReason: input.result.completionReason ?? null,
        strands: input.result.strands,
        compactQuestionEvidence,
        deterministicDraft: fallback,
        instructions: [
          "Rewrite the draft into parent-friendly and tutor-friendly language.",
          "Never use the phrase 'insufficient evidence' in any field.",
          "If the profile is mixed, explain that some areas are secure and some still need consolidation.",
          "Keep every statement grounded in the assessment evidence provided.",
          "Use the supplied subject. Do not call a science assessment maths, and do not call a maths assessment science.",
          "Return valid JSON only with these fields: displayBandLabel, displayBandSummary, parentNarrative, tutorNarrative, whatThisMeans, strengths, focusAreas, nextSteps, tutorActions, confidenceNote.",
          "Each array should have 2 to 4 short, concrete items.",
        ],
      },
      null,
      2
    );

    const raw = await llmJson(prompt, {
      maxCompletionTokens: 700,
      systemPrompt:
        "You are an educational assessment report writer. Return only valid JSON. Do not use markdown. Be supportive, concrete, and evidence-led.",
      temperature: 0.2,
    });

    return parseAssessmentNarrativeReport(raw, fallback);
  } catch {
    return fallback;
  }
}

export async function buildAssessmentNarrativeReport(
  input: AssessmentReportInput
): Promise<AssessmentNarrativeReport> {
  const fallback = buildFallbackAssessmentReport(input);
  return maybeRewriteAssessmentReportWithLlm(input, fallback);
}
