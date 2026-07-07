import type { NextFunction, Request, Response } from "express";
import { env } from "../lib/env.js";

function readApiKey(req: Request): string | null {
  const headerValue = req.header("x-api-key")?.trim();
  if (headerValue) return headerValue;

  const authHeader = req.header("authorization")?.trim();
  if (authHeader?.startsWith("ApiKey ")) {
    return authHeader.slice("ApiKey ".length).trim();
  }

  return null;
}

export function requireApiKey(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const providedKey = readApiKey(req);

  if (!providedKey) {
    return res.status(401).json({ error: "Missing API key" });
  }

  if (providedKey !== env.MYLISA_API_KEY) {
    return res.status(401).json({ error: "Invalid API key" });
  }

  next();
}
