import { Router } from "express";
import { z } from "zod";
import { Subject } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { buildCombinedChildProfile } from "../services/childProfile.service.js";
import {
  createWrapperVector,
  createInterestFactorVectors,
  deleteWrapperVector,
  listWrapperVectors,
  updateWrapperVector,
} from "../services/wrapperVector.service.js";

export const profileRouter = Router();

const childSummaryQuerySchema = z.object({
  studentId: z.string().min(1),
  subject: z.nativeEnum(Subject).optional(),
  assessmentSessionId: z.string().trim().min(1).optional(),
  ndscreenSessionId: z.string().trim().min(1).optional(),
});

const wrapperVectorQuerySchema = z.object({
  studentId: z.string().trim().min(1),
});

const createWrapperVectorSchema = z.object({
  studentId: z.string().trim().min(1),
  objectiveId: z.string().trim().min(1).optional(),
  title: z.string().trim().min(1),
  content: z.string().trim().min(1),
  scope: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  strand: z.string().trim().min(1).optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

const createInterestFactorsSchema = z.object({
  studentId: z.string().trim().min(1),
  category: z.string().trim().min(1),
  primaryFactor: z.string().trim().min(1),
  secondaryFactor: z.string().trim().min(1),
  notes: z.string().trim().min(1).optional(),
});

const updateWrapperVectorSchema = z.object({
  title: z.string().trim().min(1).optional(),
  content: z.string().trim().min(1).optional(),
  scope: z.string().trim().min(1).optional(),
  source: z.string().trim().min(1).optional(),
  strand: z.string().trim().nullable().optional(),
  objectiveId: z.string().trim().nullable().optional(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  isActive: z.boolean().optional(),
});

profileRouter.get("/child-summary", async (req, res) => {
  const parsed = childSummaryQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const summary = await buildCombinedChildProfile(parsed.data);
    return res.json(summary);
  } catch (error) {
    console.error("Failed to build combined child profile:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to build child profile",
    });
  }
});

profileRouter.get("/wrapper-vectors", async (req, res) => {
  const parsed = wrapperVectorQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await listWrapperVectors(parsed.data.studentId);
    return res.json(result);
  } catch (error) {
    console.error("Failed to load wrapper vectors:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load wrapper vectors",
    });
  }
});

profileRouter.post("/wrapper-vectors", async (req, res) => {
  const parsed = createWrapperVectorSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await createWrapperVector(parsed.data);
    return res.status(201).json(result);
  } catch (error) {
    console.error("Failed to create wrapper vector:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to create wrapper vector",
    });
  }
});

profileRouter.post("/interest-factors", async (req, res) => {
  const parsed = createInterestFactorsSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await createInterestFactorVectors(parsed.data);
    return res.status(201).json(result);
  } catch (error) {
    console.error("Failed to create interest factor vectors:", error);
    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to create interest factor vectors",
    });
  }
});

profileRouter.patch("/wrapper-vectors/:vectorId", async (req, res) => {
  const parsed = updateWrapperVectorSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await updateWrapperVector({
      vectorId: String(req.params.vectorId),
      ...parsed.data,
    });
    return res.json(result);
  } catch (error) {
    console.error("Failed to update wrapper vector:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to update wrapper vector",
    });
  }
});

profileRouter.delete("/wrapper-vectors/:vectorId", async (req, res) => {
  try {
    const result = await deleteWrapperVector(String(req.params.vectorId));
    return res.json(result);
  } catch (error) {
    console.error("Failed to delete wrapper vector:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to delete wrapper vector",
    });
  }
});

profileRouter.get("/me", requireAuth, async (req, res) => {
  const userId = req.auth!.sub;

  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      student: {
        include: {
          preferences: true,
        },
      },
    },
  });

  if (!user) return res.status(404).json({ error: "User not found" });

  res.json({
    user: { id: user.id, email: user.email, role: user.role },
    student: user.student,
  });
});
