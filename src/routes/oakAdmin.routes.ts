// src/routes/oakAdmin.routes.ts
import { Router } from "express";
import { z } from "zod";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { syncOakCurriculum } from "../services/oakSync.service.js";

const router = Router();
const syncSchema = z.object({
  subjects: z.array(z.string().trim().min(1)).optional(),
});

/**
 * POST /api/admin/oak/sync
 * Kicks off a synchronous sync (safe for dev).
 * For production, you can wrap into a job queue later.
 */
router.post(
  "/sync",
  requireAuth,
  requireRole(["ADMIN", "DIRECTOR"]),
  async (req, res) => {
    const body = syncSchema.parse(req.body ?? {});
    const stats = await syncOakCurriculum({ subjectSlugs: body.subjects });
    res.json({ ok: true, stats });
  },
);

export default router;
