import type {
  AssessmentResult,
  StudentOnboardingResponse,
} from "../types/assessment";
import { getAgePresentation } from "../utils/agePresentation";

function strandComment(strand: {
  strand: string;
  secureYear: number | null;
  emergingYear: number | null;
  accuracy: number;
}) {
  const secure = strand.secureYear
    ? `secure around Year ${strand.secureYear}`
    : "still building evidence";
  const emerging = strand.emergingYear
    ? ` with emerging Year ${strand.emergingYear} evidence`
    : "";
  const accuracy = `${Math.round(strand.accuracy * 100)}% accuracy`;
  return `${secure}${emerging}. ${accuracy}.`;
}

export default function ParentReport({
  student,
  result,
  sessionId,
}: {
  student: StudentOnboardingResponse | null;
  result: AssessmentResult;
  sessionId: string;
}) {
  const name =
    [student?.student.firstName, student?.student.lastName]
      .filter(Boolean)
      .join(" ") || "Student";
  const presentation = getAgePresentation(student?.student.schoolYear);

  return (
    <div className="report-page">
      <div className="report-header">
          <div>
            <div className="kicker">{presentation.kicker}</div>
            <h1 className="report-title">Maths assessment report</h1>
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
          The assessment indicates that {name} is currently working at
          <strong> {result.overallWorkingBand.replaceAll("_", " ")}</strong> with
          an overall confidence level of{" "}
          <strong>{Math.round(result.overallConfidence * 100)}%</strong>.
        </p>
        <p>{result.summary}</p>
      </div>

      <div className="report-section">
        <h2>What this means</h2>
        <p>
          This assessment is adaptive, which means the questions change as
          evidence builds. The result reflects both accuracy and consistency
          across different areas of maths.
        </p>
      </div>

      <div className="report-section">
        <h2>Strand overview</h2>
        <div className="report-grid">
          {result.strands.map((strand) => (
            <div key={strand.strand} className="report-card">
              <h3>{strand.strand}</h3>
              <p>{strandComment(strand)}</p>
            </div>
          ))}
        </div>
      </div>

      <div className="report-section">
        <h2>Recommended next step</h2>
        <p>
          A targeted learning plan can now be built around the areas showing
          strongest readiness, while continuing to strengthen the strands where
          secure evidence is still being consolidated.
        </p>
      </div>
    </div>
  );
}
