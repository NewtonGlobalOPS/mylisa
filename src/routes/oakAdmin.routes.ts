// src/routes/oakAdmin.routes.ts
import { Router } from "express";
import { requireAuth, requireRole } from "../middleware/auth.js";
import { syncOakForStems } from "../services/oakSync.service.js";

const router = Router();

/**
 * POST /api/admin/oak/sync
 * Kicks off a synchronous sync (safe for dev).
 * For production, you can wrap into a job queue later.
 */
router.post(
  "/sync",
  requireAuth,
  requireRole(["ADMIN", "DIRECTOR"]),
  async (_req, res) => {
    const stats = await syncOakForStems();
    res.json({ ok: true, stats });
  },
);

export default router;
