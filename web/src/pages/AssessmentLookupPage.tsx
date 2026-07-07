import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import { searchDashboardLearners, startAssessment } from "../api/assessmentApi";
import type { DashboardLearnerLookupResponse } from "../types/assessment";
import { loadState, saveNdscreenSessionId, saveState, saveStudentFromLookup } from "../utils/storage";
import { normaliseAssessmentYear } from "../utils/schoolYear";

type LearnerRow = DashboardLearnerLookupResponse["items"][number];
type AssessmentSubject = "MATHS" | "SCIENCE";

const ASSESSMENT_SUBJECTS: AssessmentSubject[] = ["MATHS", "SCIENCE"];

function defaultAssessmentSubject(subjects: string[]): AssessmentSubject {
  return subjects.includes("SCIENCE") && !subjects.includes("MATHS") ? "SCIENCE" : "MATHS";
}

export default function AssessmentLookupPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [results, setResults] = useState<DashboardLearnerLookupResponse["items"]>([]);
  const [startingId, setStartingId] = useState("");

  async function runSearch(searchQuery?: string) {
    setLoading(true);
    setError("");

    try {
      const next = await searchDashboardLearners({
        query: searchQuery,
        limit: 20,
      });
      setResults(next.items);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to search learners");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void runSearch();
  }, []);

  function loadLearner(row: LearnerRow) {
    saveStudentFromLookup({
      userId: row.userId,
      studentId: row.studentId,
      email: row.userEmail,
      firstName: row.firstName,
      lastName: row.lastName,
      age: row.age,
      schoolYear: row.schoolYear ?? Math.max(1, Math.min(13, row.age - 4)),
      keyStage: row.keyStage,
      subjects: row.subjects,
      guardianEmail: row.guardianEmail,
    });
    saveNdscreenSessionId(row.ndscreenSessionId ?? "");
  }

  async function startFreshAssessment(row: LearnerRow, subject = defaultAssessmentSubject(row.subjects)) {
    loadLearner(row);
    setStartingId(row.studentId);
    setError("");

    try {
      const started = await startAssessment({
        studentId: row.studentId,
        childCurrentYear: normaliseAssessmentYear(row.schoolYear, row.age),
        subject,
      });

      saveState({
        ...loadState(),
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
      setStartingId("");
    }
  }

  function openExistingReport(row: LearnerRow) {
    loadLearner(row);
    saveState({
      ...loadState(),
      subject: row.latestAssessment?.subject ?? defaultAssessmentSubject(row.subjects),
      sessionId: row.latestAssessment?.id ?? "",
      currentQuestion: null,
      result: null,
      askedCount: 0,
    });
    navigate("/report");
  }

  return (
    <Layout
      title="Assessment lookup"
      subtitle="Find learners by name, guardian email, booking id, or session id and reopen their assessment context."
      kicker="MyLisa Control Centre"
    >
      <div className="card">
        <div className="button-row">
          <button className="btn btn-secondary" onClick={() => navigate("/dashboard")}>
            Back to dashboard
          </button>
        </div>
        <div style={{ height: 16 }} />
        <label className="label">Search learners</label>
        <div className="lookup-row">
          <input
            className="input"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Name, guardian email, booking id, or assessment session id"
          />
          <button className="btn btn-primary" onClick={() => void runSearch(query)}>
            Search
          </button>
        </div>
        {error ? <div className="error-box">{error}</div> : null}
      </div>

      <div style={{ height: 20 }} />

      <div className="card">
        <h2>Results</h2>
        {loading ? <p className="meta">Loading learners...</p> : null}
        {!loading && results.length === 0 ? (
          <p className="meta">
            No learners matched. If the booking has not created a learner yet, go back to the dashboard and use create learner profile.
          </p>
        ) : null}
        <div className="profile-stack">
          {results.map((row) => {
            return (
            <div key={row.studentId} className="profile-item">
              <div className="profile-item-head">
                <strong>{row.displayName}</strong>
                <span className="pill">
                  {row.schoolYear != null ? `Year ${row.schoolYear}` : row.keyStage ?? "Learner"}
                </span>
              </div>
              <div className="small-grid">
                <div>
                  <strong>Guardian:</strong> {row.guardianEmail ?? "-"}
                </div>
                <div>
                  <strong>Subjects:</strong> {row.subjects.join(", ")}
                </div>
                <div>
                  <strong>Booking IDs:</strong> {row.bookingIds.length ? row.bookingIds.join(", ") : "-"}
                </div>
                <div>
                  <strong>Latest assessment:</strong>{" "}
                  {row.latestAssessment
                    ? `${row.latestAssessment.subject === "SCIENCE" ? "Science" : "Maths"} · ${row.latestAssessment.status} · ${new Date(row.latestAssessment.updatedAt).toLocaleString()}`
                    : "No assessment yet"}
                </div>
              </div>
              <div className="dashboard-actions" style={{ marginTop: 14 }}>
                {ASSESSMENT_SUBJECTS.map((subject) => (
                  <button
                    key={subject}
                    className={subject === "SCIENCE" ? "btn btn-primary" : "btn btn-secondary"}
                    disabled={startingId === row.studentId}
                    onClick={() => void startFreshAssessment(row, subject)}
                  >
                    {startingId === row.studentId
                      ? "Starting..."
                      : `Start ${subject === "MATHS" ? "Maths" : "Science"} assessment`}
                  </button>
                ))}
                <button
                  className="btn btn-secondary"
                  disabled={!row.latestAssessment}
                  onClick={() => openExistingReport(row)}
                >
                  Open existing report
                </button>
              </div>
            </div>
            );
          })}
        </div>
      </div>
    </Layout>
  );
}
