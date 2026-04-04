import { Router } from "express";
import { z } from "zod";
import { requireAuth } from "../middleware/auth.js";
import { buildTutorProfileCard } from "../services/tutorProfile.service.js";

export const tutorRouter = Router();

const schema = z.object({
  question: z.string().min(1),
  attempt: z.string().optional(),
});

tutorRouter.post("/check-work", requireAuth, async (req, res) => {
  const body = schema.parse(req.body);

  const profileCard = await buildTutorProfileCard(req.auth!.sub);

  res.json({
    profileCard,
    status: "stub",
    message: "LLM integration pending",
    received: {
      question: body.question,
      attempt: body.attempt ?? null,
    },
  });
});
