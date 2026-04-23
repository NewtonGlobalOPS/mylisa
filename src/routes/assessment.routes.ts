import { Router } from "express";
import { z } from "zod";
import {
  answerMathsAssessment,
  getAssessmentSession,
  startMathsAssessment,
} from "../assessment/assessmentService.js";

export const assessmentRouter = Router();

const startSchema = z.object({
  studentId: z.string().min(1),
  childCurrentYear: z.number().int().min(1).max(13),
});

const answerSchema = z.object({
  sessionId: z.string().min(1),
  questionId: z.string().min(1),
  selectedChoiceKey: z.enum(["A", "B", "C", "D"]),
});

assessmentRouter.post("/api/assessment/start", async (req, res) => {
  const parsed = startSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await startMathsAssessment(parsed.data);

    return res.json({
      sessionId: result.session.sessionId,
      entryYear: result.session.entryYear,
      maxQuestions: result.session.maxQuestions,
      extensionMaxQuestions: result.session.extensionMaxQuestions,
      firstQuestion: result.firstQuestion,
    });
  } catch (error) {
    console.error("Failed to start assessment:", error);
    return res.status(500).json({
      error:
        error instanceof Error ? error.message : "Failed to start assessment",
    });
  }
});

assessmentRouter.post("/api/assessment/answer", async (req, res) => {
  const parsed = answerSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await answerMathsAssessment(parsed.data);

    return res.json({
      isCorrect: result.isCorrect,
      correctAnswer: result.correctAnswer,
      isComplete: result.isComplete,
      nextQuestion: result.nextQuestion,
      result: result.result,
      askedCount: result.session.responses.length,
      overallConfidence: result.session.overallConfidence,
      overallWorkingBand: result.session.overallWorkingBand,
    });
  } catch (error) {
    console.error("Failed to submit assessment answer:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to submit answer",
    });
  }
});

assessmentRouter.get("/api/assessment/:sessionId", async (req, res) => {
  try {
    const session = await getAssessmentSession(req.params.sessionId);

    return res.json({
      sessionId: session.sessionId,
      isComplete: session.isComplete,
      askedCount: session.responses.length,
      entryYear: session.entryYear,
      overallConfidence: session.overallConfidence,
      overallWorkingBand: session.overallWorkingBand,
      strands: session.strands,
    });
  } catch (error) {
    console.error("Failed to load assessment session:", error);
    return res.status(404).json({ error: "Session not found" });
  }
});
