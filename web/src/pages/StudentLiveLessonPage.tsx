import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import { getStudentLiveLesson, submitLiveLessonAnswer, submitLiveLessonMood } from "../api/assessmentApi";
import type { LiveLessonMoodCheckIn, StudentLiveLessonResponse } from "../types/assessment";
import { getAuthToken, loadState } from "../utils/storage";
import {
  formatOakText,
  getOakAnswerOptions,
  getOakQuestionImage,
  getSingleChoiceOptions,
  isSingleChoiceQuestion,
} from "../utils/oakQuestion";
import type { OakAnswerOption } from "../utils/oakQuestion";

type PersonalisedQuestion =
  StudentLiveLessonResponse["runtimeJson"]["personalisedQuestionRounds"][number]["questions"][number];

type MultiBlankSlot = {
  slotIndex: number;
  correctAnswer?: string;
  choices: string[];
};

type MatchPair = {
  left: string;
  right: string;
};

type OrderedSequence = {
  options: string[];
  orderedAnswers: string[];
};

type QuestionFeedback = {
  isCorrect: boolean;
  correctAnswer: string;
};

const MAX_HINT_QUESTIONS = 3;

const moodOptions: Array<{
  moodKey: LiveLessonMoodCheckIn["moodKey"];
  moodLabel: string;
  pacingHint: string;
  tone: string;
}> = [
  {
    moodKey: "ready",
    moodLabel: "Ready to go",
    pacingHint: "No action needed. Continue with the planned lesson flow.",
    tone: "No intervention",
  },
  {
    moodKey: "steady",
    moodLabel: "Need a gentle start",
    pacingHint: "Keep questions low pressure and easy while you warm up.",
    tone: "Easy start",
  },
  {
    moodKey: "wobbly",
    moodLabel: "Feeling unsure",
    pacingHint: "Your tutor will be quietly told to keep an eye on you.",
    tone: "Tutor aware",
  },
  {
    moodKey: "stretched",
    moodLabel: "Brain feels busy",
    pacingHint: "Pause here. Your tutor will be alerted to step in.",
    tone: "Pause",
  },
];

function getCanonicalTruth(question: PersonalisedQuestion) {
  const contentJson = question.contentJson;
  if (!contentJson || typeof contentJson !== "object") return null;
  const truth = contentJson.canonicalTruth;
  return truth && typeof truth === "object" ? truth as Record<string, unknown> : null;
}

function labelFromOakContent(value: unknown) {
  if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    return String(raw.text ?? raw.label ?? raw.alt ?? raw.url ?? JSON.stringify(value)).trim();
  }

  return String(value ?? "").trim();
}

function getMatchPairs(question: PersonalisedQuestion): MatchPair[] {
  const truth = getCanonicalTruth(question);
  if (truth?.answerContract !== "match_pairs") return [];

  const truthPairs = Array.isArray(truth.matchPairs) ? truth.matchPairs : [];
  const parsedTruthPairs = truthPairs
    .map((pair) => {
      if (!pair || typeof pair !== "object") return null;
      const raw = pair as Record<string, unknown>;
      const left = String(raw.left ?? "").trim();
      const right = String(raw.right ?? "").trim();
      return left && right ? { left, right } : null;
    })
    .filter((pair): pair is MatchPair => pair !== null);
  if (parsedTruthPairs.length) return parsedTruthPairs;

  const rawAnswers =
    question.contentJson?.oak &&
    typeof question.contentJson.oak === "object" &&
    Array.isArray((question.contentJson.oak as { rawAnswers?: unknown }).rawAnswers)
      ? (question.contentJson.oak as { rawAnswers: unknown[] }).rawAnswers
      : [];

  return rawAnswers
    .map((answer) => {
      if (!answer || typeof answer !== "object") return null;
      const raw = answer as Record<string, unknown>;
      const matchOption =
        raw.matchOption && typeof raw.matchOption === "object"
          ? raw.matchOption as Record<string, unknown>
          : null;
      const correctChoice =
        raw.correctChoice && typeof raw.correctChoice === "object"
          ? raw.correctChoice as Record<string, unknown>
          : null;
      const left = labelFromOakContent(matchOption?.content);
      const right = labelFromOakContent(correctChoice?.content);
      return left && right ? { left, right } : null;
    })
    .filter((pair): pair is MatchPair => pair !== null);
}

function getMatchChoices(pairs: MatchPair[]) {
  return Array.from(new Set(pairs.map((pair) => pair.right).filter(Boolean)));
}

function getMultiBlankSlots(question: PersonalisedQuestion): MultiBlankSlot[] {
  const truth = getCanonicalTruth(question);
  if (truth?.answerContract !== "multi_blank_choice") return [];
  const slots = Array.isArray(truth.slots) ? truth.slots : [];
  const parsed: MultiBlankSlot[] = [];

  slots.forEach((slot, index) => {
    if (!slot || typeof slot !== "object") return;
    const raw = slot as Record<string, unknown>;
    const choices = Array.isArray(raw.choices)
      ? raw.choices.map((choice) => String(choice)).filter(Boolean)
      : [];
    if (!choices.length) return;
    parsed.push({
      slotIndex:
        typeof raw.slotIndex === "number" && Number.isFinite(raw.slotIndex)
          ? raw.slotIndex
          : index + 1,
      correctAnswer:
        typeof raw.correctAnswer === "string" ? raw.correctAnswer : undefined,
      choices,
    });
  });

  return parsed;
}

function getOrderedSequence(question: PersonalisedQuestion): OrderedSequence | null {
  const truth = getCanonicalTruth(question);
  if (truth?.answerContract !== "ordered_sequence") return null;

  const options = Array.isArray(truth.optionBank)
    ? truth.optionBank.map((item) => String(item).trim()).filter(Boolean)
    : [];
  const orderedAnswers = Array.isArray(truth.orderedAnswers)
    ? truth.orderedAnswers.map((item) => String(item).trim()).filter(Boolean)
    : Array.isArray(truth.immutableAnswers)
      ? truth.immutableAnswers.map((item) => String(item).trim()).filter(Boolean)
      : [];

  const displayOptions = options.length ? options : orderedAnswers;
  if (displayOptions.length < 2) return null;
  return {
    options: Array.from(new Set(displayOptions)),
    orderedAnswers,
  };
}

function questionTaskShape(question: PersonalisedQuestion) {
  if (getOrderedSequence(question)) return "ordered_sequence";
  if (getMatchPairs(question).length) return "match_pairs";
  if (isOakMultiSelectQuestion(question)) return "multi_select";
  if (getMultiBlankSlots(question).length) return "multi_blank_choice";
  if (isSingleChoiceQuestion(question)) return "single_choice";
  return "short_answer";
}

function declusterQuestions(questions: PersonalisedQuestion[]) {
  const remaining = [...questions];
  const ordered: PersonalisedQuestion[] = [];
  let previousShape = "";

  while (remaining.length) {
    const nextIndex = remaining.findIndex((question) => questionTaskShape(question) !== previousShape);
    const index = nextIndex >= 0 ? nextIndex : 0;
    const [next] = remaining.splice(index, 1);
    ordered.push(next);
    previousShape = questionTaskShape(next);
  }

  return ordered;
}

function slotAnswerKey(questionId: string, slotIndex: number) {
  return `${questionId}:slot:${slotIndex}`;
}

function matchAnswerKey(questionId: string, left: string) {
  return `${questionId}:match:${left}`;
}

function orderAnswerKey(questionId: string) {
  return `${questionId}:order`;
}

function getOrderedAnswer(questionId: string, answers: Record<string, string>) {
  try {
    const parsed = JSON.parse(answers[orderAnswerKey(questionId)] ?? "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function addOrderedAnswer(
  questionId: string,
  choice: string,
  setAnswers: Dispatch<SetStateAction<Record<string, string>>>,
) {
  setAnswers((current) => {
    const ordered = getOrderedAnswer(questionId, current);
    if (ordered.includes(choice)) return current;
    return {
      ...current,
      [orderAnswerKey(questionId)]: JSON.stringify([...ordered, choice]),
    };
  });
}

function moveOrderedAnswer(
  questionId: string,
  choice: string,
  direction: -1 | 1,
  setAnswers: Dispatch<SetStateAction<Record<string, string>>>,
) {
  setAnswers((current) => {
    const ordered = getOrderedAnswer(questionId, current);
    const index = ordered.indexOf(choice);
    const nextIndex = index + direction;
    if (index < 0 || nextIndex < 0 || nextIndex >= ordered.length) return current;
    const next = [...ordered];
    [next[index], next[nextIndex]] = [next[nextIndex], next[index]];
    return {
      ...current,
      [orderAnswerKey(questionId)]: JSON.stringify(next),
    };
  });
}

function removeOrderedAnswer(
  questionId: string,
  choice: string,
  setAnswers: Dispatch<SetStateAction<Record<string, string>>>,
) {
  setAnswers((current) => ({
    ...current,
    [orderAnswerKey(questionId)]: JSON.stringify(
      getOrderedAnswer(questionId, current).filter((item) => item !== choice),
    ),
  }));
}

function buildAnswerText(question: PersonalisedQuestion, answers: Record<string, string>) {
  const orderedSequence = getOrderedSequence(question);
  if (orderedSequence) {
    return JSON.stringify({
      answerContract: "ordered_sequence",
      orderedAnswers: getOrderedAnswer(question.id, answers),
    });
  }

  const matchPairs = getMatchPairs(question);
  if (matchPairs.length) {
    return JSON.stringify({
      answerContract: "match_pairs",
      pairs: matchPairs.map((pair) => ({
        left: pair.left,
        right: answers[matchAnswerKey(question.id, pair.left)] ?? "",
      })),
    });
  }

  if (isOakMultiSelectQuestion(question)) {
    const selected = getMultiSelectAnswers(question.id, answers);
    return JSON.stringify({
      answerContract: "multi_blank_choice",
      slots: selected,
    });
  }

  const slots = getMultiBlankSlots(question);
  if (!slots.length) return answers[question.id]?.trim() ?? "";
  return JSON.stringify({
    answerContract: "multi_blank_choice",
    slots: slots.map((slot) => answers[slotAnswerKey(question.id, slot.slotIndex)] ?? ""),
  });
}

function hasAnswer(question: PersonalisedQuestion, answers: Record<string, string>) {
  const orderedSequence = getOrderedSequence(question);
  if (orderedSequence) {
    return getOrderedAnswer(question.id, answers).length === orderedSequence.options.length;
  }

  const matchPairs = getMatchPairs(question);
  if (matchPairs.length) {
    return matchPairs.every((pair) => Boolean(answers[matchAnswerKey(question.id, pair.left)]));
  }

  if (isOakMultiSelectQuestion(question)) {
    const truth = getCanonicalTruth(question);
    const requiredAnswerCount =
      typeof truth?.requiredAnswerCount === "number" ? truth.requiredAnswerCount : 1;
    return getMultiSelectAnswers(question.id, answers).length >= requiredAnswerCount;
  }

  const slots = getMultiBlankSlots(question);
  if (!slots.length) return Boolean(answers[question.id]?.trim());
  return slots.every((slot) => Boolean(answers[slotAnswerKey(question.id, slot.slotIndex)]?.trim()));
}

function isOakMultiSelectQuestion(question: PersonalisedQuestion) {
  const truth = getCanonicalTruth(question);
  return (
    truth?.answerContract === "multi_blank_choice" &&
    getOakAnswerOptions(question).length > 0
  );
}

function multiSelectAnswerKey(questionId: string) {
  return `${questionId}:multi`;
}

function getMultiSelectAnswers(questionId: string, answers: Record<string, string>) {
  try {
    const parsed = JSON.parse(answers[multiSelectAnswerKey(questionId)] ?? "[]");
    return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
  } catch {
    return [];
  }
}

function toggleMultiSelectAnswer(
  questionId: string,
  choice: string,
  setAnswers: Dispatch<SetStateAction<Record<string, string>>>,
) {
  setAnswers((current) => {
    const selected = getMultiSelectAnswers(questionId, current);
    const next = selected.includes(choice)
      ? selected.filter((item) => item !== choice)
      : [...selected, choice];
    return {
      ...current,
      [multiSelectAnswerKey(questionId)]: JSON.stringify(next),
    };
  });
}

function buildQuestionHint(question: PersonalisedQuestion) {
  const prompt = formatOakText(question.promptText);
  const lower = prompt.toLowerCase();
  if (getMatchPairs(question).length) {
    return "Use only the two columns in this question. Match one left item to the right item that says the same thing.";
  }
  if (isOakMultiSelectQuestion(question)) {
    return "Check each option against the exact wording in this question. Choose only the options that fit.";
  }
  if (lower.includes("constant additive") || lower.includes("term-to-term") || lower.includes("sequence")) {
    return "Compare each term with the next one. For an additive sequence, the step should stay the same.";
  }
  if (lower.includes("position-to-term")) {
    return "Use the position number from this question first, then apply the rule carefully.";
  }
  return "Read this question once, mark what it asks for, then do the first calculation step only.";
}

function buildQuestionWorkedExample(question: PersonalisedQuestion, correctAnswer: string) {
  const prompt = formatOakText(question.promptText);
  const answer = formatOakText(correctAnswer);
  const lower = prompt.toLowerCase();

  if (lower.includes("constant additive") || lower.includes("term-to-term") || lower.includes("sequence")) {
    return {
      title: "Worked example for this question",
      steps: [
        `Question: ${prompt}`,
        "Check the gap from one term to the next.",
        "A constant additive pattern keeps the same gap each time.",
        `The correct answer is ${answer}.`,
      ],
      helper: "Now try again by checking the gaps before you submit.",
    };
  }

  return {
    title: "Worked example for this question",
    steps: [
      `Question: ${prompt}`,
      "Use only the information shown in this question.",
      `The correct answer is ${answer}.`,
      "Check why that answer matches the wording, then try again.",
    ],
    helper: "Use the same check on your next attempt.",
  };
}

function getMoodCheckIn(progressJson: StudentLiveLessonResponse["progressJson"]) {
  const value =
    progressJson && typeof progressJson === "object"
      ? progressJson.moodCheckIn
      : null;
  if (!value || typeof value !== "object") return null;
  const raw = value as Partial<LiveLessonMoodCheckIn>;
  if (!raw.moodKey || !raw.moodLabel || !raw.pacingHint || !raw.checkedInAt) return null;
  return {
    ...raw,
    ...moodActionFallback(raw.moodKey),
  } as LiveLessonMoodCheckIn;
}

function moodActionFallback(moodKey: LiveLessonMoodCheckIn["moodKey"]) {
  switch (moodKey) {
    case "steady":
      return { actionLevel: "LOW_PRESSURE" as const, studentAction: "EASY_START" as const };
    case "wobbly":
      return { actionLevel: "MONITOR" as const, studentAction: "CONTINUE_WITH_SUPPORT" as const };
    case "stretched":
      return { actionLevel: "INTERVENE" as const, studentAction: "PAUSE" as const };
    default:
      return { actionLevel: "NONE" as const, studentAction: "CONTINUE" as const };
  }
}

export default function StudentLiveLessonPage() {
  const { lessonSessionId = "" } = useParams();
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const studentId = searchParams.get("studentId") ?? loadState().student?.studentId ?? "";
  const [lesson, setLesson] = useState<StudentLiveLessonResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [answers, setAnswers] = useState<Record<string, string>>({});
  const [feedback, setFeedback] = useState<Record<string, QuestionFeedback>>({});
  const [hintedQuestionIds, setHintedQuestionIds] = useState<string[]>([]);
  const [hintTextByQuestionId, setHintTextByQuestionId] = useState<Record<string, string>>({});
  const [submittingQuestionId, setSubmittingQuestionId] = useState("");
  const [submittingMoodKey, setSubmittingMoodKey] = useState("");

  async function refresh() {
    if (!lessonSessionId || !studentId) return;
    try {
      const next = await getStudentLiveLesson({ lessonSessionId, studentId });
      setLesson(next);
    } catch {
      // Keep the current screen stable during a polling miss.
    }
  }

  useEffect(() => {
    async function load() {
      if (!lessonSessionId || !studentId) {
        if (!getAuthToken()) {
          const returnTo = `${window.location.pathname}${window.location.search}`;
          navigate(`/login?redirect=${encodeURIComponent(returnTo)}`, { replace: true });
          return;
        }
        setError("No student lesson found on this device.");
        setLoading(false);
        return;
      }

      try {
        const next = await getStudentLiveLesson({ lessonSessionId, studentId });
        setLesson(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load your lesson");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [lessonSessionId, navigate, studentId]);

  useEffect(() => {
    const id = window.setInterval(() => void refresh(), 3000);
    return () => window.clearInterval(id);
  }, [lessonSessionId, studentId]);



  async function submitAnswer(questionId: string) {
    const question = activeRound?.questions.find((item) => item.id === questionId);
    if (!question) return;
    const answerText = buildAnswerText(question, answers);
    if (!answerText || !lessonSessionId || !studentId) return;

    setSubmittingQuestionId(questionId);
    setError("");
    try {
      const result = await submitLiveLessonAnswer({
        lessonSessionId,
        studentId,
        questionId,
        answerText,
      });
      setFeedback((current) => ({
        ...current,
        [questionId]: {
          isCorrect: result.isCorrect,
          correctAnswer: result.correctAnswer,
        },
      }));
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit answer");
    } finally {
      setSubmittingQuestionId("");
    }
  }

  function useHint(question: PersonalisedQuestion) {
    const alreadyUsed = hintedQuestionIds.includes(question.id);
    if (!alreadyUsed && hintedQuestionIds.length >= MAX_HINT_QUESTIONS) {
      window.alert("You have 0 of 3 hints remaining.");
      return;
    }

    const nextHintedQuestionIds = alreadyUsed
      ? hintedQuestionIds
      : [...hintedQuestionIds, question.id];
    const remaining = MAX_HINT_QUESTIONS - nextHintedQuestionIds.length;

    setHintedQuestionIds(nextHintedQuestionIds);
    setHintTextByQuestionId((current) => ({
      ...current,
      [question.id]: current[question.id] ?? buildQuestionHint(question),
    }));

    window.alert(`You have ${remaining} of 3 hints remaining.`);
  }

  async function submitMood(option: (typeof moodOptions)[number]) {
    if (!lessonSessionId || !studentId) return;

    setSubmittingMoodKey(option.moodKey);
    setError("");
    try {
      await submitLiveLessonMood({
        lessonSessionId,
        studentId,
        moodKey: option.moodKey,
        moodLabel: option.moodLabel,
        pacingHint: option.pacingHint,
      });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit mood check-in");
    } finally {
      setSubmittingMoodKey("");
    }
  }

  const activeRound = useMemo(() => {
    if (!lesson) return null;
    const moodCheckIn = getMoodCheckIn(lesson.progressJson ?? null);
    if (moodCheckIn?.studentAction === "PAUSE" || moodCheckIn?.actionLevel === "INTERVENE") return null;
    const activeBlock = lesson.runtimeJson.lessonFlow.sessionBlocks.find(
      (block) => block.key === lesson.currentBlockKey
    );
    if (activeBlock?.audience !== "STUDENT_DEVICE") return null;
    const activeQuestionIds = new Set(activeBlock.canonicalQuestionIds ?? []);
    const round = lesson.runtimeJson.personalisedQuestionRounds.find((item) =>
      item.questions.some((question) => activeQuestionIds.has(question.id))
    ) ?? null;

    if (!round) return null;
    const activeQuestions = declusterQuestions(
      round.questions.filter((question) => activeQuestionIds.has(question.id)),
    );
    if (moodCheckIn?.studentAction !== "EASY_START" && moodCheckIn?.actionLevel !== "LOW_PRESSURE") {
      return {
        ...round,
        questions: activeQuestions,
      };
    }

    const easyQuestions = activeQuestions.filter((question) => question.difficulty === "EASY");
    const mediumQuestions = activeQuestions.filter((question) => question.difficulty === "MEDIUM");
    const lowPressureQuestions = (easyQuestions.length ? easyQuestions : mediumQuestions).slice(0, 3);

    return {
      ...round,
      title: "Gentle start",
      purpose: "Low-pressure practice while you settle into the lesson.",
      questions: lowPressureQuestions.length ? lowPressureQuestions : activeQuestions.slice(0, 3),
    };
  }, [lesson]);
  const activeTeachingCard = useMemo(() => {
    if (!lesson) return null;
    const moodCheckIn = getMoodCheckIn(lesson.progressJson ?? null);
    if (moodCheckIn?.studentAction === "PAUSE" || moodCheckIn?.actionLevel === "INTERVENE") return null;
    const activeBlock = lesson.runtimeJson.lessonFlow.sessionBlocks.find(
      (block) => block.key === lesson.currentBlockKey
    );
    if (activeBlock?.audience !== "STUDENT_DEVICE") return null;
    return lesson.runtimeJson.neuroTeachingCards?.find(
      (card) => card.blockKey === lesson.currentBlockKey && card.audience === "STUDENT",
    ) ?? null;
  }, [lesson]);
  const moodCheckIn = getMoodCheckIn(lesson?.progressJson ?? null);
  const isPausedForTutor = moodCheckIn?.studentAction === "PAUSE" || moodCheckIn?.actionLevel === "INTERVENE";
  const hintsRemaining = MAX_HINT_QUESTIONS - hintedQuestionIds.length;

  return (
    <Layout
      title={lesson?.lessonSession.title ?? "Your lesson"}
      subtitle="Your screen changes when the tutor moves the live lesson into a personalised question round."
      kicker="MyLisa Student Live"
    >
      {error ? <div className="error-box">{error}</div> : null}
      {loading ? <div className="card"><p className="meta">Loading your personalised lesson...</p></div> : null}

      {lesson ? (
        <>
          <div className="card">
            <div className="profile-item-head">
              <strong>{lesson.runtimeJson.child.displayName}</strong>
              <span className="pill">{lesson.lessonSession.status}</span>
            </div>
            <p className="meta">
              {activeRound
                ? "A question is ready for you."
                : "Wait here. Your tutor will move the lesson on when it is time."}
            </p>
          </div>

          <div style={{ height: 20 }} />

          {!moodCheckIn ? (
            <>
              <div className="card mood-card">
                <div className="profile-item-head">
                  <div>
                    <p className="kicker">Mood check-in</p>
                    <h2>How should we pace today?</h2>
                  </div>
                  <span className="pill">Before we begin</span>
                </div>
                <div className="mood-grid">
                  {moodOptions.map((option) => (
                    <button
                      key={option.moodKey}
                      type="button"
                      className="mood-option"
                      disabled={Boolean(submittingMoodKey)}
                      onClick={() => void submitMood(option)}
                    >
                      <span className="mood-option-tone">{option.tone}</span>
                      <strong>{option.moodLabel}</strong>
                      <span>{option.pacingHint}</span>
                      {submittingMoodKey === option.moodKey ? <span className="pill">Saving...</span> : null}
                    </button>
                  ))}
                </div>
              </div>
              <div style={{ height: 20 }} />
            </>
          ) : (
            <>
              <div className="mood-confirmation">
                <strong>{moodCheckIn.moodLabel}</strong>
                <span>{moodCheckIn.pacingHint}</span>
              </div>
              <div style={{ height: 20 }} />
            </>
          )}

          {isPausedForTutor ? (
            <>
              <div className="card mood-pause-card">
                <div className="profile-item-head">
                  <h2>Pause here</h2>
                  <span className="pill">Tutor alerted</span>
                </div>
                <p className="meta">Take a short reset. Your tutor has been told privately and will help you restart.</p>
              </div>
              <div style={{ height: 20 }} />
            </>
          ) : null}

          {activeTeachingCard && !activeRound ? (
            <>
              <div className="card">
                <div className="profile-item-head">
                  <h2>{activeTeachingCard.title}</h2>
                  <span className="pill">{activeTeachingCard.sensoryLoad} load</span>
                </div>
                {activeTeachingCard.fallbackReason ? (
                  <p className="meta">Generated fallback: {activeTeachingCard.fallbackReason}</p>
                ) : null}
                <p className="meta">{activeTeachingCard.studentFacingSummary}</p>
                {activeTeachingCard.teachingScript.map((line) => (
                  <p key={line} className="meta">{line}</p>
                ))}
                <div className="small-grid" style={{ marginTop: 12 }}>
                  {activeTeachingCard.microSteps.map((step) => (
                    <div key={step}>{step}</div>
                  ))}
                </div>
                <div className="grid grid-2" style={{ marginTop: 14 }}>
                  <div className="lesson-support-item">
                    <strong>Words we need</strong>
                    {activeTeachingCard.keyVocabulary.map((item) => (
                      <p key={item.term} className="meta">
                        <strong>{item.term}:</strong> {item.childDefinition}
                      </p>
                    ))}
                  </div>
                  <div className="lesson-support-item">
                    <strong>{activeTeachingCard.workedExample.title}</strong>
                    {activeTeachingCard.workedExample.steps.map((step) => (
                      <p key={step} className="meta">{step}</p>
                    ))}
                  </div>
                </div>
                <p className="meta"><strong>If stuck:</strong> {activeTeachingCard.calmResetPrompt}</p>
              </div>
              <div style={{ height: 20 }} />
            </>
          ) : null}

          {activeRound?.questions.length ? (
            <div className="card">
              <h2>{activeRound.title === "Gentle start" ? activeRound.title : "Your question"}</h2>
              <p className="meta" style={{ marginBottom: 14 }}>
                Hints: {hintsRemaining} of {MAX_HINT_QUESTIONS} remaining.
              </p>
              <div className="lesson-cards">
                {activeRound.questions.map((question) => {
                  const multiBlankSlots = getMultiBlankSlots(question);
                  const image = getOakQuestionImage(question);
                  const singleChoiceOptions = getSingleChoiceOptions(question);
                  const oakAnswerOptions = getOakAnswerOptions(question);
                  const isSingleChoice = isSingleChoiceQuestion(question);
                  const isMultiSelect = isOakMultiSelectQuestion(question);
                  const matchPairs = getMatchPairs(question);
                  const matchChoices = getMatchChoices(matchPairs);
                  const orderedSequence = getOrderedSequence(question);
                  const orderedAnswer = getOrderedAnswer(question.id, answers);
                  const singleChoiceAnswerOptions: OakAnswerOption[] = oakAnswerOptions.length
                    ? oakAnswerOptions
                    : singleChoiceOptions.map((label) => ({ label }));
                  const questionFeedback = feedback[question.id];
                  const wrongAnswer = questionFeedback && !questionFeedback.isCorrect;
                  const workedExample = wrongAnswer
                    ? buildQuestionWorkedExample(question, questionFeedback.correctAnswer)
                    : null;
                  const hintText = hintTextByQuestionId[question.id];
                  const hintAlreadyUsed = hintedQuestionIds.includes(question.id);
                  return (
                    <div key={question.id} className="lesson-card">
                      <div className="lesson-card-top">
                        <span className="pill">Question</span>
                        <button
                          type="button"
                          className="btn btn-secondary"
                          disabled={hintsRemaining <= 0 && !hintAlreadyUsed}
                          onClick={() => useHint(question)}
                        >
                          Hint
                        </button>
                      </div>
                      <div className="lesson-question">{formatOakText(question.promptText)}</div>
                      {hintText ? (
                        <div className="question-helper">
                          <strong>Hint</strong>
                          <p>{hintText}</p>
                        </div>
                      ) : null}
                      {image ? (
                        <figure className="question-stimulus question-stimulus-live">
                          <img
                            src={image.url}
                            width={image.width}
                            height={image.height}
                            alt={image.alt}
                            loading="eager"
                          />
                        </figure>
                      ) : null}
                      {workedExample ? (
                        <div className="question-helper question-helper-repair">
                          <strong>{workedExample.title}</strong>
                          {workedExample.steps.map((step) => (
                            <p key={step}>{step}</p>
                          ))}
                          <p><strong>Try again:</strong> {workedExample.helper}</p>
                        </div>
                      ) : null}
                      {orderedSequence ? (
                        <div className="order-answer" aria-label="Order the answers">
                          <div className="order-bank" aria-label="Numbers to order">
                            {orderedSequence.options.map((choice) => {
                              const selected = orderedAnswer.includes(choice);
                              return (
                                <button
                                  key={choice}
                                  type="button"
                                  className={selected ? "btn btn-primary" : "btn btn-secondary"}
                                  disabled={selected || submittingQuestionId === question.id}
                                  onClick={() => addOrderedAnswer(question.id, choice, setAnswers)}
                                >
                                  {formatOakText(choice)}
                                </button>
                              );
                            })}
                          </div>
                          <div className="order-list" aria-label="Your order">
                            {orderedAnswer.length ? (
                              orderedAnswer.map((choice, index) => (
                                <div key={choice} className="order-row">
                                  <span className="pill">{index + 1}</span>
                                  <strong>{formatOakText(choice)}</strong>
                                  <div className="button-row">
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      disabled={index === 0 || submittingQuestionId === question.id}
                                      onClick={() => moveOrderedAnswer(question.id, choice, -1, setAnswers)}
                                    >
                                      Up
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      disabled={index === orderedAnswer.length - 1 || submittingQuestionId === question.id}
                                      onClick={() => moveOrderedAnswer(question.id, choice, 1, setAnswers)}
                                    >
                                      Down
                                    </button>
                                    <button
                                      type="button"
                                      className="btn btn-secondary"
                                      disabled={submittingQuestionId === question.id}
                                      onClick={() => removeOrderedAnswer(question.id, choice, setAnswers)}
                                    >
                                      Remove
                                    </button>
                                  </div>
                                </div>
                              ))
                            ) : (
                              <p className="meta">Choose each number above in the order asked for.</p>
                            )}
                          </div>
                        </div>
                      ) : matchPairs.length ? (
                        <div className="match-list" aria-label="Match answers">
                          {matchPairs.map((pair) => {
                            const answerKey = matchAnswerKey(question.id, pair.left);
                            return (
                              <label key={answerKey} className="match-row">
                                <span className="match-term">{formatOakText(pair.left)}</span>
                                <select
                                  value={answers[answerKey] ?? ""}
                                  disabled={submittingQuestionId === question.id}
                                  onChange={(event) =>
                                    setAnswers((current) => ({
                                      ...current,
                                      [answerKey]: event.target.value,
                                    }))
                                  }
                                >
                                  <option value="">Choose a match</option>
                                  {matchChoices.map((choice) => (
                                    <option key={`${answerKey}:${choice}`} value={choice}>
                                      {formatOakText(choice)}
                                    </option>
                                  ))}
                                </select>
                              </label>
                            );
                          })}
                        </div>
                      ) : isMultiSelect ? (
                        <div className="answer-choice-grid answer-choice-grid-tiles">
                          {oakAnswerOptions.map((choice) => {
                            const selected = getMultiSelectAnswers(question.id, answers).includes(choice.label);
                            return (
                              <button
                                key={choice.label}
                                type="button"
                                className={selected ? "btn btn-primary btn-large" : "btn btn-secondary btn-large"}
                                disabled={submittingQuestionId === question.id}
                                onClick={() => toggleMultiSelectAnswer(question.id, choice.label, setAnswers)}
                              >
                                {choice.image ? (
                                  <img
                                    src={choice.image.url}
                                    width={choice.image.width}
                                    height={choice.image.height}
                                    alt={choice.image.alt}
                                    className="answer-choice-image"
                                  />
                                ) : null}
                                <span>{formatOakText(choice.label)}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : multiBlankSlots.length ? (
                        <div style={{ display: "grid", gap: 14 }}>
                          {multiBlankSlots.map((slot) => {
                            const selected = answers[slotAnswerKey(question.id, slot.slotIndex)] ?? "";
                            return (
                              <div key={slot.slotIndex} className="lesson-support-item">
                                <strong>Blank {slot.slotIndex}</strong>
                                <div className="button-row" style={{ marginTop: 8 }}>
                                  {slot.choices.map((choice) => (
                                    <button
                                      key={choice}
                                      type="button"
                                      className={selected === choice ? "btn btn-primary" : "btn btn-secondary"}
                                      disabled={submittingQuestionId === question.id}
                                      onClick={() =>
                                        setAnswers((current) => ({
                                          ...current,
                                          [slotAnswerKey(question.id, slot.slotIndex)]: choice,
                                        }))
                                      }
                                    >
                                      {formatOakText(choice)}
                                    </button>
                                  ))}
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      ) : isSingleChoice && singleChoiceAnswerOptions.length ? (
                        <div className="answer-choice-grid">
                          {singleChoiceAnswerOptions.map((choice) => {
                            const selected = answers[question.id] === choice.label;
                            return (
                              <button
                                key={choice.label}
                                type="button"
                                className={selected ? "btn btn-primary btn-large" : "btn btn-secondary btn-large"}
                                disabled={submittingQuestionId === question.id}
                                onClick={() =>
                                  setAnswers((current) => ({
                                    ...current,
                                    [question.id]: choice.label,
                                  }))
                                }
                              >
                                {choice.image ? (
                                  <img
                                    src={choice.image.url}
                                    width={choice.image.width}
                                    height={choice.image.height}
                                    alt={choice.image.alt}
                                    className="answer-choice-image"
                                  />
                                ) : null}
                                <span>{formatOakText(choice.label)}</span>
                              </button>
                            );
                          })}
                        </div>
                      ) : (
                        <>
                          {question.contentJson?.answerContract === "short_answer_alias" ? (
                            <p className="meta" style={{ marginBottom: 8 }}>
                              Type your answer. Use the notation asked for in the question.
                            </p>
                          ) : null}
                          <input
                            className="input"
                            value={answers[question.id] ?? ""}
                            onChange={(event) =>
                              setAnswers((current) => ({
                                ...current,
                                [question.id]: event.target.value,
                              }))
                            }
                            placeholder="Type your answer"
                          />
                        </>
                      )}
                      <div className="button-row" style={{ marginTop: 10 }}>
                        <button
                          className="btn btn-primary"
                          disabled={!hasAnswer(question, answers) || submittingQuestionId === question.id}
                          onClick={() => void submitAnswer(question.id)}
                        >
                          {submittingQuestionId === question.id
                            ? "Checking..."
                            : wrongAnswer
                              ? "Try again"
                              : "Submit answer"}
                        </button>
                        {questionFeedback ? (
                          <span className="pill">
                            {questionFeedback.isCorrect ? "Correct" : "Use the example, then try again"}
                          </span>
                        ) : null}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : isPausedForTutor ? null : (
            <div className="card">
              <h2>Tutor teaching screen</h2>
              <p className="meta">Stay with the tutor screen for this part. Your personalised questions will appear here for the 10-minute question rounds.</p>
            </div>
          )}
        </>
      ) : null}
    </Layout>
  );
}
