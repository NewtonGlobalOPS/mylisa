import { Router } from "express";
import { listNewtonCentreTimetableGroups } from "../services/newtoncentreTimetable.service.js";

export const newtonCentreTimetableRouter = Router();

newtonCentreTimetableRouter.get("/api/integrations/newtoncentre/timetable/groups", async (_req, res) => {
  try {
    const out = await listNewtonCentreTimetableGroups();
    res.set({
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
      "Expires": "0",
    });
    return res.status(200).json(out);
  } catch (error: any) {
    const message = error?.message ?? "Newton Centre timetable fetch failed";
    return res.status(500).json({ error: message });
  }
});
