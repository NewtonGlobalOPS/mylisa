import { Router } from "express";
import { z } from "zod";
import type { KeyStage, Subject } from "@prisma/client";
import {
  getOakCurriculumObjectiveDetail,
  listOakCurriculumObjectives,
  resolveOakCurriculumObjective,
  searchOakCurriculumStrands,
} from "../services/curriculumExplorer.service.js";
import {
  buildLessonDeliveryPlan,
  buildLessonDeliveryPlanFromSelection,
} from "../services/lessonDelivery.service.js";
import {
  buildLessonRuntimeByObjective,
  buildLessonRuntimeBySelection,
} from "../services/lessonRuntime.service.js";
import {
  buildBespokeLesson,
  generateBespokeSectionContent,
} from "../services/bespokeLessonBuilder.service.js";

export const curriculumRouter = Router();

const subjectSchema = z.enum(["MATHS", "SCIENCE", "COMPUTING", "ENGLISH"]);
const keyStageSchema = z.enum(["KS1", "KS2", "KS3", "KS4"]);
const mathsDomainSchema = z.enum([
  "NUMBER",
  "ALGEBRA",
  "GEOMETRY",
  "DATA",
  "RATIO",
  "PROBABILITY",
]);

const listObjectivesQuerySchema = z.object({
  organisationSlug: z.string().trim().min(1).optional(),
  subject: subjectSchema.optional(),
  keyStage: keyStageSchema.optional(),
  yearGroup: z.coerce.number().int().min(1).max(13).optional(),
  domain: mathsDomainSchema.optional(),
  strand: z.string().trim().min(1).optional(),
  search: z.string().trim().min(1).optional(),
  hasContent: z.coerce.boolean().optional(),
  hasCanonical: z.coerce.boolean().optional(),
  limit: z.coerce.number().int().min(1).max(250).optional(),
});

const objectiveDetailQuerySchema = z.object({
  organisationSlug: z.string().trim().min(1).optional(),
});

const searchStrandsQuerySchema = listObjectivesQuerySchema.extend({
  limit: z.coerce.number().int().min(1).max(250).optional(),
});

const deliveryQuerySchema = z.object({
  studentId: z.string().trim().min(1),
  assessmentSessionId: z.string().trim().min(1).optional(),
  ndscreenSessionId: z.string().trim().min(1).optional(),
  selectedChunkIds: z.string().trim().min(1).optional(),
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
  selectedChunkIds: z.string().trim().min(1).optional(),
});

const bespokeLessonSchema = z.object({
  topic: z.string().trim().min(2).max(300),
  subject: subjectSchema.default("MATHS"),
  keyStage: keyStageSchema.optional(),
  yearGroup: z.coerce.number().int().min(1).max(13).optional(),
  domain: mathsDomainSchema.optional(),
  maxObjectives: z.coerce.number().int().min(1).max(8).optional(),
});

const bespokeSectionContentSchema = z.object({
  topic: z.string().trim().min(2).max(1000),
  subject: subjectSchema.default("MATHS"),
  keyStage: keyStageSchema.nullish(),
  yearGroup: z.coerce.number().int().min(1).max(13).nullish(),
  guideTitle: z.string().trim().max(1000).nullish(),
  section: z.object({
    title: z.string().trim().min(1).max(500),
    durationMinutes: z.coerce.number().int().min(1).max(120),
    teacherActions: z.array(z.string().trim().min(1).max(2000)).max(30).default([]),
    studentActions: z.array(z.string().trim().min(1).max(2000)).max(30).default([]),
    workedExample: z
      .object({
        problem: z.string().trim().max(4000),
        steps: z.array(z.string().trim().min(1).max(2000)).max(30),
        answer: z.string().trim().max(4000),
      })
      .nullish()
      .transform((value) => value ?? undefined)
      .optional(),
  }),
  objectives: z
    .array(
      z.object({
        code: z.string().trim().max(1000),
        title: z.string().trim().max(2000),
        statement: z.string().trim().max(4000),
        strand: z.string().trim().max(1000),
        keyStage: keyStageSchema,
        yearGroup: z.number().int().min(1).max(13).nullable(),
      }),
    )
    .max(8)
    .optional(),
  questions: z
    .array(
      z.object({
        id: z.string().trim().max(1000),
        promptText: z.string().trim().max(5000),
        answerText: z.string().trim().max(5000),
        difficulty: z.string().trim().max(80),
        objectiveCode: z.string().trim().max(1000),
      }),
    )
    .max(12)
    .optional(),
});

function parseSelectedChunkIds(value?: string): string[] | undefined {
  const ids = (value ?? "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  return ids.length > 0 ? Array.from(new Set(ids)) : undefined;
}

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
      domain: parsed.data.domain,
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

curriculumRouter.get("/api/curriculum/strands", async (req, res) => {
  const parsed = searchStrandsQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await searchOakCurriculumStrands({
      organisationSlug: parsed.data.organisationSlug,
      subject: parsed.data.subject as Subject | undefined,
      keyStage: parsed.data.keyStage as KeyStage | undefined,
      yearGroup: parsed.data.yearGroup,
      domain: parsed.data.domain,
      strand: parsed.data.strand,
      search: parsed.data.search,
      hasContent: parsed.data.hasContent,
      hasCanonical: parsed.data.hasCanonical,
      limit: parsed.data.limit,
    });

    return res.json(result);
  } catch (error) {
    console.error("Failed to search Oak curriculum strands:", error);
    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to search Oak curriculum strands",
    });
  }
});

curriculumRouter.post("/api/curriculum/bespoke-lesson", async (req, res) => {
  const parsed = bespokeLessonSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await buildBespokeLesson({
      topic: parsed.data.topic,
      subject: parsed.data.subject as Subject,
      keyStage: parsed.data.keyStage as KeyStage | undefined,
      yearGroup: parsed.data.yearGroup,
      domain: parsed.data.domain,
      maxObjectives: parsed.data.maxObjectives,
    });

    return res.json(result);
  } catch (error) {
    console.error("Failed to build bespoke lesson:", error);
    return res.status(400).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to build bespoke lesson",
    });
  }
});

curriculumRouter.post("/api/curriculum/bespoke-lesson/section-content", async (req, res) => {
  const parsed = bespokeSectionContentSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await generateBespokeSectionContent({
      topic: parsed.data.topic,
      subject: parsed.data.subject as Subject,
      keyStage: parsed.data.keyStage as KeyStage | null | undefined,
      yearGroup: parsed.data.yearGroup,
      guideTitle: parsed.data.guideTitle ?? undefined,
      section: parsed.data.section,
      objectives: parsed.data.objectives,
      questions: parsed.data.questions,
    });

    return res.json(result);
  } catch (error) {
    console.error("Failed to generate bespoke section content:", error);
    return res.status(400).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to generate bespoke section content",
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
        selectedChunkIds: parseSelectedChunkIds(parsed.data.selectedChunkIds),
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
        selectedChunkIds: parseSelectedChunkIds(parsed.data.selectedChunkIds),
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
      selectedChunkIds: parseSelectedChunkIds(parsed.data.selectedChunkIds),
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
      selectedChunkIds: parseSelectedChunkIds(parsed.data.selectedChunkIds),
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
