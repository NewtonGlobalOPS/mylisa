import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import ParentReport from "../components/ParentReport";
import { getCombinedChildProfile } from "../api/assessmentApi";
import type { CombinedChildProfileResponse } from "../types/assessment";
import { clearState, loadState, saveState } from "../utils/storage";

export default function ReportPage() {
  const navigate = useNavigate();
  const state = loadState();
  const studentId = state.student?.studentId ?? "";
  const assessmentSessionId = state.sessionId ?? "";
  const persistedNdscreenSessionId = state.ndscreenSessionId ?? "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<CombinedChildProfileResponse | null>(null);
  const [ndscreenInput, setNdscreenInput] = useState(persistedNdscreenSessionId);
  const [ndscreenSessionId, setNdscreenSessionId] = useState(persistedNdscreenSessionId);

  useEffect(() => {
    if (!state.student?.studentId) {
      navigate("/dashboard");
      return;
    }

    async function loadProfile() {
      if (!studentId) return;

      setLoading(true);
      setError("");

      try {
        const next = await getCombinedChildProfile({
          studentId,
          assessmentSessionId: assessmentSessionId || undefined,
          ndscreenSessionId: ndscreenSessionId.trim() || undefined,
        });
        setProfile(next);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load combined child profile"
        );
      } finally {
        setLoading(false);
      }
    }

    void loadProfile();
  }, [
    assessmentSessionId,
    ndscreenSessionId,
    navigate,
    state.result,
    studentId,
  ]);

  if (!state.student?.studentId) {
    return null;
  }

  function applyNdscreenSession() {
    const nextSessionId = ndscreenInput.trim();
    setNdscreenSessionId(nextSessionId);
    saveState({
      ...state,
      ndscreenSessionId: nextSessionId,
    });
  }

  return (
    <Layout
      title="Unified learner profile"
      subtitle="Bring MyLisa maths assessment evidence and ndscreen screening context into one view so the next course, strands, and objectives can be chosen deliberately."
    >
      <div className="card no-print">
        <div className="button-row">
          <button className="btn btn-primary" onClick={() => window.print()}>
            Print / Save as PDF
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => navigate("/dashboard")}
          >
            Dashboard
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              clearState();
              navigate("/onboarding");
            }}
          >
            New learner
          </button>
        </div>
      </div>

      <div style={{ height: 20 }} />

      <div className="grid grid-2">
        <div className="card">
          <h2>Integrated profile</h2>
          <p className="meta">
            Link an ndscreen session to blend screening context with the maths
            assessment.
          </p>
          <label className="label">ndscreen session ID</label>
          <input
            className="input"
            value={ndscreenInput}
            onChange={(e) => setNdscreenInput(e.target.value)}
            placeholder="Paste session ID to load screening context"
          />
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={applyNdscreenSession}>
              Load screening profile
            </button>
          </div>
          {error ? <div className="error-box">{error}</div> : null}
          {loading ? <p className="meta" style={{ marginTop: 12 }}>Loading profile...</p> : null}
          {profile?.screening?.error ? (
            <div className="error-box">
              {profile.screening.error}
            </div>
          ) : null}
        </div>

        <div className="card">
          <h2>Recommended course</h2>
          <div className="profile-highlight">
            <div className="pill profile-pill">
              {profile?.recommendations.course.intensity ?? "ADAPTIVE"}
            </div>
            <h3 style={{ marginBottom: 8 }}>
              {profile?.recommendations.course.label ?? "Assessment-led course"}
            </h3>
            <p className="meta">
              {profile?.recommendations.course.rationale ??
                "We will select the next course once assessment evidence is available."}
            </p>
          </div>
          <div className="small-grid" style={{ marginTop: 14 }}>
            <div>
              <strong>Pace:</strong>{" "}
              {profile?.recommendations.deliveryProfile.pace ?? "STANDARD"}
            </div>
            <div>
              <strong>Scaffolding:</strong>{" "}
              {profile?.recommendations.deliveryProfile.scaffolding ?? "MEDIUM"}
            </div>
            <div>
              <strong>Confidence priority:</strong>{" "}
              {profile?.recommendations.deliveryProfile.confidencePriority ?? "MEDIUM"}
            </div>
          </div>
          {profile?.recommendations.course.yearBlend?.length ? (
            <div style={{ marginTop: 14 }}>
              <strong>Year blend:</strong>{" "}
              {profile.recommendations.course.yearBlend
                .slice(0, 3)
                .map((item) => `Year ${item.year} (${item.weight}%)`)
                .join(", ")}
            </div>
          ) : null}
          {profile?.recommendations.course.matchedCourse ? (
            <div style={{ marginTop: 10 }}>
              <strong>NewtonCentre course:</strong>{" "}
              {profile.recommendations.course.matchedCourse.title} (
              {profile.recommendations.course.matchedCourse.slug})
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ height: 20 }} />

      <div className="grid grid-2">
        <div className="card">
          <h2>Interventions</h2>
          <div className="profile-stack">
            {(profile?.recommendations.course.interventions ?? []).map((item) => (
              <div key={`${item.label}-${item.targetYear ?? "na"}`} className="profile-item">
                <div className="profile-item-head">
                  <strong>{item.label}</strong>
                  <span className="pill">{item.severity}</span>
                </div>
                <p className="meta">{item.reason}</p>
              </div>
            ))}
            {!profile?.recommendations.course.interventions?.length ? (
              <p className="meta">
                No standalone intervention is currently flagged. The course can stay blended and adaptive.
              </p>
            ) : null}
          </div>
        </div>

        <div className="card">
          <h2>Weighted modules</h2>
          <div className="profile-stack">
            {(profile?.recommendations.course.weightedModules ?? []).slice(0, 6).map((module) => (
              <div key={module.moduleId} className="profile-item">
                <div className="profile-item-head">
                  <strong>{module.title}</strong>
                  <span className="pill">{module.weight}%</span>
                </div>
                <p className="meta">
                  {module.yearGroup != null ? `Year ${module.yearGroup}. ` : ""}
                  {module.reason}
                </p>
              </div>
            ))}
            {!profile?.recommendations.course.weightedModules?.length ? (
              <p className="meta">
                Weighted NewtonCentre modules will appear here when the course catalogue integration is configured.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div style={{ height: 20 }} />

      <div className="grid grid-2">
        <div className="card">
          <h2>Maths assessment</h2>
          <div className="small-grid">
            <div>
              <strong>Working band:</strong>{" "}
              {profile?.assessment?.overallWorkingBand?.replaceAll("_", " ") ??
                state.result?.overallWorkingBand?.replaceAll("_", " ") ??
                "-"}
            </div>
            <div>
              <strong>Confidence:</strong>{" "}
              {typeof (profile?.assessment?.overallConfidence ?? state.result?.overallConfidence) ===
              "number"
                ? `${Math.round(
                    (profile?.assessment?.overallConfidence ?? state.result?.overallConfidence ?? 0) *
                      100
                  )}%`
                : "-"}
            </div>
            <div>
              <strong>Questions answered:</strong>{" "}
              {profile?.assessment?.questionCount ?? state.result?.questionCount ?? "-"}
            </div>
            <div>
              <strong>Entry year:</strong>{" "}
              {profile?.assessment?.entryYear != null
                ? `Year ${profile.assessment.entryYear}`
                : "-"}
            </div>
          </div>
        </div>

        <div className="card">
          <h2>ndscreen summary</h2>
          {profile?.screening ? (
            <div className="small-grid">
              <div>
                <strong>Status:</strong> {profile.screening.status ?? "Not linked"}
              </div>
              <div>
                <strong>Screening kind:</strong>{" "}
                {profile.screening.screeningKind ?? "-"}
              </div>
              <div>
                <strong>Question set:</strong>{" "}
                {profile.screening.questionSet?.key ?? "-"}
              </div>
              <div>
                <strong>Latest profile:</strong>{" "}
                {profile.screening.learningProfile?.primaryProfile ??
                  profile.screening.latestResult?.profileType ??
                  "-"}
              </div>
              <div>
                <strong>Confidence:</strong>{" "}
                {profile.screening.learningProfile?.confidence != null
                  ? `${Math.round(profile.screening.learningProfile.confidence * 100)}%`
                  : profile.screening.latestResult?.confidence != null
                  ? `${Math.round(profile.screening.latestResult.confidence * 100)}%`
                  : "-"}
              </div>
              <div>
                <strong>Report:</strong>{" "}
                {profile.screening.report?.status ?? "Not ready"}
              </div>
            </div>
          ) : (
            <p className="meta">
              No ndscreen session is linked yet. Add one above to bring the
              screening profile into this view.
            </p>
          )}
        </div>
      </div>

      <div style={{ height: 20 }} />

      <div className="card">
        <h2>Priority strands</h2>
        <div className="profile-stack">
          {(profile?.recommendations.strands ?? []).map((strand) => (
            <div key={strand.strand} className="profile-item">
              <div className="profile-item-head">
                <strong>
                  {strand.priority}. {strand.strand}
                </strong>
                <span className="pill">
                  {Math.round(strand.accuracy * 100)}% accuracy
                </span>
              </div>
              <p className="meta">
                {strand.reason} Secure year:{" "}
                {strand.secureYear != null ? `Year ${strand.secureYear}` : "not secure yet"}.
              </p>
            </div>
          ))}
          {!profile?.recommendations.strands.length ? (
            <p className="meta">
              Strand priorities will appear here once the assessment evidence has
              been loaded.
            </p>
          ) : null}
        </div>
      </div>

      <div style={{ height: 20 }} />

      <div className="card">
        <h2>Recommended objectives</h2>
        <div className="profile-stack">
          {(profile?.recommendations.objectives ?? []).map((objective) => (
            <div key={objective.objectiveId} className="profile-item">
              <div className="profile-item-head">
                <strong>{objective.title}</strong>
                <span className="pill">
                  {objective.yearGroup != null ? `Year ${objective.yearGroup}` : "Year n/a"}
                </span>
              </div>
              <p className="meta" style={{ marginBottom: 6 }}>
                {objective.strand}
              </p>
              <p className="meta">
                {objective.reason} Source: {objective.source.replaceAll("_", " ")}.
              </p>
              <div style={{ marginTop: 12 }}>
                <button
                  className="btn btn-primary"
                  onClick={() => navigate(`/lesson/${objective.objectiveId}`)}
                >
                  Open lesson preview
                </button>
              </div>
            </div>
          ))}
          {!profile?.recommendations.objectives.length ? (
            <p className="meta">
              Objective recommendations will appear here once the combined profile
              has been built.
            </p>
          ) : null}
        </div>
      </div>

      {profile?.screening?.learningProfile?.summary ||
      profile?.screening?.learningProfile?.recommendation ? (
        <>
          <div style={{ height: 20 }} />
          <div className="card">
            <h2>Screening-informed support notes</h2>
            <p className="meta">
              {profile.screening.learningProfile?.summary ??
                profile.screening.learningProfile?.summaryText}
            </p>
            {profile.screening.learningProfile?.recommendation ? (
              <p className="meta">
                <strong>Recommended support:</strong>{" "}
                {profile.screening.learningProfile.recommendation}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      <div style={{ height: 20 }} />

      {state.result ? (
        <ParentReport
          student={state.student}
          result={state.result}
          sessionId={state.sessionId}
        />
      ) : (
        <div className="card">
          <h2>Printable report</h2>
          <p className="meta">
            A printable report is available straight after completing an assessment in this browser session. Existing learner lookups still load the integrated profile and lesson launch actions here.
          </p>
        </div>
      )}
    </Layout>
  );
}
