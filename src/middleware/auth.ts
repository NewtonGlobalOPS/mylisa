import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { env } from "../lib/env.js";

export type AuthUser = { sub: string; role: string; email: string };

declare global {
  namespace Express {
    interface Request {
      auth?: AuthUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer "))
    return res.status(401).json({ error: "Missing token" });

  const token = header.slice("Bearer ".length);
  try {
    req.auth = jwt.verify(token, env.JWT_SECRET) as AuthUser;
    next();
  } catch {
    return res.status(401).json({ error: "Invalid token" });
  }
}
export function requireRole(allowed: string[]) {
  return (req: any, res: any, next: any) => {
    const role = req.auth?.role;

    if (!role) {
      return res.status(401).json({ error: "Missing authentication" });
    }

    if (!allowed.includes(role)) {
      return res.status(403).json({ error: "Forbidden" });
    }

    next();
  };
}