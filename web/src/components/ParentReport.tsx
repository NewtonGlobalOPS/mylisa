import type {
  AssessmentResult,
  CombinedChildProfileResponse,
  StudentOnboardingResponse,
} from "../types/assessment";
import { getAgePresentation } from "../utils/agePresentation";

function strandComment(
  strand: {
    strand: string;
    secureYear: number | null;
    emergingYear: number | null;
    accuracy: number;
  },
  entryYear: number | null
) {
  if (strand.secureYear != null) {
    return `Secure at Year ${strand.secureYear} with ${Math.round(
      strand.accuracy * 100
    )}% accuracy.`;
  }

  if (strand.emergingYear != null) {
    return `Emerging at Year ${strand.emergingYear} with ${Math.round(
      strand.accuracy * 100
    )}% accuracy.`;
  }

  return entryYear != null
    ? `Still consolidating before secure Year ${entryYear} performance. ${Math.round(
        strand.accuracy * 100
      )}% accuracy so far.`
    : `${Math.round(strand.accuracy * 100)}% accuracy so far.`;
}

function fallbackDisplayBand(result: AssessmentResult, entryYear: number | null): string {
  const safeEntryYear = entryYear ?? 1;

  switch (result.overallWorkingBand) {
    case "BELOW_ENTRY":
      return `Developing towards Year ${safeEntryYear}`;
    case "ENTRY_SECURE":
      return `Secure in Year ${safeEntryYear}`;
    case "ENTRY_SECURE_NEXT_EMERGING":
      return `Secure in Year ${safeEntryYear} and beginning Year ${safeEntryYear + 1}`;
    case "NEXT_DEVELOPING":
      return `Developing into Year ${safeEntryYear + 1}`;
    case "NEXT_SECURE":
      return `Secure in Year ${safeEntryYear + 1}`;
    case "INSUFFICIENT_EVIDENCE":
    default:
      return `Building Year ${safeEntryYear} security`;
  }
}

function fallbackNarrative(result: AssessmentResult, entryYear: number | null) {
  const safeEntryYear = entryYear ?? 1;
  const strongest = [...result.strands]
    .filter((strand) => strand.asked > 0)
    .sort((a, b) => b.accuracy - a.accuracy)
    .slice(0, 2);
  const weakest = [...result.strands]
    .filter((strand) => strand.asked > 0)
    .sort((a, b) => a.accuracy - b.accuracy)
    .slice(0, 2);

  return {
    displayBandLabel: fallbackDisplayBand(result, entryYear),
    displayBandSummary:
      result.overallWorkingBand === "INSUFFICIENT_EVIDENCE"
        ? `This assessment found a mixed profile around Year ${safeEntryYear}: some strands look secure already, while others still need consolidation.`
        : result.summary,
    parentNarrative:
      result.overallWorkingBand === "INSUFFICIENT_EVIDENCE"
        ? `The adaptive assessment gives a useful working picture rather than a dead end. It shows where learning is already steady and where a short period of focused teaching should help the child move forward.`
        : result.summary,
    tutorNarrative: `Assessment planning should start from ${fallbackDisplayBand(
      result,
      entryYear
    ).toLowerCase()}, with the strongest evidence in ${strongest
      .map((strand) => strand.strand)
      .join(" and ") || "the better-performing strands"} and the main consolidation need in ${weakest
      .map((strand) => strand.strand)
      .join(" and ") || "the weaker strands"}.`,
    whatThisMeans:
      "This outcome is a teaching starting point. It combines accuracy, consistency, and how securely the child answered across different maths strands.",
    strengths:
      strongest.length > 0
        ? strongest.map(
            (strand) =>
              `${strand.strand} was a relative strength with ${Math.round(
                strand.accuracy * 100
              )}% accuracy.`
          )
        : ["The assessment captured enough evidence to begin shaping a focused learning plan."],
    focusAreas:
      weakest.length > 0
        ? weakest.map(
            (strand) =>
              `${strand.strand} needs the next block of consolidation, with ${Math.round(
                strand.accuracy * 100
              )}% accuracy so far.`
          )
        : [`Continue consolidating Year ${safeEntryYear} understanding before extending further.`],
    nextSteps: [
      `Teach from a Year ${safeEntryYear} starting point and secure consistency before accelerating.`,
      "Use short, frequent practice on the least secure strands with worked examples and quick checks.",
      "Balance consolidation with confidence-building success in the strongest strands.",
    ],
    tutorActions: [
      "Plan the next lesson sequence around the least secure strands first.",
      "Review common errors explicitly and ask the child to explain the correct method back.",
      `Recheck for secure Year ${safeEntryYear} consistency before moving fully into Year ${
        safeEntryYear + 1
      } material.`,
    ],
    confidenceNote: `Confidence in this assessment picture is ${Math.round(
      result.overallConfidence * 100
    )}%.`,
  };
}

function shortObjectiveCode(code: string) {
  const parts = code.split(":").filter(Boolean);
  if (parts.length >= 4) {
    const subject = parts[1]?.toUpperCase();
    const keyStage = parts[2]?.toUpperCase();
    const slug = parts[3]
      ?.split("-")
      .filter(Boolean)
      .slice(0, 3)
      .join(" ");
    return [subject, keyStage, slug].filter(Boolean).join(" · ");
  }

  return code.length > 42 ? `${code.slice(0, 39)}...` : code;
}

export default function ParentReport({
  student,
  result,
  sessionId,
  profile,
  subject = "MATHS",
}: {
  student: StudentOnboardingResponse | null;
  result: AssessmentResult;
  sessionId: string;
  profile?: CombinedChildProfileResponse | null;
  subject?: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
}) {
  const name =
    [student?.student.firstName, student?.student.lastName]
      .filter(Boolean)
      .join(" ") || "Student";
  const presentation = getAgePresentation(student?.student.schoolYear);
  const entryYear =
    profile?.assessment?.entryYear ??
    (typeof student?.student.schoolYear === "number"
      ? Math.max(1, student.student.schoolYear - 1)
      : null);
  const evidenceResult: AssessmentResult = profile?.assessment
    ? {
        ...result,
        overallWorkingBand:
          profile.assessment.overallWorkingBand ?? result.overallWorkingBand,
        overallConfidence:
          profile.assessment.overallConfidence ?? result.overallConfidence,
        questionCount: profile.assessment.questionCount,
        strands: profile.assessment.strands.map((strand) => ({
          strand: strand.strand,
          asked: strand.asked,
          correct: strand.correct,
          accuracy: strand.accuracy,
          confidence: strand.confidence,
          secureYear: strand.secureYear,
          emergingYear: strand.emergingYear,
        })),
      }
    : result;
  const report = result.report ?? fallbackNarrative(evidenceResult, entryYear);
  const recommendedObjectives = (profile?.recommendations.objectives ?? []).slice(0, 3);
  const interventions = (profile?.recommendations.course.interventions ?? []).slice(0, 3);
  const reportObjectives = (profile?.learningReport.objectives ?? []).slice(0, 8);
  const lessonProgress = profile?.learningReport.lessons ?? [];
  const completedLessonProgress = lessonProgress.filter(
    (lesson) => lesson.endedAt || lesson.status === "COMPLETED",
  );
  const completedQuestionsAnswered = completedLessonProgress.reduce(
    (sum, lesson) => sum + lesson.questionsAnswered,
    0,
  );
  const completedQuestionsCorrect = completedLessonProgress.reduce(
    (sum, lesson) => sum + lesson.questionsCorrect,
    0,
  );
  const subjectTitle = subject === "SCIENCE" ? "Science" : "Maths";
  const subjectLabel = subject === "SCIENCE" ? "science" : "maths";

  return (
    <div className="report-page">
      <div className="report-header">
          <div>
            <div className="kicker">{presentation.kicker}</div>
            <h1 className="report-title">{subjectTitle} assessment report</h1>
          </div>
        <div className="report-meta">
          <div>
            <strong>Student:</strong> {name}
          </div>
          <div>
            <strong>Age:</strong> {student?.student.age ?? "-"}
          </div>
          <div>
            <strong>School year:</strong> Year {student?.student.schoolYear ?? "-"}
          </div>
          <div>
            <strong>Session:</strong> {sessionId}
          </div>
          <div>
            <strong>Questions answered:</strong> {result.questionCount}
          </div>
        </div>
      </div>

      <div className="report-section">
        <h2>Overall outcome</h2>
        <p>
          The assessment places {name} at
          <strong> {report.displayBandLabel}</strong> with an overall confidence level of{" "}
          <strong>{Math.round(evidenceResult.overallConfidence * 100)}%</strong>.
        </p>
        <p>{report.displayBandSummary}</p>
        <p>{report.parentNarrative}</p>
        <p>{report.confidenceNote}</p>
      </div>

      <div className="report-section">
        <h2>What this means</h2>
        <p>
          {report.whatThisMeans.replace(
            "maths strands",
            `${subjectLabel} strands`
          )}
        </p>
        <p>{report.tutorNarrative}</p>
      </div>

      <div className="report-section">
        <h2>Strand overview</h2>
        <div className="report-grid">
          {evidenceResult.strands.map((strand) => (
            <div key={strand.strand} className="report-card">
              <h3>{strand.strand}</h3>
              <p>{strandComment(strand, entryYear)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="report-section">
        <h2>Strengths to build on</h2>
        <div className="report-grid">
          {report.strengths.map((item) => (
            <div key={item} className="report-card">
              <p>{item}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="report-section">
        <h2>Priority focus areas</h2>
        <div className="report-grid">
          {report.focusAreas.map((item) => (
            <div key={item} className="report-card">
              <p>{item}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="report-section">
        <h2>Recommended next steps</h2>
        <div className="report-grid">
          {report.nextSteps.map((item) => (
            <div key={item} className="report-card">
              <p>{item}</p>
            </div>
          ))}
          {recommendedObjectives.map((objective) => (
            <div key={objective.objectiveId} className="report-card">
              <h3>{objective.title}</h3>
              <p>
                {objective.yearGroup != null ? `Year ${objective.yearGroup}. ` : ""}
                {objective.reason}
              </p>
            </div>
          ))}
        </div>
      </div>

      {profile?.learningReport ? (
        <div className="report-section">
          <h2>Course and objectives set</h2>
          <p>
            <strong>{profile.learningReport.course.title}</strong>{" "}
            ({profile.learningReport.course.status.toLowerCase().replaceAll("_", " ")}).
          </p>
          <div className="report-grid">
            {reportObjectives.map((objective) => (
              <div key={objective.objectiveId} className="report-card">
                <div className="report-objective-number">
                  {objective.sequence ? `${objective.sequence}. ` : ""}
                  {shortObjectiveCode(objective.code)}
                </div>
                <h3>{objective.title}</h3>
                <p>
                  {objective.yearGroup != null ? ` Year ${objective.yearGroup}.` : ""}
                  {objective.strand ? ` ${objective.strand}.` : ""}
                </p>
                <p>{objective.reason}</p>
                <p className="report-code">{objective.code}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {profile?.learningReport ? (
        <div className="report-section">
          <h2>Lesson progress</h2>
          <p>
            {completedLessonProgress.length} completed lessons recorded.{" "}
            {completedQuestionsAnswered
              ? `${completedQuestionsCorrect}/${completedQuestionsAnswered} lesson questions correct overall.`
              : "No lesson question responses have been recorded yet."}
          </p>
          <div className="report-grid">
            {completedLessonProgress.map((lesson) => (
              <div key={lesson.lessonSessionId} className="report-card">
                <h3>{lesson.title}</h3>
                <p>
                  {lesson.objective.code}: {lesson.objective.title}
                </p>
                <p>{lesson.progressLabel}</p>
              </div>
            ))}
            {!completedLessonProgress.length ? (
              <div className="report-card">
                <p>
                  No completed lessons have been recorded yet. Progress will be added here once lesson sessions are completed.
                </p>
              </div>
            ) : null}
          </div>
        </div>
      ) : null}

      <div className="report-section">
        <h2>Tutor planning notes</h2>
        <div className="report-grid">
          {report.tutorActions.map((item) => (
            <div key={item} className="report-card">
              <p>{item}</p>
            </div>
          ))}
          {interventions.map((item) => (
            <div key={`${item.label}-${item.targetYear ?? "na"}`} className="report-card">
              <h3>{item.label}</h3>
              <p>{item.reason}</p>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
