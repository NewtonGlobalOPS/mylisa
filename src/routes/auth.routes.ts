import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { Role } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";
import { signInNewtonCentreStudent } from "../services/newtoncentreStudentAuth.service.js";

export const authRouter = Router();

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  age: z.number().int().min(4).max(18),
  subjects: z.array(z.enum(["MATHS", "SCIENCE", "COMPUTING", "ENGLISH"])).min(
    1,
  ),
  firstName: z.string().optional(),
  lastName: z.string().optional(),
});

const googleStudentLoginSchema = z.object({
  idToken: z.string().min(20),
});

async function getDefaultOrganisationId(): Promise<string> {
  const organisation = await prisma.organisation.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  if (!organisation) {
    throw new Error("No active organisation found.");
  }

  return organisation.id;
}



authRouter.post("/login", async (req, res) => {
  const body = loginSchema.parse(req.body);
  const email = body.email.toLowerCase();

  const user = await prisma.user.findUnique({
    where: { email },
    select: {
      id: true,
      role: true,
      email: true,
      passwordHash: true,
      isActive: true,
      student: { select: { id: true } },
    },
  });

  if (!user?.isActive) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  const ok = await bcrypt.compare(body.password, user.passwordHash);
  if (!ok) {
    return res.status(401).json({ error: "Invalid email or password" });
  }

  await prisma.user.update({
    where: { id: user.id },
    data: { lastLoginAt: new Date() },
  });

  const token = jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    env.JWT_SECRET,
    { expiresIn: "7d" },
  );

  res.json({
    token,
    user: {
      id: user.id,
      email: user.email,
      role: user.role,
      studentId: user.student?.id ?? null,
    },
  });
});

authRouter.post("/google/student", async (req, res) => {
  const parsed = googleStudentLoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "Validation failed", issues: parsed.error.issues });
  }

  try {
    const user = await signInNewtonCentreStudent(parsed.data.idToken);
    if (!user.isActive || user.role !== Role.STUDENT || !user.student) {
      return res.status(403).json({ error: "Google account is not linked to a student." });
    }

    const token = jwt.sign(
      { sub: user.id, role: user.role, email: user.email },
      env.JWT_SECRET,
      { expiresIn: "7d" },
    );

    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        studentId: user.student.id,
      },
      student: {
        message: "Student signed in with Google",
        userId: user.id,
        studentId: user.student.id,
        email: user.email,
        student: user.student,
      },
    });
  } catch (error) {
    console.error("Google student login failed:", error);
    return res.status(401).json({
      error: error instanceof Error ? error.message : "Google sign-in failed.",
    });
  }
});

authRouter.post("/register", async (req, res) => {
  const body = registerSchema.parse(req.body);

  const email = body.email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing)
    return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(body.password, 12);
  const organisationId = await getDefaultOrganisationId();

  const user = await prisma.user.create({
    data: {
      organisationId,
      email,
      passwordHash,
      role: Role.STUDENT,
      student: {
        create: {
          organisationId,
          age: body.age,
          subjects: body.subjects, // enums: ["MATHS","SCIENCE"...]
          firstName: body.firstName,
          lastName: body.lastName,
          // keyStage can be derived later; keep null for now
          preferences: {
            create: {
              tutoringMode: "AUTO",
              verbosity: "LOW",
              stepSize: "SMALL",
              lowStimulus: true,
              useBullets: true,
              moreExamples: true,
              frequentCheckIns: true,
            },
          },
          mastery: {
            create: [], // optional; can seed later on-demand
          },
        },
      },
    },
    select: {
      id: true,
      role: true,
      email: true,
      student: {
        select: {
          id: true,
        },
      },
    },
  });

  const token = jwt.sign(
    { sub: user.id, role: user.role, email: user.email },
    env.JWT_SECRET,
    { expiresIn: "7d" },
  );

  res.json({
    token,
    userId: user.id,
    studentId: user.student?.id,
  });
});
