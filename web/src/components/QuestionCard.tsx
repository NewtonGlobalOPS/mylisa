import type { AssessmentQuestion } from "../types/assessment";

export default function QuestionCard({
  question,
  selectedChoiceKey,
  setSelectedChoiceKey,
  onSubmit,
  loading,
  askedCount,
  submitLabel = "Next",
  helperText,
  youngerTone = false,
}: {
  question: AssessmentQuestion;
  selectedChoiceKey: string;
  setSelectedChoiceKey: (value: string) => void;
  onSubmit: () => Promise<void>;
  loading: boolean;
  askedCount: number;
  submitLabel?: string;
  helperText?: string;
  youngerTone?: boolean;
}) {
  return (
    <div className={`card child-card ${youngerTone ? "child-card-junior" : ""}`.trim()}>
      <div className="child-header">
        <span className="pill">Question {askedCount + 1}</span>
        {question.calculatorAllowed ? <span className="pill">Calculator allowed</span> : null}
      </div>

      {helperText ? <p className="question-helper">{helperText}</p> : null}

      <h2 className="question-prompt">
        {question.displayPromptText ?? question.promptText}
      </h2>

      {!question.displayPromptText && question.inputHelp ? (
        <p className="meta center">{question.inputHelp}</p>
      ) : null}

      <div className="answer-block">
        <div
          style={{
            display: "grid",
            gap: 12,
            width: "100%",
          }}
        >
          {question.choices.map((choice) => {
            const selected = selectedChoiceKey === choice.key;
            return (
              <button
                key={choice.key}
                type="button"
                className={selected ? "btn btn-primary btn-large" : "btn btn-secondary btn-large"}
                disabled={loading}
                onClick={() => setSelectedChoiceKey(choice.key)}
                style={{
                  justifyContent: "flex-start",
                  textAlign: "left",
                  display: "flex",
                  gap: 12,
                  alignItems: "center",
                }}
              >
                <span
                  style={{
                    display: "inline-flex",
                    alignItems: "center",
                    justifyContent: "center",
                    width: 32,
                    height: 32,
                    borderRadius: 999,
                    border: "1px solid currentColor",
                    fontWeight: 800,
                    flexShrink: 0,
                  }}
                >
                  {choice.key}
                </span>
                <span>{choice.label}</span>
              </button>
            );
          })}
        </div>

        <button
          className="btn btn-primary btn-large"
          disabled={loading || !selectedChoiceKey}
          onClick={() => void onSubmit()}
        >
          {loading ? "Checking..." : submitLabel}
        </button>
      </div>
    </div>
  );
}
