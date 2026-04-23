import { Router } from "express";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";
import { buildCombinedChildProfile } from "../services/childProfile.service.js";

export const profileRouter = Router();

const childSummaryQuerySchema = z.object({
  studentId: z.string().min(1),
  assessmentSessionId: z.string().trim().min(1).optional(),
  ndscreenSessionId: z.string().trim().min(1).optional(),
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
