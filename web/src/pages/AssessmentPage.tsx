import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import ProgressDots from "../components/ProgressDots";
import QuestionCard from "../components/QuestionCard";
import PositiveFeedback from "../components/PositiveFeedback";
import ScientificCalculator from "../components/ScientificCalculator";
import { loadState, saveState } from "../utils/storage";
import {
  getAssessmentSession,
  skipAssessmentQuestion,
  submitAssessmentAnswer,
} from "../api/assessmentApi";
import { getAgePresentation } from "../utils/agePresentation";
import type { AssessmentAnswerResponse } from "../types/assessment";

function getSubjectAssessmentCopy(
  presentation: ReturnType<typeof getAgePresentation>,
  subject?: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH"
) {
  if (subject !== "SCIENCE") return presentation;

  return {
    ...presentation,
    kicker: "Newton Centre Science",
    assessmentTitle: "Let's do some science",
    assessmentSubtitle: "Take your time and use the evidence in each question.",
    progressLabel: "Progress through the science check-in",
  };
}

export default function AssessmentPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [skipLoading, setSkipLoading] = useState(false);
  const [selectedChoiceKey, setSelectedChoiceKey] = useState("");
  const [selectedChoiceKeys, setSelectedChoiceKeys] = useState<string[]>([]);
  const [rawAnswer, setRawAnswer] = useState("");
  const [matchPairs, setMatchPairs] = useState<Array<{ left: string; right: string }>>([]);
  const [orderedAnswers, setOrderedAnswers] = useState<string[]>([]);
  const [showFeedback, setShowFeedback] = useState(false);
  const [error, setError] = useState("");
  const [calculatorOpen, setCalculatorOpen] = useState(false);
  const [pageState, setPageState] = useState(() => loadState());

  useEffect(() => {
    if (!pageState.sessionId || !pageState.currentQuestion) {
      navigate("/ready");
    }
  }, [navigate, pageState.currentQuestion, pageState.sessionId]);

  useEffect(() => {
    // keep local state in sync if storage was changed elsewhere
    const fresh = loadState();
    setPageState(fresh);
  }, []);

  useEffect(() => {
    if (!pageState.sessionId) return;

    let active = true;

    getAssessmentSession(pageState.sessionId)
      .then((summary) => {
        if (!active) return;

        const stored = loadState();
        const nextState = {
          ...stored,
          subject: summary.subject ?? stored.subject,
          currentQuestion: summary.isComplete
            ? null
            : summary.currentQuestion ?? stored.currentQuestion,
          askedCount: summary.askedCount,
          entryYear: summary.entryYear,
        };

        saveState(nextState);
        setPageState(nextState);
      })
      .catch(() => {
        // The existing local state still lets the learner continue if the refresh fails.
      });

    return () => {
      active = false;
    };
  }, [pageState.sessionId]);

  if (!pageState.currentQuestion) return null;

  const currentQuestion = pageState.currentQuestion;
  const responseKind = currentQuestion.responseKind ?? "single_choice";
  const presentation = getSubjectAssessmentCopy(
    getAgePresentation(pageState.student?.student.schoolYear),
    pageState.subject
  );
  const calculatorAllowed =
    currentQuestion.calculatorAllowed === true ||
    currentQuestion.allowCalculator === true;

  function resetQuestionInputs() {
    setSelectedChoiceKey("");
    setSelectedChoiceKeys([]);
    setRawAnswer("");
    setMatchPairs([]);
    setOrderedAnswers([]);
    setShowFeedback(false);
    setError("");
    setCalculatorOpen(false);
  }

  function advanceAssessment(res: AssessmentAnswerResponse, showPositiveFeedback: boolean) {
    setShowFeedback(showPositiveFeedback);

    if (res.isComplete) {
      const nextState = {
        ...pageState,
        currentQuestion: null,
        askedCount: res.askedCount,
        result: res.result ?? null,
      };

      saveState(nextState);
      setPageState(nextState);

      setTimeout(() => {
        navigate("/report");
      }, 400);
      return;
    }

    const nextState = {
      ...pageState,
      currentQuestion: res.nextQuestion,
      askedCount: res.askedCount,
    };

    saveState(nextState);
    setPageState(nextState);

    setTimeout(() => {
      resetQuestionInputs();
    }, showPositiveFeedback ? 350 : 0);
  }

  async function handleSubmit() {
    const hasAnswer =
      responseKind === "single_choice"
        ? Boolean(selectedChoiceKey)
        : responseKind === "multi_select"
        ? selectedChoiceKeys.length > 0
        : responseKind === "short_answer"
        ? rawAnswer.trim().length > 0
        : responseKind === "match"
        ? (currentQuestion.matchPairs ?? []).length > 0 &&
          matchPairs.length === (currentQuestion.matchPairs ?? []).length
        : responseKind === "order"
        ? currentQuestion.choices.length > 0 &&
          orderedAnswers.filter(Boolean).length === currentQuestion.choices.length
        : false;

    if (!hasAnswer) {
      setError("Please choose an answer before continuing.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await submitAssessmentAnswer({
        sessionId: pageState.sessionId,
        questionId: currentQuestion.id,
        selectedChoiceKey:
          responseKind === "single_choice" ? selectedChoiceKey : undefined,
        selectedChoiceKeys:
          responseKind === "multi_select" ? selectedChoiceKeys : undefined,
        rawAnswer: responseKind === "short_answer" ? rawAnswer : undefined,
        matchPairs: responseKind === "match" ? matchPairs : undefined,
        orderedAnswers: responseKind === "order" ? orderedAnswers : undefined,
      });

      advanceAssessment(res, true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit answer");
    } finally {
      setLoading(false);
    }
  }

  async function handleSkip() {
    setSkipLoading(true);
    setError("");

    try {
      const res = await skipAssessmentQuestion({
        sessionId: pageState.sessionId,
        questionId: currentQuestion.id,
      });

      advanceAssessment(res, false);
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to skip this question"
      );
    } finally {
      setSkipLoading(false);
    }
  }

  return (
    <Layout
      title={presentation.assessmentTitle}
      subtitle={presentation.assessmentSubtitle}
      kicker={presentation.kicker}
      themeClass={presentation.themeClass}
    >
      <div className="card center">
        <ProgressDots
          count={pageState.askedCount}
          total={presentation.totalDots}
          label={presentation.progressLabel}
        />

        <p className="meta" style={{ marginTop: 14 }}>
          {presentation.encouragement}
        </p>

        {calculatorAllowed ? (
          <div style={{ marginTop: 12 }}>
            <span
              style={{
                display: "inline-block",
                padding: "8px 12px",
                borderRadius: 999,
                fontWeight: 700,
                fontSize: 13,
                background: "rgba(255,255,255,0.08)",
                border: "1px solid var(--line)",
              }}
            >
              Calculator allowed
            </span>
          </div>
        ) : null}
      </div>

      <div style={{ height: 16 }} />

      <QuestionCard
        question={currentQuestion}
        selectedChoiceKey={selectedChoiceKey}
        setSelectedChoiceKey={setSelectedChoiceKey}
        selectedChoiceKeys={selectedChoiceKeys}
        setSelectedChoiceKeys={setSelectedChoiceKeys}
        rawAnswer={rawAnswer}
        setRawAnswer={setRawAnswer}
        matchPairs={matchPairs}
        setMatchPairs={setMatchPairs}
        orderedAnswers={orderedAnswers}
        setOrderedAnswers={setOrderedAnswers}
        onSubmit={handleSubmit}
        onSkip={handleSkip}
        loading={loading}
        skipLoading={skipLoading}
        askedCount={pageState.askedCount}
        submitLabel={presentation.submitLabel}
        helperText={
          presentation.band === "junior"
            ? "Choose the answer you think is right."
            : undefined
        }
        youngerTone={presentation.band === "junior"}
      />

      {calculatorAllowed ? (
        <div style={{ marginTop: 16, display: "flex", justifyContent: "center" }}>
          <button
            type="button"
            className="btn btnGhost"
            onClick={() => setCalculatorOpen(true)}
            style={{ borderRadius: 14, padding: "12px 16px", fontWeight: 800 }}
          >
            Open calculator
          </button>
        </div>
      ) : null}

      <PositiveFeedback
        visible={showFeedback}
        message={presentation.feedbackMessage}
      />

      {error ? <div className="error-box">{error}</div> : null}

      <ScientificCalculator
        open={calculatorOpen}
        onClose={() => setCalculatorOpen(false)}
      />
    </Layout>
  );
}
