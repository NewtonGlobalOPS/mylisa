import { Router } from "express";
import { prisma } from "../lib/prisma.js";
import { requireAuth } from "../middleware/auth.js";

export const profileRouter = Router();

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
