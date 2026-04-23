import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import ProgressDots from "../components/ProgressDots";
import QuestionCard from "../components/QuestionCard";
import PositiveFeedback from "../components/PositiveFeedback";
import ScientificCalculator from "../components/ScientificCalculator";
import { loadState, saveState } from "../utils/storage";
import { submitAssessmentAnswer } from "../api/assessmentApi";
import { getAgePresentation } from "../utils/agePresentation";

export default function AssessmentPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [selectedChoiceKey, setSelectedChoiceKey] = useState("");
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

  if (!pageState.currentQuestion) return null;

  const currentQuestion = pageState.currentQuestion;
  const presentation = getAgePresentation(pageState.student?.student.schoolYear);
  const calculatorAllowed =
    currentQuestion.calculatorAllowed === true ||
    currentQuestion.allowCalculator === true;

  async function handleSubmit() {
    if (!selectedChoiceKey) {
      setError("Please choose an answer before continuing.");
      return;
    }

    setLoading(true);
    setError("");

    try {
      const res = await submitAssessmentAnswer({
        sessionId: pageState.sessionId,
        questionId: currentQuestion.id,
        selectedChoiceKey: selectedChoiceKey as "A" | "B" | "C" | "D",
      });

      setShowFeedback(true);

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
      } else {
        const nextState = {
          ...pageState,
          currentQuestion: res.nextQuestion,
          askedCount: res.askedCount,
        };

        saveState(nextState);
        setPageState(nextState);

        setTimeout(() => {
          setSelectedChoiceKey("");
          setShowFeedback(false);
          setError("");
          setCalculatorOpen(false);
        }, 350);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit answer");
    } finally {
      setLoading(false);
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
        onSubmit={handleSubmit}
        loading={loading}
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
