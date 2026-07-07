import "dotenv/config";

import type { RuntimeQuestion } from "./assessmentEngine.js";

type AssessmentWrapperInput = {
  child: {
    age: number | null;
    schoolYear: number;
    keyStage: string;
  };
  question: RuntimeQuestion;
  canonical: {
    promptText: string;
    answerText: string;
    equation?: string | null;
    operator?: string | null;
    lhsA?: number | null;
    lhsB?: number | null;
    rhs?: number | null;
  };
};

type AssessmentWrapperResult = {
  decision: "ask" | "skip";
  displayPromptText: string;
  skipReason?: string;
  source: "llm" | "fallback";
  checks: {
    logicCorrect: boolean;
    ageRelevant: boolean;
    objectiveRelevant: boolean;
    strandRelevant: boolean;
  };
};

function cleanText(value: string | null | undefined): string {
  return (value ?? "").trim();
}

function normalizePromptForDisplay(value: string): string {
  return value
    .replace(/\{\{\s*\}\}/g, "____")
    .replace(/\s+/g, " ")
    .trim();
}

function hasLlmConfig(): boolean {
  return Boolean(
    process.env.AZURE_OPENAI_ENDPOINT &&
      process.env.AZURE_OPENAI_DEPLOYMENT &&
      process.env.AZURE_OPENAI_API_KEY
  );
}

function stripJsonFence(value: string): string {
  return value
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
}

function buildSystemPrompt(input: AssessmentWrapperInput): string {
  return [
    `You are a ${input.child.keyStage} Year ${input.child.schoolYear} teacher.`,
    "You are preparing a single subject assessment question for a learner.",
    "Canonical questions are the source of truth.",
    "The child's age is immutable and, unless explicitly changed elsewhere, the school year is also immutable.",
    "The assessment stage is dynamic based on the child's demonstrated ability, but the wrapper must still remain age-appropriate and classroom-natural.",
    "First review the canonical question for logic, correctness, objective relevance, strand relevance, and age appropriateness.",
    "Skip the question if there is any issue with correctness, internal logic, or relevance.",
    "If the question is valid, wrap it as if you were asking it in a classroom setting.",
    "Do not change the facts, numbers, operators, answer expectation, or difficulty intent.",
    "Do not give the answer.",
    "Do not include hints, scaffolds, worked steps, leading clues, or multiple-choice options.",
    "Return JSON only.",
  ].join("\n");
}

function buildUserPrompt(input: AssessmentWrapperInput): string {
  return JSON.stringify(
    {
      task: "review_and_wrap_assessment_question",
      child: input.child,
      canonicalQuestion: {
        promptText: input.canonical.promptText,
        answerText: input.canonical.answerText,
        equation: input.canonical.equation ?? null,
        operator: input.canonical.operator ?? null,
        lhsA: input.canonical.lhsA ?? null,
        lhsB: input.canonical.lhsB ?? null,
        rhs: input.canonical.rhs ?? null,
        itemType: input.question.contentJson?.itemType ?? null,
      },
      runtimeQuestion: {
        code: input.question.code,
        title: input.question.title,
        statement: input.question.statement ?? null,
        yearGroup: input.question.yearGroup,
        strand: input.question.strand,
        difficulty: input.question.difficulty,
        answerMode: input.question.answerMode,
        contentJson: input.question.contentJson ?? null,
      },
      outputContract: {
        decision: "ask | skip",
        displayPromptText:
          "string; required when decision=ask; this must sound like a teacher speaking in class and must not reveal the answer or any hint",
        skipReason:
          "string; required when decision=skip; briefly explain the issue",
        checks: {
          logicCorrect: "boolean",
          ageRelevant: "boolean",
          objectiveRelevant: "boolean",
          strandRelevant: "boolean",
        },
      },
    },
    null,
    2
  );
}

async function callWrapperLlm(input: AssessmentWrapperInput): Promise<AssessmentWrapperResult> {
  const endpoint = cleanText(process.env.AZURE_OPENAI_ENDPOINT).replace(/\/+$/, "");
  const deployment = cleanText(process.env.AZURE_OPENAI_DEPLOYMENT);
  const apiKey = cleanText(process.env.AZURE_OPENAI_API_KEY);
  const apiVersion =
    cleanText(process.env.AZURE_OPENAI_API_VERSION) || "2025-01-01-preview";

  const res = await fetch(
    `${endpoint}/openai/deployments/${encodeURIComponent(
      deployment
    )}/chat/completions?api-version=${encodeURIComponent(apiVersion)}`,
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "api-key": apiKey,
      },
      body: JSON.stringify({
        max_completion_tokens: 300,
        temperature: 0,
        response_format: { type: "json_object" },
        messages: [
          {
            role: "system",
            content: buildSystemPrompt(input),
          },
          {
            role: "user",
            content: buildUserPrompt(input),
          },
        ],
      }),
    }
  );

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Assessment wrapper LLM failed: ${res.status} ${res.statusText} ${text}`
    );
  }

  const data = (await res.json()) as any;
  const content = data?.choices?.[0]?.message?.content;

  if (!content || typeof content !== "string") {
    throw new Error("Assessment wrapper LLM returned empty content");
  }

  const parsed = JSON.parse(stripJsonFence(content)) as Partial<AssessmentWrapperResult>;
  const decision = parsed.decision === "skip" ? "skip" : "ask";
  const displayPromptText = cleanText(parsed.displayPromptText);
  const skipReason = cleanText(parsed.skipReason);

  return {
    decision,
    displayPromptText,
    skipReason,
    source: "llm",
    checks: {
      logicCorrect: parsed.checks?.logicCorrect !== false,
      ageRelevant: parsed.checks?.ageRelevant !== false,
      objectiveRelevant: parsed.checks?.objectiveRelevant !== false,
      strandRelevant: parsed.checks?.strandRelevant !== false,
    },
  };
}

function containsHintLikeLanguage(value: string): boolean {
  const text = value.toLowerCase();
  return [
    "remember to",
    "think about",
    "you can use",
    "start by",
    "for example",
    "hint",
    "first,",
    "next,",
  ].some((phrase) => text.includes(phrase));
}

function containsAnswerLeak(promptText: string, answerText: string): boolean {
  const prompt = cleanText(promptText).toLowerCase();
  const answer = cleanText(answerText).toLowerCase();
  if (!prompt || !answer) return false;
  if (answer.length <= 1) return false;
  return prompt.includes(answer);
}

function fallbackResult(input: AssessmentWrapperInput, reason?: string): AssessmentWrapperResult {
  const hasQuestionText =
    cleanText(input.canonical.promptText).length > 0 &&
    cleanText(input.canonical.answerText).length > 0;

  if (!hasQuestionText) {
    return {
      decision: "skip",
      displayPromptText: "",
      skipReason: reason || "Canonical question is missing prompt or answer text.",
      source: "fallback",
      checks: {
        logicCorrect: false,
        ageRelevant: false,
        objectiveRelevant: false,
        strandRelevant: false,
      },
    };
  }

  return {
    decision: "ask",
    displayPromptText: normalizePromptForDisplay(input.canonical.promptText),
    source: "fallback",
    checks: {
      logicCorrect: true,
      ageRelevant: true,
      objectiveRelevant: true,
      strandRelevant: true,
    },
  };
}

function sanitizeWrapperResult(
  input: AssessmentWrapperInput,
  result: AssessmentWrapperResult
): AssessmentWrapperResult {
  if (result.decision === "skip") {
    return {
      ...result,
      displayPromptText: "",
      skipReason: result.skipReason || "Wrapper review flagged the question.",
    };
  }

  const prompt = normalizePromptForDisplay(result.displayPromptText);

  if (!prompt) {
    return fallbackResult(input, "Wrapper returned an empty display prompt.");
  }

  if (containsAnswerLeak(prompt, input.canonical.answerText) || containsHintLikeLanguage(prompt)) {
    return fallbackResult(
      input,
      "Wrapper prompt leaked the answer or included hint-like language."
    );
  }

  return {
    ...result,
    displayPromptText: prompt,
  };
}

export async function reviewAndWrapAssessmentQuestion(
  input: AssessmentWrapperInput
): Promise<AssessmentWrapperResult> {
  if (!hasLlmConfig()) {
    return fallbackResult(input);
  }

  try {
    const llmResult = await callWrapperLlm(input);
    return sanitizeWrapperResult(input, llmResult);
  } catch {
    return fallbackResult(input);
  }
}
