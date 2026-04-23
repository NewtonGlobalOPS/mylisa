export type AgeBand = "junior" | "middle" | "senior";

export type AgePresentation = {
  band: AgeBand;
  themeClass: string;
  kicker: string;
  readyTitle: string;
  readySubtitle: string;
  readySetupText: string;
  startButtonLabel: string;
  assessmentTitle: string;
  assessmentSubtitle: string;
  encouragement: string;
  questionPlaceholder: string;
  submitLabel: string;
  feedbackMessage: string;
  progressLabel: string;
  totalDots: number;
};

export function getAgePresentation(schoolYear?: number | null): AgePresentation {
  const year = schoolYear ?? 7;

  if (year <= 3) {
    return {
      band: "junior",
      themeClass: "theme-junior",
      kicker: "Newton Junior Maths",
      readyTitle: "Ready for your maths adventure?",
      readySubtitle: "We will take it one small step at a time.",
      readySetupText:
        "This check-in starts gently and builds confidence with short, clear questions.",
      startButtonLabel: "Start my maths adventure",
      assessmentTitle: "Let’s try the next question",
      assessmentSubtitle: "Do your best. You can go one question at a time.",
      encouragement: "Nice and steady. Read the question, think, and have a go.",
      questionPlaceholder: "Type your answer here",
      submitLabel: "Next question",
      feedbackMessage: "Great effort. Let’s keep going.",
      progressLabel: "Questions answered so far",
      totalDots: 15,
    };
  }

  if (year <= 6) {
    return {
      band: "middle",
      themeClass: "theme-middle",
      kicker: "Newton Centre Assessment",
      readyTitle: "Ready to begin your maths check-in?",
      readySubtitle: "The questions will adapt as we learn what feels secure.",
      readySetupText:
        "The assessment starts just below current school year and adjusts as evidence builds.",
      startButtonLabel: "Begin maths check-in",
      assessmentTitle: "Let’s do some maths",
      assessmentSubtitle: "Take your time and show what you know.",
      encouragement: "You’re doing well. Keep going one question at a time.",
      questionPlaceholder: "Enter your answer",
      submitLabel: "Continue",
      feedbackMessage: "Nice work. Keep going.",
      progressLabel: "Progress through the check-in",
      totalDots: 18,
    };
  }

  return {
    band: "senior",
    themeClass: "theme-senior",
    kicker: "The Newton Centre",
    readyTitle: "Ready to begin",
    readySubtitle: "The assessment will adapt as evidence builds.",
    readySetupText:
      "The assessment starts from one school year below the learner’s current year and adapts upwards as evidence builds.",
    startButtonLabel: "Begin assessment",
    assessmentTitle: "Let’s do some maths",
    assessmentSubtitle: "Take your time and try your best.",
    encouragement: "You’re doing well. Just answer one question at a time.",
    questionPlaceholder: "Type your answer",
    submitLabel: "Next",
    feedbackMessage: "Great effort. Let’s keep going.",
    progressLabel: "Answered questions",
    totalDots: 20,
  };
}
