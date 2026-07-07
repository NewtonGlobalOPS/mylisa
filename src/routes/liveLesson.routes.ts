import { Router } from "express";
import { z } from "zod";
import { Role } from "@prisma/client";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { prisma } from "../lib/prisma.js";
import {
  advanceLiveLessonBlock,
  cancelIncompleteLiveLesson,
  completeLiveLessonObjective,
  createLiveLessonSession,
  createMathsCoursePlan,
  getLiveLessonSession,
  getStudentLiveLesson,
  regenerateLiveLessonTeachingCards,
  submitLiveLessonAnswer,
  submitLiveLessonMood,
} from "../services/liveLesson.service.js";
import { createLessonPlanFromTopic } from "../services/lessonPlan.service.js";
import { buildFourWeekReviewQuiz } from "../services/lessonPlan.service.js";

export const liveLessonRouter = Router();

const coursePlanSchema = z.object({
  studentId: z.string().trim().min(1),
  assessmentSessionId: z.string().trim().min(1).optional(),
  ndscreenSessionId: z.string().trim().min(1).optional(),
});

const lessonPlanFromTopicSchema = z.object({
  studentId: z.string().trim().min(1),
  topic: z.string().trim().min(2).max(300),
  subject: z.enum(["MATHS", "SCIENCE", "COMPUTING", "ENGLISH"]).default("MATHS"),
  keyStage: z.enum(["KS1", "KS2", "KS3", "KS4"]).optional(),
  yearGroup: z.coerce.number().int().min(1).max(13).optional(),
  domain: z.enum(["NUMBER", "ALGEBRA", "GEOMETRY", "DATA", "RATIO", "PROBABILITY"]).optional(),
  maxObjectives: z.coerce.number().int().min(1).max(8).optional(),
  assessmentCadenceWeeks: z.coerce.number().int().min(1).max(12).default(4),
});

const fourWeekReviewQuizSchema = z.object({
  studentId: z.string().trim().min(1),
  subject: z.enum(["MATHS", "SCIENCE", "COMPUTING", "ENGLISH"]).default("MATHS"),
  weeks: z.coerce.number().int().min(1).max(12).default(4),
  maxQuestions: z.coerce.number().int().min(4).max(40).default(16),
});

const createLessonSchema = z.object({
  objectiveId: z.string().trim().min(1),
  studentIds: z.array(z.string().trim().min(1)).min(1),
  coursePlanId: z.string().trim().min(1).optional(),
  lessonPlanId: z.string().trim().min(1).optional(),
  assessmentSessionId: z.string().trim().min(1).optional(),
  ndscreenSessionId: z.string().trim().min(1).optional(),
  selectedChunkIds: z.array(z.string().trim().min(1)).optional(),
  title: z.string().trim().min(1).optional(),
});

const advanceBlockSchema = z.object({
  blockKey: z.string().trim().min(1),
});

const answerSchema = z.object({
  studentId: z.string().trim().min(1),
  questionId: z.string().trim().min(1),
  answerText: z.string().trim().min(1),
});

const moodSchema = z.object({
  studentId: z.string().trim().min(1),
  moodKey: z.enum(["ready", "steady", "wobbly", "stretched"]),
  moodLabel: z.string().trim().min(1).max(80),
  pacingHint: z.string().trim().min(1).max(240),
});

async function authorisedStudentId(req: { auth?: { sub: string; role: string } }, requestedStudentId: string) {
  if (req.auth?.role !== Role.STUDENT) return requestedStudentId;
  const student = await prisma.student.findUnique({
    where: { userId: req.auth.sub },
    select: { id: true },
  });
  if (!student || student.id !== requestedStudentId) {
    throw new Error("Forbidden");
  }
  return student.id;
}

liveLessonRouter.post(
  "/api/course-plans/maths/from-assessment",
  requireAuth,
  requireRole(["STAFF", "ADMIN"]),
  async (req, res) => {
    const parsed = coursePlanSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    }

    try {
      const result = await createMathsCoursePlan(parsed.data);
      return res.status(201).json(result);
    } catch (error) {
      console.error("Failed to create Maths course plan:", error);
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to create Maths course plan",
      });
    }
  },
);

liveLessonRouter.post(
  "/api/lesson-plans/from-topic",
  requireAuth,
  requireRole(["STAFF", "ADMIN"]),
  async (req, res) => {
    const parsed = lessonPlanFromTopicSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    }

    try {
      const result = await createLessonPlanFromTopic({
        tutorUserId: req.auth!.sub,
        ...parsed.data,
      });
      return res.status(201).json(result);
    } catch (error) {
      console.error("Failed to create lesson plan:", error);
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to create lesson plan",
      });
    }
  },
);

liveLessonRouter.post(
  "/api/lesson-plans/four-week-review-quiz",
  requireAuth,
  requireRole(["STAFF", "ADMIN"]),
  async (req, res) => {
    const parsed = fourWeekReviewQuizSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    }

    try {
      const result = await buildFourWeekReviewQuiz({
        tutorUserId: req.auth!.sub,
        ...parsed.data,
      });
      return res.json(result);
    } catch (error) {
      console.error("Failed to build four-week review quiz:", error);
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to build four-week review quiz",
      });
    }
  },
);

liveLessonRouter.post(
  "/api/live-lessons",
  requireAuth,
  requireRole(["STAFF", "ADMIN"]),
  async (req, res) => {
    const parsed = createLessonSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    }

    try {
      const result = await createLiveLessonSession({
        tutorUserId: req.auth!.sub,
        ...parsed.data,
      });
      return res.status(201).json(result);
    } catch (error) {
      console.error("Failed to create live lesson:", error);
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to create live lesson",
      });
    }
  },
);

liveLessonRouter.get(
  "/api/live-lessons/:lessonSessionId",
  requireAuth,
  async (req, res) => {
    try {
      const result = await getLiveLessonSession(String(req.params.lessonSessionId));
      return res.json(result);
    } catch (error) {
      return res.status(404).json({
        error: error instanceof Error ? error.message : "Live lesson session not found",
      });
    }
  },
);

liveLessonRouter.post(
  "/api/live-lessons/:lessonSessionId/blocks",
  requireAuth,
  requireRole(["STAFF", "ADMIN"]),
  async (req, res) => {
    const parsed = advanceBlockSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    }

    try {
      const result = await advanceLiveLessonBlock({
        lessonSessionId: String(req.params.lessonSessionId),
        tutorUserId: req.auth!.sub,
        blockKey: parsed.data.blockKey,
      });
      return res.json(result);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to advance lesson block",
      });
    }
  },
);

liveLessonRouter.post(
  "/api/live-lessons/:lessonSessionId/complete-objective",
  requireAuth,
  requireRole(["STAFF", "ADMIN"]),
  async (req, res) => {
    try {
      const result = await cancelIncompleteLiveLesson({
        lessonSessionId: String(req.params.lessonSessionId),
        tutorUserId: req.auth!.sub,
      });
      return res.json(result);
    } catch (error) {
      return res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to complete lesson objective",
      });
    }
  },
);

liveLessonRouter.post(
  "/api/live-lessons/:lessonSessionId/end",
  requireAuth,
  requireRole(["STAFF", "ADMIN"]),
  async (req, res) => {
    try {
      const result = await completeLiveLessonObjective({
        lessonSessionId: String(req.params.lessonSessionId),
        tutorUserId: req.auth!.sub,
      });
      return res.json(result);
    } catch (error) {
      return res.status(400).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to end live lesson",
      });
    }
  },
);

liveLessonRouter.post(
  "/api/live-lessons/:lessonSessionId/regenerate-teaching-cards",
  requireAuth,
  requireRole(["STAFF", "ADMIN"]),
  async (req, res) => {
    try {
      const result = await regenerateLiveLessonTeachingCards({
        lessonSessionId: String(req.params.lessonSessionId),
        tutorUserId: req.auth!.sub,
      });
      return res.json(result);
    } catch (error) {
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to regenerate teaching cards",
      });
    }
  },
);

liveLessonRouter.get(
  "/api/live-lessons/:lessonSessionId/students/:studentId",
  requireAuth,
  async (req, res) => {
    try {
      const studentId = await authorisedStudentId(req, String(req.params.studentId));
      const result = await getStudentLiveLesson({
        lessonSessionId: String(req.params.lessonSessionId),
        studentId,
      });
      return res.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "Forbidden") {
        return res.status(403).json({ error: "Forbidden" });
      }
      return res.status(404).json({
        error: error instanceof Error ? error.message : "Student live lesson not found",
      });
    }
  },
);

liveLessonRouter.post(
  "/api/live-lessons/:lessonSessionId/mood",
  requireAuth,
  async (req, res) => {
    const parsed = moodSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    }

    try {
      const studentId = await authorisedStudentId(req, parsed.data.studentId);
      const result = await submitLiveLessonMood({
        lessonSessionId: String(req.params.lessonSessionId),
        ...parsed.data,
        studentId,
      });
      return res.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "Forbidden") {
        return res.status(403).json({ error: "Forbidden" });
      }
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to submit mood check-in",
      });
    }
  },
);


liveLessonRouter.post(
  "/api/live-lessons/:lessonSessionId/answers",
  requireAuth,
  async (req, res) => {
    const parsed = answerSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
    }

    try {
      const studentId = await authorisedStudentId(req, parsed.data.studentId);
      const result = await submitLiveLessonAnswer({
        lessonSessionId: String(req.params.lessonSessionId),
        ...parsed.data,
        studentId,
      });
      return res.json(result);
    } catch (error) {
      if (error instanceof Error && error.message === "Forbidden") {
        return res.status(403).json({ error: "Forbidden" });
      }
      return res.status(400).json({
        error: error instanceof Error ? error.message : "Failed to submit live lesson answer",
      });
    }
  },
);
