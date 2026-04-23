import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import { startAssessment } from "../api/assessmentApi";
import { loadState, saveState } from "../utils/storage";
import { defaultStartingYearFromSchoolYear } from "../utils/schoolYear";
import { getAgePresentation } from "../utils/agePresentation";

export default function ReadyPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const state = loadState();
  const student = state.student;

  if (!student) {
    navigate("/onboarding");
    return null;
  }

  const ensuredStudent = student;
  const presentation = getAgePresentation(ensuredStudent.student.schoolYear);
  const startingYear = defaultStartingYearFromSchoolYear(
    ensuredStudent.student.schoolYear
  );

  async function handleStart() {
    setLoading(true);
    setError("");

    try {
      const started = await startAssessment({
        studentId: ensuredStudent.studentId,
        childCurrentYear: ensuredStudent.student.schoolYear,
      });

      saveState({
        ...state,
        student: ensuredStudent,
        sessionId: started.sessionId,
        entryYear: started.entryYear,
        currentQuestion: started.firstQuestion,
        result: null,
        askedCount: 0,
      });

      navigate("/assessment");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start assessment");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout
      title={presentation.readyTitle}
      subtitle={presentation.readySubtitle}
      kicker={presentation.kicker}
      themeClass={presentation.themeClass}
    >
      <div className="grid grid-2">
        <div className="card">
          <h2>Learner</h2>
          <div className="small-grid">
            <div>
              <strong>Name:</strong> {ensuredStudent.student.firstName}{" "}
              {ensuredStudent.student.lastName}
            </div>
            <div>
              <strong>Age:</strong> {ensuredStudent.student.age}
            </div>
            <div>
              <strong>School year:</strong> Year {ensuredStudent.student.schoolYear}
            </div>
            <div>
              <strong>Key stage:</strong> {ensuredStudent.student.keyStage}
            </div>
            <div>
              <strong>Subject:</strong> {ensuredStudent.student.subjects.join(", ")}
            </div>
            <div>
              <strong>Assessment start point:</strong> Year {startingYear}
            </div>
          </div>
        </div>

        <div className="card">
          <h2>Assessment setup</h2>
          <p className="meta">
            {presentation.readySetupText}
          </p>

          {error ? <div className="error-box">{error}</div> : null}

          <button
            className="btn btn-primary"
            disabled={loading}
            onClick={handleStart}
          >
            {loading ? "Starting..." : presentation.startButtonLabel}
          </button>
        </div>
      </div>
    </Layout>
  );
}
