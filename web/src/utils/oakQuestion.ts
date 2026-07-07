export type OakQuestionImage = {
  url: string;
  width?: number;
  height?: number;
  alt: string;
};

export type OakAnswerOption = {
  label: string;
  isCorrect?: boolean;
  image?: OakQuestionImage;
};

type QuestionLike = {
  contentJson?: Record<string, unknown> | null;
  promptText?: string;
  canonicalPromptText?: string;
  displayPromptText?: string;
};

export function cleanOakPromptText(value: string) {
  return value
    .replace(/\{\{\s*\}\}/g, "____")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function formatOakText(value: string) {
  return cleanOakPromptText(value)
    .replace(/\$\$/g, "")
    .replace(/\\text\{([^{}]+)\}/g, "$1")
    .replace(/\\(?:dfrac|frac)\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2")
    .replace(/(\d+)\s*\{\s*([^{}]+?)\s+\\?over\s+\{?([^{}]+?)\}?\s*\}/g, "$1 $2/$3")
    .replace(/\{\s*([^{}]+?)\s+\\?over\s+\{?([^{}]+?)\}?\s*\}/g, "$1/$2")
    .replace(/\{\s*([^{}]+?)\s*\}\s*\\?over\s*\{\s*([^{}]+?)\s*\}/g, "$1/$2")
    .replace(/((?=[^{}\s]*\d)[^{}\s]+)\s+\\?over\s+((?=[^{}\s]*\d)[^{}\s]+)/g, "$1/$2")
    .replace(/(\d+)\{(\d+\/\d+)\}/g, "$1 $2")
    .replace(/\\times/g, "x")
    .replace(/\\div/g, "/")
    .replace(/\\le/g, "<=")
    .replace(/\\ge/g, ">=")
    .replace(/\\not=/g, "!=")
    .replace(/\s+/g, " ")
    .trim();
}

function coerceQuestionImage(image: unknown): OakQuestionImage | null {
  if (!image || typeof image !== "object") return null;

  const url = String((image as { url?: unknown }).url ?? "").trim();
  if (!url) return null;

  const width = Number((image as { width?: unknown }).width);
  const height = Number((image as { height?: unknown }).height);
  const alt = String((image as { alt?: unknown }).alt ?? "").trim();

  return {
    url,
    width: Number.isFinite(width) ? width : undefined,
    height: Number.isFinite(height) ? height : undefined,
    alt: alt || "Question image",
  };
}

function imageFromRecord(value: Record<string, unknown>): OakQuestionImage | undefined {
  const direct = coerceQuestionImage(value.image);
  if (direct) return direct;

  const url = String(value.url ?? "").trim();
  if (!url) return undefined;

  const width = Number(value.width);
  const height = Number(value.height);
  const alt = String(value.alt ?? value.text ?? value.label ?? "").trim();
  return {
    url,
    width: Number.isFinite(width) ? width : undefined,
    height: Number.isFinite(height) ? height : undefined,
    alt: alt || "Answer option image",
  };
}

export function isSugarDrinksGraphQuestion(question: QuestionLike): boolean {
  const oak = question.contentJson?.oak;
  const oakLessonSlug =
    oak && typeof oak === "object"
      ? String((oak as { lessonSlug?: unknown }).lessonSlug ?? "").trim()
      : "";
  const prompt = cleanOakPromptText(
    question.canonicalPromptText ??
      question.promptText ??
      question.displayPromptText ??
      String((question.contentJson?.canonicalTruth as { originalQuestion?: unknown } | undefined)?.originalQuestion ?? "")
  ).toLowerCase();

  return (
    oakLessonSlug === "comparing-toothpaste-non-statutory" &&
    prompt.includes("graph about sugar in drinks")
  );
}

function knownOakQuestionImage(question: QuestionLike): OakQuestionImage | null {
  if (isSugarDrinksGraphQuestion(question)) {
    return {
      url: "https://oaknationalacademy-res.cloudinary.com/image/upload/v1712361486/kh6c4rqvtugm3h2xdcq7.png",
      width: 640,
      height: 373,
      alt: "Bar chart showing sugar in drinks: cola 16g, diet cola 0g, orange juice 8g, cordial 4g, water 0g.",
    };
  }

  return null;
}

export function getOakQuestionImage(question: QuestionLike): OakQuestionImage | null {
  const oak = question.contentJson?.oak;
  const oakImage =
    oak && typeof oak === "object"
      ? coerceQuestionImage((oak as { questionImage?: unknown }).questionImage)
      : null;
  if (oakImage) return oakImage;

  const topLevelImage = coerceQuestionImage(question.contentJson?.questionImage);
  if (topLevelImage) return topLevelImage;

  return knownOakQuestionImage(question);
}

export function getOakStimulusImages(question: QuestionLike): OakQuestionImage[] {
  const oak = question.contentJson?.oak;
  const raw =
    oak && typeof oak === "object"
      ? (oak as { stimulusImages?: unknown }).stimulusImages
      : question.contentJson?.stimulusImages;

  if (!Array.isArray(raw)) return [];
  return raw
    .map(coerceQuestionImage)
    .filter((image): image is OakQuestionImage => image !== null);
}

export function getSingleChoiceOptions(question: QuestionLike): string[] {
  if (!isSingleChoiceQuestion(question)) return [];

  const oakOptions = getOakAnswerOptions(question);
  if (oakOptions.length) return oakOptions.map((option) => option.label);

  const truth = question.contentJson?.canonicalTruth;
  if (truth && typeof truth === "object") {
    const optionBank = (truth as { optionBank?: unknown }).optionBank;
    if (Array.isArray(optionBank)) {
      return optionBank
        .map((item) => String(item))
        .filter((item) => item && item !== "[object Object]");
    }
  }

  const oak = question.contentJson?.oak;
  if (!oak || typeof oak !== "object") return [];
  const choices = (oak as { choices?: unknown }).choices;
  if (!Array.isArray(choices)) return [];

  return choices
    .map((choice) =>
      choice && typeof choice === "object"
        ? String((choice as { label?: unknown }).label ?? "")
        : String(choice ?? ""),
    )
    .filter(Boolean);
}

export function getAnswerContract(question: QuestionLike): string | null {
  if (typeof question.contentJson?.answerContract === "string") {
    return question.contentJson.answerContract;
  }

  const truth = question.contentJson?.canonicalTruth;
  if (!truth || typeof truth !== "object") return null;
  const answerContract = (truth as { answerContract?: unknown }).answerContract;
  return typeof answerContract === "string" ? answerContract : null;
}

function optionLetter(index: number) {
  return String.fromCharCode(65 + index);
}

function labelFromOakContent(
  value: unknown,
  index = 0,
): { label: string; image?: OakQuestionImage } {
  if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    const text = String(raw.text ?? raw.label ?? raw.alt ?? "").trim();
    const url = String(raw.url ?? "").trim();
    const isImage = Boolean(url);
    const label = isImage
      ? String(raw.text ?? raw.label ?? "").trim() || `Option ${optionLetter(index)}`
      : formatOakText(text || JSON.stringify(value));
    return {
      label,
      image: url
        ? {
            url,
            width: Number.isFinite(Number(raw.width)) ? Number(raw.width) : undefined,
            height: Number.isFinite(Number(raw.height)) ? Number(raw.height) : undefined,
            alt: text || "Answer option image",
          }
        : undefined,
    };
  }

  return { label: formatOakText(String(value ?? "")) };
}

export function getOakAnswerOptions(question: QuestionLike): OakAnswerOption[] {
  const oak = question.contentJson?.oak;
  if (!oak || typeof oak !== "object") return [];

  const rawAnswers = (oak as { rawAnswers?: unknown }).rawAnswers;
  if (Array.isArray(rawAnswers)) {
    const options: OakAnswerOption[] = [];
    rawAnswers.forEach((answer, index) => {
      if (!answer || typeof answer !== "object") return;
      const raw = answer as Record<string, unknown>;
      const parsed = labelFromOakContent(raw.content, index);
      if (!parsed.label) return;
      options.push({
        label: parsed.label,
        isCorrect: raw.distractor === false,
        image: parsed.image ?? imageFromRecord(raw),
      });
    });
    return options;
  }

  const choices = (oak as { choices?: unknown }).choices;
  if (Array.isArray(choices)) {
    return choices
      .map((choice, index): OakAnswerOption | null => {
        if (!choice || typeof choice !== "object") return null;
        const raw = choice as Record<string, unknown>;
        const parsed = labelFromOakContent(raw.content ?? raw.label, index);
        if (!parsed.label || parsed.label === "[object Object]") return null;
        return {
          label: parsed.label,
          ...(typeof raw.isCorrect === "boolean" ? { isCorrect: raw.isCorrect } : {}),
          ...(parsed.image ?? imageFromRecord(raw)
            ? { image: parsed.image ?? imageFromRecord(raw) }
            : {}),
        };
      })
      .filter((choice): choice is OakAnswerOption => choice !== null);
  }

  return [];
}

export function isSingleChoiceQuestion(question: QuestionLike): boolean {
  if (getAnswerContract(question) === "single_choice") return true;

  const oak = question.contentJson?.oak;
  if (!oak || typeof oak !== "object") return false;

  const questionType = String((oak as { questionType?: unknown }).questionType ?? "").toLowerCase();
  const derivedQuestionType = String(
    (oak as { derivedQuestionType?: unknown }).derivedQuestionType ?? "",
  ).toLowerCase();

  return questionType === "multiple-choice" || derivedQuestionType === "single_choice";
}
