import { Router } from "express";
import { z } from "zod";
import { searchLearnersForDashboard } from "../services/dashboard.service.js";

export const dashboardRouter = Router();

const learnerLookupQuerySchema = z.object({
  query: z.string().trim().optional(),
  limit: z.coerce.number().int().min(1).max(50).optional(),
});

dashboardRouter.get("/api/dashboard/learners", async (req, res) => {
  const parsed = learnerLookupQuerySchema.safeParse(req.query);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await searchLearnersForDashboard({
      query: parsed.data.query,
      limit: parsed.data.limit,
    });

    return res.json(result);
  } catch (error) {
    console.error("Failed to search dashboard learners:", error);
    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to search dashboard learners",
    });
  }
});
