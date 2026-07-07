import { useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import Layout from "../components/Layout";
import {
  advanceLiveLessonBlock,
  completeLiveLessonObjective,
  getLiveLesson,
  regenerateLiveLessonTeachingCards,
} from "../api/assessmentApi";
import type { LiveLessonMoodCheckIn, LiveLessonSessionResponse, NeuroTeachingCard } from "../types/assessment";

type VisualModel = NeuroTeachingCard["visualModel"];

function studentName(student: LiveLessonSessionResponse["participants"][number]["student"]) {
  return [student.firstName, student.lastName].filter(Boolean).join(" ") || student.user.email;
}

function visualModelSrc(visualModel: VisualModel) {
  if (!visualModel) return "";
  if (visualModel.kind === "svg" && visualModel.svg) {
    return `data:image/svg+xml;utf8,${encodeURIComponent(visualModel.svg)}`;
  }
  return visualModel.url ?? "";
}

function getMoodCheckIn(progressJson: LiveLessonSessionResponse["participants"][number]["progressJson"]) {
  const value =
    progressJson && typeof progressJson === "object"
      ? progressJson.moodCheckIn
      : null;
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<LiveLessonMoodCheckIn>;
  if (!raw.moodKey || !raw.moodLabel || !raw.pacingHint || !raw.checkedInAt) return null;
  return {
    ...raw,
    ...moodTutorFallback(raw.moodKey),
  } as LiveLessonMoodCheckIn;
}

function moodTutorFallback(moodKey: LiveLessonMoodCheckIn["moodKey"]) {
  switch (moodKey) {
    case "steady":
      return {
        actionLevel: "LOW_PRESSURE" as const,
        tutorVisibility: "PRIVATE_NOTE" as const,
        tutorMessage: "Gentle start selected. Keep the first questions easy and low pressure.",
      };
    case "wobbly":
      return {
        actionLevel: "MONITOR" as const,
        tutorVisibility: "PRIVATE_FLAG" as const,
        tutorMessage: "Monitor privately. The learner is unsure and may need quieter prompting or reassurance.",
      };
    case "stretched":
      return {
        actionLevel: "INTERVENE" as const,
        tutorVisibility: "PRIVATE_ALERT" as const,
        tutorMessage: "Intervention needed now. Pause the learner, reduce input, and offer a short reset before continuing.",
      };
    default:
      return {
        actionLevel: "NONE" as const,
        tutorVisibility: "NONE" as const,
        tutorMessage: "No intervention needed.",
      };
  }
}

function moodTutorClass(moodCheckIn: LiveLessonMoodCheckIn) {
  switch (moodCheckIn.actionLevel) {
    case "INTERVENE":
      return "mood-tutor-note mood-tutor-alert";
    case "MONITOR":
      return "mood-tutor-note mood-tutor-flag";
    case "LOW_PRESSURE":
      return "mood-tutor-note mood-tutor-gentle";
    default:
      return "mood-tutor-note";
  }
}

function moodTutorLabel(moodCheckIn: LiveLessonMoodCheckIn) {
  switch (moodCheckIn.actionLevel) {
    case "INTERVENE":
      return "Private alert";
    case "MONITOR":
      return "Private monitor flag";
    case "LOW_PRESSURE":
      return "Gentle start";
    default:
      return "No action";
  }
}

export default function TutorLiveLessonPage() {
  const { lessonSessionId = "" } = useParams();
  const [lesson, setLesson] = useState<LiveLessonSessionResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [copiedStudentId, setCopiedStudentId] = useState("");
  const [completingObjective, setCompletingObjective] = useState(false);
  const [regeneratingCards, setRegeneratingCards] = useState(false);

  async function refresh() {
    if (!lessonSessionId) return;
    setError("");
    try {
      const next = await getLiveLesson(lessonSessionId);
      setLesson(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load live lesson");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void refresh();
  }, [lessonSessionId]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(id);
  }, [lessonSessionId]);

  const currentBlock = useMemo(() => {
    return lesson?.flowJson.sessionBlocks.find((block) => block.key === lesson.currentBlockKey) ?? null;
  }, [lesson]);
  const currentTutorCard = useMemo(() => {
    return lesson?.tutorRuntimeJson?.neuroTeachingCards?.find(
      (card) => card.blockKey === lesson.currentBlockKey,
    ) ?? null;
  }, [lesson]);
  const lessonObjectives = lesson?.tutorRuntimeJson?.objectives?.length
    ? lesson.tutorRuntimeJson.objectives
    : lesson
      ? [{
          id: lesson.objective.id,
          code: lesson.objective.code,
          title: lesson.objective.title,
          strand: lesson.objective.strand,
          yearGroup: lesson.objective.yearGroup,
          role: "ANCHOR",
        }]
      : [];

  async function startBlock(blockKey: string) {
    if (!lessonSessionId) return;
    setError("");
    try {
      const next = await advanceLiveLessonBlock({ lessonSessionId, blockKey });
      setLesson(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to move lesson on");
    }
  }

  async function completeObjective() {
    if (!lessonSessionId || completingObjective) return;
    setError("");
    setCompletingObjective(true);
    try {
      const next = await completeLiveLessonObjective({ lessonSessionId });
      setLesson(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to complete objective");
    } finally {
      setCompletingObjective(false);
    }
  }

  async function regenerateTeachingCards() {
    if (!lessonSessionId || regeneratingCards) return;
    setError("");
    setRegeneratingCards(true);
    try {
      const next = await regenerateLiveLessonTeachingCards({ lessonSessionId });
      setLesson(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to regenerate teaching cards");
    } finally {
      setRegeneratingCards(false);
    }
  }

  async function copyStudentLink(studentId: string) {
    const url = `${window.location.origin}/student/live-lessons/${lessonSessionId}?studentId=${encodeURIComponent(studentId)}`;
    setError("");
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = url;
        textarea.setAttribute("readonly", "");
        textarea.style.position = "fixed";
        textarea.style.left = "-9999px";
        document.body.appendChild(textarea);
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopiedStudentId(studentId);
      window.setTimeout(() => setCopiedStudentId(""), 1800);
    } catch {
      setError(`Could not copy automatically. Link: ${url}`);
    }
  }

  return (
    <Layout
      title={lesson?.title ?? "Live lesson"}
      subtitle="Tutor command view for the shared 50-minute teaching flow and each student's personalised stream."
      kicker="MyLisa Tutor Live"
    >
      {error ? <div className="error-box">{error}</div> : null}
      {loading ? <div className="card"><p className="meta">Loading live lesson...</p></div> : null}

      {lesson ? (
        <>
          <div className="grid grid-2">
            <div className="card">
              <h2>Current teaching block</h2>
              {currentBlock ? (
                <div className="profile-item">
                  <div className="profile-item-head">
                    <strong>{currentBlock.title}</strong>
                    <span className="pill">{currentBlock.durationMinutes} mins</span>
                  </div>
                  <p className="meta">{currentBlock.purpose}</p>
                  <p className="meta">{currentBlock.audience === "TUTOR_SCREEN" ? "Tutor large screen" : "Student devices"} · {currentBlock.mode.replaceAll("_", " ")}</p>
                </div>
              ) : <p className="meta">No active block selected.</p>}
            </div>

            <div className="card">
              <h2>Session objectives</h2>
              <div className="profile-stack">
                {lessonObjectives.map((objective) => (
                  <div key={objective.id} className="profile-item">
                    <div className="profile-item-head">
                      <strong>{objective.title}</strong>
                      <span className="pill">{objective.role}</span>
                    </div>
                    <p className="meta">
                      {objective.strand}{objective.yearGroup ? ` · Year ${objective.yearGroup}` : ""}
                    </p>
                  </div>
                ))}
              </div>
              <p className="meta">Status: {lesson.status}</p>
              <div className="button-row" style={{ marginTop: 12 }}>
                <button
                  className="btn btn-primary"
                  disabled={completingObjective || lesson.status === "COMPLETED"}
                  onClick={() => void completeObjective()}
                >
                  {lesson.status === "COMPLETED"
                    ? "Objective completed"
                    : completingObjective
                      ? "Completing..."
                      : "Objective complete"}
                </button>
              </div>
              {lesson.endedAt ? (
                <p className="meta">
                  Closed for reporting: {new Date(lesson.endedAt).toLocaleString()}
                </p>
              ) : (
                <p className="meta">
                  Use this when the tutor is ready for the objective to appear as completed in the child report.
                </p>
              )}
            </div>
          </div>

          <div style={{ height: 20 }} />

          {currentTutorCard ? (
            <>
              <div className="card">
                {currentBlock ? (
                  <p className="meta" style={{ marginBottom: 8 }}>
                    Generated content for: <strong>{currentBlock.title}</strong>
                  </p>
                ) : null}
                <div className="profile-item-head">
                  <h2>{currentTutorCard.title}</h2>
                  <div className="button-row">
                    <button
                      className="secondary-button"
                      type="button"
                      disabled={regeneratingCards}
                      onClick={() => void regenerateTeachingCards()}
                    >
                      {regeneratingCards ? "Regenerating..." : "Regenerate teaching cards"}
                    </button>
                    <span className="pill">{currentTutorCard.source}</span>
                  </div>
                </div>
                {currentTutorCard.fallbackReason ? (
                  <p className="meta">Fallback reason: {currentTutorCard.fallbackReason}</p>
                ) : null}
                <div className="grid grid-2">
                  <div>
                    <strong>Teaching script</strong>
                    {currentTutorCard.teachingScript.map((line) => (
                      <p key={line} className="meta">{line}</p>
                    ))}
                  </div>
                  <div>
                    <strong>Key vocabulary</strong>
                    {currentTutorCard.keyVocabulary.map((item) => (
                      <p key={item.term} className="meta">
                        <strong>{item.term}:</strong> {item.childDefinition}
                      </p>
                    ))}
                  </div>
                </div>
                <div className="grid grid-2" style={{ marginTop: 14 }}>
                  <div className="lesson-support-item">
                    <strong>{currentTutorCard.workedExample.title}</strong>
                    {currentTutorCard.workedExample.steps.map((step) => (
                      <p key={step} className="meta">{step}</p>
                    ))}
                    <p className="meta"><strong>Check:</strong> {currentTutorCard.workedExample.answerCheck}</p>
                  </div>
                  <div className="lesson-support-item">
                    <strong>Guided prompts</strong>
                    {currentTutorCard.guidedPracticePrompts.map((prompt) => (
                      <p key={prompt} className="meta">{prompt}</p>
                    ))}
                    <p className="meta"><strong>Independent:</strong> {currentTutorCard.independentPrompt}</p>
                  </div>
                </div>
                {currentTutorCard.visualModel ? (
                  <div className="visual-model-panel">
                    <strong>Visual model</strong>
                    {visualModelSrc(currentTutorCard.visualModel) ? (
                      <img
                        className="visual-model-media"
                        src={visualModelSrc(currentTutorCard.visualModel)}
                        alt={currentTutorCard.visualModel.alt}
                      />
                    ) : null}
                    <p className="meta visual-model-caption">
                      {currentTutorCard.visualModel.caption || currentTutorCard.visualModelSuggestion}
                    </p>
                  </div>
                ) : (
                  <p className="meta"><strong>Visual model:</strong> {currentTutorCard.visualModelSuggestion}</p>
                )}
                <p className="meta"><strong>Check:</strong> {currentTutorCard.checkForUnderstanding}</p>
                <p className="meta"><strong>Repair:</strong> {currentTutorCard.repairPrompt}</p>
                <p className="meta"><strong>Reset:</strong> {currentTutorCard.calmResetPrompt}</p>
                <p className="meta"><strong>Stretch:</strong> {currentTutorCard.stretchPrompt}</p>
                <div className="button-row" style={{ marginTop: 10 }}>
                  {currentTutorCard.neurodiverseSupports.map((support) => (
                    <span key={support} className="pill">{support}</span>
                  ))}
                </div>
                <div className="profile-stack" style={{ marginTop: 14 }}>
                  {currentTutorCard.tutorNotes.map((note) => (
                    <div key={note} className="profile-item">
                      <p className="meta">{note}</p>
                    </div>
                  ))}
                </div>
              </div>
              <div style={{ height: 20 }} />
            </>
          ) : currentBlock?.audience === "TUTOR_SCREEN" ? (
            <>
              <div className="card">
                <h2>Generated content unavailable</h2>
                <p className="meta">
                  No neuro-teaching card was found for the active tutor block:
                  {" "}
                  <strong>{currentBlock.title}</strong>.
                </p>
                <p className="meta">
                  Launching a fresh live lesson will regenerate the tutor cards for the current lesson flow.
                </p>
              </div>
              <div style={{ height: 20 }} />
            </>
          ) : null}

          <div className="card">
            <h2>50-minute flow</h2>
            <div className="lesson-flow">
              {lesson.flowJson.sessionBlocks.map((block) => (
                <div key={block.key} className={`lesson-step ${lesson.currentBlockKey === block.key ? "profile-item-selected" : ""}`.trim()}>
                  <div className="lesson-step-head">
                    <strong>{block.title}</strong>
                    <span className="pill">{block.durationMinutes} mins</span>
                  </div>
                  <p className="meta">{block.purpose}</p>
                  {block.objectiveCodes?.length ? (
                    <p className="meta">Objectives: {block.objectiveCodes.length}</p>
                  ) : null}
                  <button className="btn btn-secondary" onClick={() => void startBlock(block.key)}>
                    Set active
                  </button>
                </div>
              ))}
            </div>
          </div>

          <div style={{ height: 20 }} />

          <div className="card">
            <h2>Student streams</h2>
            <div className="profile-stack">
              {lesson.participants.map((participant) => {
                const moodCheckIn = getMoodCheckIn(participant.progressJson);
                const rounds = participant.runtimeJson.personalisedQuestionRounds;
                const participantBlock = participant.runtimeJson.lessonFlow.sessionBlocks.find(
                  (block) => block.key === participant.currentBlockKey
                );
                const activeQuestionIds = new Set(participantBlock?.canonicalQuestionIds ?? []);
                const activeRound = participantBlock?.audience === "STUDENT_DEVICE"
                  ? rounds.find((round) =>
                      round.questions.some((question) => activeQuestionIds.has(question.id))
                    )
                  : null;
                const activeCard = participant.runtimeJson.neuroTeachingCards?.find(
                  (card) => card.blockKey === participant.currentBlockKey,
                );

                return (
                  <div key={participant.id} className="profile-item">
                    <div className="profile-item-head">
                      <strong>{studentName(participant.student)}</strong>
                      <span className="pill">{participant.status}</span>
                    </div>
                    <p className="meta">Block: {participant.currentBlockKey ?? "waiting"}</p>
                    <p className="meta">Answered {participant.questionsAnswered} · Correct {participant.questionsCorrect}</p>
                    {moodCheckIn ? (
                      <div className={moodTutorClass(moodCheckIn)}>
                        <div className="profile-item-head">
                          <strong>{moodCheckIn.moodLabel}</strong>
                          <span className="pill">{moodTutorLabel(moodCheckIn)}</span>
                        </div>
                        <span>{moodCheckIn.tutorMessage ?? moodCheckIn.pacingHint}</span>
                      </div>
                    ) : (
                      <p className="meta">Mood check-in: waiting</p>
                    )}
                    {participant.progressJson?.latestAnswer ? (
                      <p className="meta">
                        Latest: {String((participant.progressJson.latestAnswer as { answerText?: string }).answerText ?? "")} · {String((participant.progressJson.latestAnswer as { isCorrect?: boolean }).isCorrect ? "correct" : "needs support")}
                      </p>
                    ) : null}
                    <p className="meta">
                      {activeRound
                        ? `${activeRound.title}: ${activeRound.questions.length} personalised questions ready.`
                        : "Tutor-led screen or waiting for personalised question block."}
                    </p>
                    <p className="meta">
                      Vectors: {participant.runtimeJson.wrapperVectors.map((vector) => vector.title).slice(0, 3).join(" | ") || "assessment and ndscreen signals only"}
                    </p>
                    {activeCard ? (
                      <p className="meta">
                        Wrapper: {activeCard.title} · {activeCard.sensoryLoad} load · {activeCard.neurodiverseSupports.slice(0, 3).join(", ")}
                      </p>
                    ) : null}
                    <div className="button-row" style={{ marginTop: 10 }}>
                      <button
                        className="btn btn-secondary"
                        onClick={() => void copyStudentLink(participant.student.id)}
                      >
                        {copiedStudentId === participant.student.id ? "Copied" : "Copy student link"}
                      </button>
                      <button
                        className="btn btn-secondary"
                        onClick={() =>
                          window.open(
                            `/student/live-lessons/${lessonSessionId}?studentId=${encodeURIComponent(participant.student.id)}`,
                            "_blank",
                            "noopener,noreferrer",
                          )
                        }
                      >
                        Open student view
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </>
      ) : null}
    </Layout>
  );
}
