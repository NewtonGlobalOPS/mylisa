import { Router } from "express";
import { z } from "zod";
import type { KeyStage, Subject } from "@prisma/client";
import {
  getOakCurriculumObjectiveDetail,
  listOakCurriculumObjectives,
  resolveOakCurriculumObjective,
} from "../services/curriculumExplorer.service.js";
import {
  buildLessonDeliveryPlan,
  buildLessonDeliveryPlanFromSelection,
} from "../services/lessonDelivery.service.js";
import {
  buildLessonRuntimeByObjective,
  buildLessonRuntimeBySelection,
} from "../services/lessonRuntime.service.js";

export const curriculumRouter = Router();

const subjectSchema = z.enum(["MATHS", "SCIENCE", "COMPUTING", "ENGLISH"]);
const keyStageSchema = z.enum(["KS1", "KS2", "KS3", "KS4"]);

const listObjectivesQuerySchema = z.object({
  organisationSlug: z.string().trim().min(1).optional(),
  subject: subjectSchema.optional(),
  keyStage: keyStageSchema.optional(),
  yearGroup: z.coerce.number().int().min(1).max(13).optional(),
  strand: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  hasContent: z.coerce.boolean().optional(),
  hasCanonical: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(250).optional(),
});

const objectiveDetailQuerySchema = z.object({
  organisationSlug: z.string().trim().min(1).optional(),
});

const deliveryQuerySchema = z.object({
  studentId: z.string().trim().min(1),
  assessmentSessionId: z.string().trim().min(1).optional(),
  ndscreenSessionId: z.string().trim().min(1).optional(),
});

const resolveObjectiveQuerySchema = z.object({
  organisationSlug: z.string().trim().min(1).optional(),
  subject: subjectSchema.optional(),
  keyStage: keyStageSchema.optional(),
  yearGroup: z.coerce.number().int().min(1).max(13).optional(),
  strand: z.string().trim().min(1).optional(),
  objectiveCode: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  requireCanonical: z.coerce.boolean().optional(),
  requireContent: z.coerce.boolean().optional(),
});

const resolveDeliveryQuerySchema = resolveObjectiveQuerySchema.extend({
  studentId: z.string().trim().min(1),
  assessmentSessionId: z.string().trim().min(1).optional(),
  ndscreenSessionId: z.string().trim().min(1).optional(),
});

curriculumRouter.get("/api/curriculum/objectives", async (req, res) => {
  const parsed = listObjectivesQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await listOakCurriculumObjectives({
      organisationSlug: parsed.data.organisationSlug,
      subject: parsed.data.subject as Subject | undefined,
      keyStage: parsed.data.keyStage as KeyStage | undefined,
      yearGroup: parsed.data.yearGroup,
      strand: parsed.data.strand,
      search: parsed.data.search,
      hasContent: parsed.data.hasContent,
      hasCanonical: parsed.data.hasCanonical,
      limit: parsed.data.limit,
    });

    return res.json(result);
  } catch (error) {
    console.error("Failed to list Oak curriculum objectives:", error);
    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to list Oak curriculum objectives",
    });
  }
});

curriculumRouter.get("/api/curriculum/objectives/resolve", async (req, res) => {
  const parsed = resolveObjectiveQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await resolveOakCurriculumObjective({
      organisationSlug: parsed.data.organisationSlug,
      subject: parsed.data.subject as Subject | undefined,
      keyStage: parsed.data.keyStage as KeyStage | undefined,
      yearGroup: parsed.data.yearGroup,
      strand: parsed.data.strand,
      objectiveCode: parsed.data.objectiveCode,
      search: parsed.data.search,
      requireCanonical: parsed.data.requireCanonical,
      requireContent: parsed.data.requireContent,
    });

    return res.json(result);
  } catch (error) {
    console.error("Failed to resolve Oak curriculum objective:", error);
    return res.status(404).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to resolve Oak curriculum objective",
    });
  }
});

curriculumRouter.get(
  "/api/curriculum/objectives/:objectiveId",
  async (req, res) => {
    const parsedQuery = objectiveDetailQuerySchema.safeParse(req.query);

    if (!parsedQuery.success) {
      return res.status(400).json({
        error: "Validation failed",
        issues: parsedQuery.error.issues,
      });
    }

    try {
      const result = await getOakCurriculumObjectiveDetail({
        objectiveId: String(req.params.objectiveId),
        organisationSlug: parsedQuery.data.organisationSlug,
      });

      return res.json(result);
    } catch (error) {
      console.error("Failed to load Oak curriculum objective:", error);
      return res.status(404).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to load Oak curriculum objective",
      });
    }
  },
);

curriculumRouter.get(
  "/api/curriculum/objectives/:objectiveId/delivery",
  async (req, res) => {
    const parsed = deliveryQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed",
        issues: parsed.error.issues,
      });
    }

    try {
      const result = await buildLessonDeliveryPlan({
        objectiveId: String(req.params.objectiveId),
        studentId: parsed.data.studentId,
        assessmentSessionId: parsed.data.assessmentSessionId,
        ndscreenSessionId: parsed.data.ndscreenSessionId,
      });

      return res.json(result);
    } catch (error) {
      console.error("Failed to build lesson delivery plan:", error);
      return res.status(404).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to build lesson delivery plan",
      });
    }
  },
);

curriculumRouter.get(
  "/api/curriculum/objectives/:objectiveId/runtime",
  async (req, res) => {
    const parsed = deliveryQuerySchema.safeParse(req.query);

    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed",
        issues: parsed.error.issues,
      });
    }

    try {
      const result = await buildLessonRuntimeByObjective({
        objectiveId: String(req.params.objectiveId),
        studentId: parsed.data.studentId,
        assessmentSessionId: parsed.data.assessmentSessionId,
        ndscreenSessionId: parsed.data.ndscreenSessionId,
      });

      return res.json(result);
    } catch (error) {
      console.error("Failed to build lesson runtime package:", error);
      return res.status(404).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to build lesson runtime package",
      });
    }
  },
);

curriculumRouter.get("/api/curriculum/delivery/resolve", async (req, res) => {
  const parsed = resolveDeliveryQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await buildLessonDeliveryPlanFromSelection({
      studentId: parsed.data.studentId,
      subject: parsed.data.subject as Subject | undefined,
      keyStage: parsed.data.keyStage as KeyStage | undefined,
      yearGroup: parsed.data.yearGroup,
      strand: parsed.data.strand,
      objectiveCode: parsed.data.objectiveCode,
      search: parsed.data.search,
      organisationSlug: parsed.data.organisationSlug,
      assessmentSessionId: parsed.data.assessmentSessionId,
      ndscreenSessionId: parsed.data.ndscreenSessionId,
    });

    return res.json(result);
  } catch (error) {
    console.error("Failed to resolve lesson delivery plan:", error);
    return res.status(404).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to resolve lesson delivery plan",
    });
  }
});

curriculumRouter.get("/api/curriculum/runtime/resolve", async (req, res) => {
  const parsed = resolveDeliveryQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await buildLessonRuntimeBySelection({
      studentId: parsed.data.studentId,
      subject: parsed.data.subject as Subject | undefined,
      keyStage: parsed.data.keyStage as KeyStage | undefined,
      yearGroup: parsed.data.yearGroup,
      strand: parsed.data.strand,
      objectiveCode: parsed.data.objectiveCode,
      search: parsed.data.search,
      organisationSlug: parsed.data.organisationSlug,
      assessmentSessionId: parsed.data.assessmentSessionId,
      ndscreenSessionId: parsed.data.ndscreenSessionId,
    });

    return res.json(result);
  } catch (error) {
    console.error("Failed to resolve lesson runtime package:", error);
    return res.status(404).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to resolve lesson runtime package",
    });
  }
});
