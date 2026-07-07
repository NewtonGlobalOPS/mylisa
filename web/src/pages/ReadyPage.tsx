import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import { startAssessment } from "../api/assessmentApi";
import { loadState, saveState } from "../utils/storage";
import {
  defaultStartingYearFromSchoolYear,
  normaliseAssessmentYear,
} from "../utils/schoolYear";
import { getAgePresentation } from "../utils/agePresentation";

const ASSESSMENT_SUBJECTS = ["MATHS", "SCIENCE"] as const;

function getSubjectReadyCopy(
  presentation: ReturnType<typeof getAgePresentation>,
  subject: "MATHS" | "SCIENCE"
) {
  if (subject !== "SCIENCE") return presentation;

  return {
    ...presentation,
    kicker: "Newton Centre Science",
    readyTitle: "Ready to begin your science check-in?",
    readySubtitle: "The questions will adapt as we learn what feels secure.",
    readySetupText:
      "The science assessment starts just below current school year and adjusts as evidence builds.",
    startButtonLabel: "Begin science check-in",
  };
}

export default function ReadyPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const state = loadState();
  const student = state.student;
  const [subject, setSubject] = useState<"MATHS" | "SCIENCE">(
    state.subject === "SCIENCE" ? "SCIENCE" : "MATHS"
  );

  if (!student) {
    navigate("/onboarding");
    return null;
  }

  const ensuredStudent = student;
  const availableSubjects = ASSESSMENT_SUBJECTS;
  const selectedSubject = availableSubjects.includes(subject) ? subject : availableSubjects[0] ?? "MATHS";
  const presentation = getSubjectReadyCopy(
    getAgePresentation(ensuredStudent.student.schoolYear),
    selectedSubject
  );
  const startingYear = defaultStartingYearFromSchoolYear(
    normaliseAssessmentYear(
      ensuredStudent.student.schoolYear,
      ensuredStudent.student.age
    )
  );
  const assessmentYear = normaliseAssessmentYear(
    ensuredStudent.student.schoolYear,
    ensuredStudent.student.age
  );

  async function handleStart() {
    setLoading(true);
    setError("");

    try {
      const started = await startAssessment({
        studentId: ensuredStudent.studentId,
        childCurrentYear: assessmentYear,
        subject: selectedSubject,
      });

      saveState({
        ...state,
        student: ensuredStudent,
        subject: started.subject,
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
          {availableSubjects.length ? (
            <>
              <label className="label">Assessment subject</label>
              <div className="button-row" aria-label="Choose assessment subject">
                {availableSubjects.map((item) => (
                  <button
                    key={item}
                    type="button"
                    className={selectedSubject === item ? "btn btn-primary" : "btn btn-secondary"}
                    onClick={() => setSubject(item)}
                  >
                    {item === "MATHS" ? "Maths" : "Science"}
                  </button>
                ))}
              </div>
              <div style={{ height: 14 }} />
            </>
          ) : null}

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
