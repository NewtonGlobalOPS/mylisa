import { useEffect, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import { getLessonRuntimeByObjective } from "../api/assessmentApi";
import type { LessonRuntimeResponse } from "../types/assessment";
import { loadState } from "../utils/storage";
import { formatOakText, getOakQuestionImage, getSingleChoiceOptions } from "../utils/oakQuestion";

export default function LessonPage() {
  const navigate = useNavigate();
  const { objectiveId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const state = loadState();
  const studentId = state.student?.studentId ?? "";
  const assessmentSessionId = state.sessionId || undefined;
  const ndscreenSessionId = state.ndscreenSessionId?.trim() || undefined;
  const selectedChunkIdsParam = searchParams.get("selectedChunkIds")?.trim() ?? "";

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
          selectedChunkIds: selectedChunkIdsParam
            ? selectedChunkIdsParam
                .split(",")
                .map((item) => item.trim())
                .filter(Boolean)
            : undefined,
        });
        setRuntime(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load lesson runtime");
      } finally {
        setLoading(false);
      }
    }

    void loadRuntime();
  }, [
    assessmentSessionId,
    ndscreenSessionId,
    navigate,
    objectiveId,
    selectedChunkIdsParam,
    studentId,
  ]);

  const title = runtime?.delivery.curriculum.objective.title ?? "Lesson preview";
  const subtitle = runtime
    ? `${runtime.delivery.child.displayName} sees the same canonical maths as every learner, with a child-specific wrapper around it and a 50-minute blended lesson structure.`
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
          <button
            className="btn btn-secondary"
            onClick={() =>
              navigate(
                `/lesson-builder?objectiveId=${encodeURIComponent(objectiveId)}`
              )
            }
          >
            Open builder
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
            <h2>50-minute lesson flow</h2>
            <div className="lesson-flow">
              {runtime.screenPayload.lessonFlow.sessionBlocks.map((section) => (
                <div key={section.key} className="lesson-step">
                  <div className="lesson-step-head">
                    <strong>{section.title}</strong>
                    <span className="pill">
                      {section.durationMinutes} mins
                    </span>
                  </div>
                  <p className="meta">{section.purpose}</p>
                  <p className="meta">
                    {section.audience === "TUTOR_SCREEN" ? "Tutor large screen" : "Student personalised session"} · {section.mode.replaceAll("_", " ")}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div style={{ height: 20 }} />

          <div className="grid grid-2">
            <div className="card">
              <h2>Wrapper vectors in play</h2>
              <div className="profile-stack">
                {runtime.screenPayload.wrapperVectors.map((vector) => (
                  <div key={vector.id} className="profile-item">
                    <div className="profile-item-head">
                      <strong>{vector.title}</strong>
                      <span className="pill">{vector.scope}</span>
                    </div>
                    <p className="meta">{vector.content}</p>
                  </div>
                ))}
                {!runtime.screenPayload.wrapperVectors.length ? (
                  <p className="meta">
                    No wrapper vectors are active, so the lesson relies on ndscreen and assessment signals only.
                  </p>
                ) : null}
              </div>
            </div>

            <div className="card">
              <h2>Personalised question rounds</h2>
              <div className="profile-stack">
                {runtime.screenPayload.personalisedQuestionRounds.map((round) => (
                  <div key={round.key} className="profile-item">
                    <div className="profile-item-head">
                      <strong>{round.title}</strong>
                      <span className="pill">{round.durationMinutes} mins</span>
                    </div>
                    <p className="meta">
                      {round.purpose} {round.questions.length} questions selected.
                    </p>
                  </div>
                ))}
              </div>
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
                  <div className="lesson-question">{formatOakText(card.promptText)}</div>
                  {getOakQuestionImage(card) ? (
                    <figure className="question-stimulus question-stimulus-live">
                      <img
                        src={getOakQuestionImage(card)!.url}
                        width={getOakQuestionImage(card)!.width}
                        height={getOakQuestionImage(card)!.height}
                        alt={getOakQuestionImage(card)!.alt}
                        loading="eager"
                      />
                    </figure>
                  ) : null}
                  <p className="meta">
                    Expected answer: <strong>{card.answerText}</strong>
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div style={{ height: 20 }} />

          <div className="card">
            <h2>Vectored student questions</h2>
            <div className="profile-stack">
              {runtime.screenPayload.personalisedQuestionRounds.map((round) => (
                <div key={round.key} className="profile-item">
                  <div className="profile-item-head">
                    <strong>{round.title}</strong>
                    <span className="pill">{round.questions.length} questions</span>
                  </div>
                  <p className="meta" style={{ marginBottom: 10 }}>{round.purpose}</p>
                  <div className="lesson-cards">
                    {round.questions.map((question) => (
                      <div key={question.id} className="lesson-card">
                        <div className="lesson-card-top">
                          <span className="pill">{question.objectiveCode}</span>
                          <span className="pill">{question.difficulty}</span>
                        </div>
                        <div className="lesson-question">{formatOakText(question.promptText)}</div>
                        {getOakQuestionImage(question) ? (
                          <figure className="question-stimulus question-stimulus-live">
                            <img
                              src={getOakQuestionImage(question)!.url}
                              width={getOakQuestionImage(question)!.width}
                              height={getOakQuestionImage(question)!.height}
                              alt={getOakQuestionImage(question)!.alt}
                              loading="eager"
                            />
                          </figure>
                        ) : null}
                        {getSingleChoiceOptions(question).length ? (
                          <div className="answer-choice-grid" style={{ marginBottom: 12 }}>
                            {getSingleChoiceOptions(question).map((choice) => (
                              <span key={choice} className="pill">{choice}</span>
                            ))}
                          </div>
                        ) : null}
                        <p className="meta">
                          {question.strand}
                          {question.yearGroup != null ? ` · Year ${question.yearGroup}` : ""}
                        </p>
                        <p className="meta">{question.rationale}</p>
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div style={{ height: 20 }} />

          <div className="card">
            <h2>Oak support content</h2>
            <p className="meta" style={{ marginBottom: 14 }}>
              {runtime.screenPayload.supportSelection.isCustomSelection
                ? "This preview is using a tutor-custom chunk selection from the lesson builder."
                : "This preview is using the automatic chunk selection produced by the lesson builder."}
            </p>
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
                        <p className="meta">
                          {item.objectiveCode ?? "Shared support"}
                          {item.yearGroup != null ? ` · Year ${item.yearGroup}` : ""}
                          {item.strand ? ` · ${item.strand}` : ""}
                        </p>
                        {item.excerpt.map((line, index) => (
                          <p key={`${item.id}-${index}`} className="meta">
                            {line}
                          </p>
                        ))}
                        <p className="meta">{item.matchReason}</p>
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
