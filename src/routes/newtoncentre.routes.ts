import { Router } from "express";
import { z } from "zod";
import {
  assertNewtonCentreWebhookSecret,
  importNewtonCentreBooking,
} from "../services/newtoncentreBooking.service.js";

const syncBodySchema = z.object({
  bookingId: z.string().min(1),
});

export const newtonCentreRouter = Router();

newtonCentreRouter.post("/api/integrations/newtoncentre/bookings/import", async (req, res) => {
  try {
    assertNewtonCentreWebhookSecret(
      req.header("x-newtoncentre-webhook-secret") ?? undefined,
    );

    const body = syncBodySchema.parse(req.body ?? {});
    const out = await importNewtonCentreBooking(body.bookingId);
    return res.status(200).json(out);
  } catch (error: any) {
    const message = error?.message ?? "Newton Centre booking import failed";
    const status =
      message === "Unauthorized integration request"
        ? 401
        : message.includes("does not require MyLisa")
          ? 409
          : 400;

    return res.status(status).json({ error: message });
  }
});
