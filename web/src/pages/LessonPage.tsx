import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import Layout from "../components/Layout";
import { getLessonRuntimeByObjective } from "../api/assessmentApi";
import type { LessonRuntimeResponse } from "../types/assessment";
import { loadState } from "../utils/storage";

export default function LessonPage() {
  const navigate = useNavigate();
  const { objectiveId = "" } = useParams();
  const state = loadState();
  const studentId = state.student?.studentId ?? "";
  const assessmentSessionId = state.sessionId || undefined;
  const ndscreenSessionId = state.ndscreenSessionId?.trim() || undefined;

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [runtime, setRuntime] = useState<LessonRuntimeResponse | null>(null);

  useEffect(() => {
    if (!studentId || !objectiveId) {
      navigate("/report");
      return;
    }

    async function loadRuntime() {
      setLoading(true);
      setError("");

      try {
        const next = await getLessonRuntimeByObjective({
          objectiveId,
          studentId,
          assessmentSessionId,
          ndscreenSessionId,
        });
        setRuntime(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load lesson runtime");
      } finally {
        setLoading(false);
      }
    }

    void loadRuntime();
  }, [assessmentSessionId, ndscreenSessionId, navigate, objectiveId, studentId]);

  const title = runtime?.delivery.curriculum.objective.title ?? "Lesson preview";
  const subtitle = runtime
    ? `${runtime.delivery.child.displayName} sees the same canonical maths as every learner, with a child-specific wrapper around it.`
    : "Loading lesson runtime package.";

  return (
    <Layout
      title={title}
      subtitle={subtitle}
      kicker="MyLisa Lesson Delivery"
    >
      <div className="card">
        <div className="button-row">
          <button className="btn btn-secondary" onClick={() => navigate("/report")}>
            Back to report
          </button>
        </div>
      </div>

      {error ? (
        <>
          <div style={{ height: 20 }} />
          <div className="error-box">{error}</div>
        </>
      ) : null}

      {loading ? (
        <>
          <div style={{ height: 20 }} />
          <div className="card">
            <p className="meta">Loading lesson runtime...</p>
          </div>
        </>
      ) : null}

      {runtime ? (
        <>
          <div style={{ height: 20 }} />

          <div className="grid grid-2">
            <div className="card">
              <h2>Objective</h2>
              <div className="profile-stack">
                <div className="profile-item">
                  <div className="profile-item-head">
                    <strong>{runtime.screenPayload.objective.title}</strong>
                    <span className="pill">
                      {runtime.screenPayload.objective.yearGroup != null
                        ? `Year ${runtime.screenPayload.objective.yearGroup}`
                        : runtime.screenPayload.objective.keyStage}
                    </span>
                  </div>
                  <p className="meta" style={{ marginBottom: 8 }}>
                    {runtime.screenPayload.objective.subject} · {runtime.screenPayload.objective.keyStage} · {runtime.screenPayload.objective.strand}
                  </p>
                  <p className="meta">{runtime.screenPayload.objective.statement}</p>
                </div>
              </div>
            </div>

            <div className="card">
              <h2>Child wrapper</h2>
              <div className="small-grid">
                <div>
                  <strong>Tutoring mode:</strong> {runtime.screenPayload.presentation.tutoringMode}
                </div>
                <div>
                  <strong>Verbosity:</strong> {runtime.screenPayload.presentation.verbosity}
                </div>
                <div>
                  <strong>Step size:</strong> {runtime.screenPayload.presentation.stepSize}
                </div>
                <div>
                  <strong>Scaffolding:</strong> {runtime.screenPayload.presentation.scaffolding}
                </div>
                <div>
                  <strong>Confidence priority:</strong> {runtime.screenPayload.presentation.confidencePriority}
                </div>
                <div>
                  <strong>Low stimulus:</strong> {runtime.screenPayload.presentation.lowStimulus ? "Yes" : "No"}
                </div>
              </div>
              <div style={{ marginTop: 12 }}>
                <strong>Interests:</strong>
                <p className="meta" style={{ marginTop: 6 }}>
                  {runtime.delivery.child.interests.length
                    ? runtime.delivery.child.interests.join(" | ")
                    : "No explicit interests captured yet, so the wrapper should stay neutral."}
                </p>
              </div>
            </div>
          </div>

          <div style={{ height: 20 }} />

          <div className="card">
            <h2>Lesson flow</h2>
            <div className="lesson-flow">
              {runtime.screenPayload.lessonFlow.sections.map((section) => (
                <div key={section.key} className="lesson-step">
                  <div className="lesson-step-head">
                    <strong>{section.title}</strong>
                    <span className="pill">
                      {section.canonicalQuestionIds.length} canonical
                    </span>
                  </div>
                  <p className="meta">{section.purpose}</p>
                </div>
              ))}
            </div>
          </div>

          <div style={{ height: 20 }} />

          <div className="card">
            <h2>Canonical questions</h2>
            <p className="meta" style={{ marginBottom: 14 }}>
              These stay fixed across children. The wrapper may change explanation and context, but not the maths.
            </p>
            <div className="lesson-cards">
              {runtime.screenPayload.canonicalCards.map((card) => (
                <div key={card.id} className="lesson-card">
                  <div className="lesson-card-top">
                    <span className="pill">{card.title}</span>
                    <span className="pill">{card.difficulty}</span>
                  </div>
                  <div className="lesson-question">{card.promptText}</div>
                  <p className="meta">
                    Expected answer: <strong>{card.answerText}</strong>
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div style={{ height: 20 }} />

          <div className="card">
            <h2>Oak support content</h2>
            <div className="lesson-support-groups">
              {runtime.screenPayload.supportCards.map((group) => (
                <div key={group.type} className="lesson-support-group">
                  <div className="profile-item-head">
                    <strong>{group.type.replaceAll("_", " ")}</strong>
                    <span className="pill">{group.items.length} chunks</span>
                  </div>
                  <div className="lesson-support-items">
                    {group.items.map((item) => (
                      <div key={item.id} className="lesson-support-item">
                        {item.excerpt.map((line, index) => (
                          <p key={`${item.id}-${index}`} className="meta">
                            {line}
                          </p>
                        ))}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ height: 20 }} />

          <div className="card">
            <h2>LLM guardrails</h2>
            <div className="profile-stack">
              {runtime.delivery.llmContract.guardrails.map((rule) => (
                <div key={rule} className="profile-item">
                  <p className="meta">{rule}</p>
                </div>
              ))}
            </div>
          </div>
        </>
      ) : null}
    </Layout>
  );
}
