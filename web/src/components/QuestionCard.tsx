import type { AssessmentQuestion } from "../types/assessment";
import {
  formatOakText,
  getOakAnswerOptions,
  getOakQuestionImage,
  getOakStimulusImages,
  isSugarDrinksGraphQuestion,
} from "../utils/oakQuestion";

function formatMathText(value: string): string {
  return formatOakText(value);
}

function DisplayText({ value }: { value: string }) {
  return <span>{formatMathText(value)}</span>;
}

function SugarDrinksChart() {
  const drinks = [
    { label: "cola", value: 16 },
    { label: "diet cola", value: 0 },
    { label: "orange juice", value: 8 },
    { label: "cordial", value: 4 },
    { label: "water", value: 0 },
  ];

  return (
    <figure className="question-stimulus sugar-chart" aria-label="Bar chart showing sugar in drinks">
      <div className="sugar-chart-axis" aria-hidden="true">
        <span>16g</span>
        <span>12g</span>
        <span>8g</span>
        <span>4g</span>
        <span>0g</span>
      </div>
      <div className="sugar-chart-plot">
        {drinks.map((drink) => (
          <div key={drink.label} className="sugar-chart-bar-wrap">
            <span className="sugar-chart-value">{drink.value}g</span>
            <div className="sugar-chart-bar-track">
              <div
                className="sugar-chart-bar"
                style={{ height: `${Math.max(2, (drink.value / 16) * 100)}%` }}
              />
            </div>
            <span className="sugar-chart-label">{drink.label}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

export default function QuestionCard({
  question,
  selectedChoiceKey,
  setSelectedChoiceKey,
  selectedChoiceKeys = [],
  setSelectedChoiceKeys,
  rawAnswer = "",
  setRawAnswer,
  matchPairs = [],
  setMatchPairs,
  orderedAnswers = [],
  setOrderedAnswers,
  onSubmit,
  onSkip,
  loading,
  skipLoading = false,
  askedCount,
  submitLabel = "Next",
  helperText,
  youngerTone = false,
}: {
  question: AssessmentQuestion;
  selectedChoiceKey: string;
  setSelectedChoiceKey: (value: string) => void;
  selectedChoiceKeys?: string[];
  setSelectedChoiceKeys?: (value: string[]) => void;
  rawAnswer?: string;
  setRawAnswer?: (value: string) => void;
  matchPairs?: Array<{ left: string; right: string }>;
  setMatchPairs?: (value: Array<{ left: string; right: string }>) => void;
  orderedAnswers?: string[];
  setOrderedAnswers?: (value: string[]) => void;
  onSubmit: () => Promise<void>;
  onSkip?: () => Promise<void>;
  loading: boolean;
  skipLoading?: boolean;
  askedCount: number;
  submitLabel?: string;
  helperText?: string;
  youngerTone?: boolean;
}) {
  const questionImage = getOakQuestionImage(question);
  const stimulusImages = getOakStimulusImages(question);
  const answerImagesByLabel = new Map(
    getOakAnswerOptions(question)
      .filter((option) => option.image)
      .map((option) => [formatMathText(option.label), option.image!])
  );
  const showSugarDrinksChart = isSugarDrinksGraphQuestion(question);
  const responseKind = question.responseKind ?? "single_choice";
  const isBusy = loading || skipLoading;
  const matchOptions = Array.from(
    new Set((question.matchPairs ?? []).map((pair) => pair.right))
  );
  const orderOptions = question.choices.map((choice) => choice.label);

  function toggleMultiChoice(key: string) {
    if (!setSelectedChoiceKeys) return;
    setSelectedChoiceKeys(
      selectedChoiceKeys.includes(key)
        ? selectedChoiceKeys.filter((item) => item !== key)
        : [...selectedChoiceKeys, key]
    );
  }

  function setMatchRight(left: string, right: string) {
    if (!setMatchPairs) return;
    const next = matchPairs.filter((pair) => pair.left !== left);
    if (right) next.push({ left, right });
    setMatchPairs(next);
  }

  function setOrderSlot(index: number, value: string) {
    if (!setOrderedAnswers) return;
    const next = [...orderedAnswers];
    next[index] = value;
    setOrderedAnswers(next);
  }

  return (
    <div className={`card child-card ${youngerTone ? "child-card-junior" : ""}`.trim()}>
      <div className="child-header">
        <span className="pill">Question {askedCount + 1}</span>
        {question.calculatorAllowed ? <span className="pill">Calculator allowed</span> : null}
      </div>

      {helperText ? <p className="question-helper">{helperText}</p> : null}

      <h2 className="question-prompt">
        <DisplayText value={question.displayPromptText ?? question.promptText} />
      </h2>

      {showSugarDrinksChart ? <SugarDrinksChart /> : null}

      {!showSugarDrinksChart && questionImage ? (
        <figure className="question-stimulus">
          <img
            src={questionImage.url}
            width={questionImage.width}
            height={questionImage.height}
            alt={questionImage.alt}
            loading="eager"
          />
        </figure>
      ) : null}

      {!showSugarDrinksChart && !questionImage && stimulusImages.length ? (
        <div className="question-stimulus-grid" aria-label="Question images">
          {stimulusImages.map((image) => (
            <figure key={image.url} className="question-stimulus question-stimulus-tile">
              <img
                src={image.url}
                width={image.width}
                height={image.height}
                alt={image.alt}
                loading="eager"
              />
            </figure>
          ))}
        </div>
      ) : null}

      {!question.displayPromptText && question.inputHelp ? (
        <p className="meta center">{question.inputHelp}</p>
      ) : null}

      <div
        className={`answer-block ${
          responseKind === "match" || responseKind === "order" ? "answer-block-wide" : ""
        }`.trim()}
      >
        {responseKind === "short_answer" ? (
          <input
            className="answer-input"
            value={rawAnswer}
            disabled={isBusy}
            onChange={(event) => setRawAnswer?.(event.target.value)}
            placeholder="Type your answer"
          />
        ) : null}

        {responseKind === "single_choice" || responseKind === "multi_select" ? (
          <div
            style={{
              display: "grid",
              gap: 12,
              width: "100%",
            }}
          >
            {question.choices.map((choice) => {
              const selected =
                responseKind === "multi_select"
                  ? selectedChoiceKeys.includes(choice.key)
                  : selectedChoiceKey === choice.key;
              return (
                <button
                  key={choice.key}
                  type="button"
                  className={selected ? "btn btn-primary btn-large" : "btn btn-secondary btn-large"}
                  disabled={isBusy}
                  onClick={() =>
                    responseKind === "multi_select"
                      ? toggleMultiChoice(choice.key)
                      : setSelectedChoiceKey(choice.key)
                  }
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
                    {responseKind === "multi_select" ? (selected ? "✓" : "+") : choice.key}
                  </span>
                  {answerImagesByLabel.get(formatMathText(choice.label)) ? (
                    <img
                      src={answerImagesByLabel.get(formatMathText(choice.label))!.url}
                      width={answerImagesByLabel.get(formatMathText(choice.label))!.width}
                      height={answerImagesByLabel.get(formatMathText(choice.label))!.height}
                      alt={answerImagesByLabel.get(formatMathText(choice.label))!.alt}
                      className="answer-choice-image answer-choice-image-inline"
                    />
                  ) : null}
                  <DisplayText value={choice.label} />
                </button>
              );
            })}
          </div>
        ) : null}

        {responseKind === "match" ? (
          <div className="match-list">
            {(question.matchPairs ?? []).map((pair) => (
              <label key={pair.left} className="match-row">
                <span className="match-term">
                  <DisplayText value={pair.left} />
                </span>
                <select
                  value={matchPairs.find((item) => item.left === pair.left)?.right ?? ""}
                  disabled={isBusy}
                  onChange={(event) => setMatchRight(pair.left, event.target.value)}
                >
                  <option value="">Choose match</option>
                  {matchOptions.map((option) => (
                    <option key={option} value={option}>
                      {formatMathText(option)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ) : null}

        {responseKind === "order" ? (
          <div className="match-list">
            {orderOptions.map((_, index) => (
              <label key={index} className="match-row">
                <span>Position {index + 1}</span>
                <select
                  value={orderedAnswers[index] ?? ""}
                  disabled={isBusy}
                  onChange={(event) => setOrderSlot(index, event.target.value)}
                >
                  <option value="">Choose item</option>
                  {orderOptions.map((option) => (
                    <option
                      key={option}
                      value={option}
                      disabled={orderedAnswers.includes(option) && orderedAnswers[index] !== option}
                    >
                      {formatMathText(option)}
                    </option>
                  ))}
                </select>
              </label>
            ))}
          </div>
        ) : null}

        <div style={{ display: "grid", gap: 10, width: "100%" }}>
          <button
            className="btn btn-primary btn-large"
            disabled={isBusy}
            onClick={() => void onSubmit()}
          >
            {loading ? "Checking..." : submitLabel}
          </button>
          {onSkip ? (
            <button
              type="button"
              className="btn btn-secondary btn-large"
              disabled={isBusy}
              onClick={() => void onSkip()}
            >
              {skipLoading ? "Skipping..." : "Skip question"}
            </button>
          ) : null}
        </div>
      </div>
    </div>
  );
}
