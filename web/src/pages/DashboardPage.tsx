import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import { loadState } from "../utils/storage";

export default function DashboardPage() {
  const navigate = useNavigate();
  const state = loadState();
  const hasLearner = Boolean(state.student?.studentId);
  const hasAssessment = Boolean(state.sessionId || state.result);

  return (
    <Layout
      title="Learning dashboard"
      subtitle="Start a new learner journey, look up an existing assessment, or move into lesson delivery from one place."
      kicker="MyLisa Control Centre"
    >
      <div className="grid grid-2">
        <div className="card">
          <h2>Assessment</h2>
          <p className="meta">
            Create a learner profile when a booking has not yet created one, then
            run the maths assessment flow.
          </p>
          <div className="dashboard-actions">
            <button className="btn btn-primary" onClick={() => navigate("/onboarding")}>
              Create learner profile
            </button>
            <button className="btn btn-secondary" onClick={() => navigate("/assessments")}>
              Look up existing assessments
            </button>
          </div>
        </div>

        <div className="card">
          <h2>Lesson management</h2>
          <p className="meta">
            Open the current learner report and launch lesson previews built from Oak objectives and canonical questions.
          </p>
          <div className="dashboard-actions">
            <button
              className="btn btn-primary"
              disabled={!hasLearner}
              onClick={() => navigate(hasAssessment ? "/report" : "/ready")}
            >
              {hasLearner ? "Open current learner" : "Create learner first"}
            </button>
          </div>
        </div>
      </div>

      <div style={{ height: 20 }} />

      <div className="card">
        <h2>Current workspace</h2>
        <div className="small-grid">
          <div>
            <strong>Learner:</strong>{" "}
            {state.student
              ? `${state.student.student.firstName ?? ""} ${state.student.student.lastName ?? ""}`.trim() ||
                state.student.email
              : "No learner loaded"}
          </div>
          <div>
            <strong>Assessment session:</strong> {state.sessionId || "No active session"}
          </div>
          <div>
            <strong>ndscreen session:</strong> {state.ndscreenSessionId || "Not linked"}
          </div>
        </div>
      </div>
    </Layout>
  );
}
