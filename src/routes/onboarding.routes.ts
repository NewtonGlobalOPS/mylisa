import { Router } from "express";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";
import { KeyStage, Role, Subject } from "@prisma/client";
import { importStudentFromNdscreen } from "../services/ndscreenDirect.service.js";

export const onboardingRouter = Router();

const createStudentSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).optional(),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  age: z.number().int().min(4).max(25),
  schoolYear: z.number().int().min(1).max(13),
  subjects: z.array(z.nativeEnum(Subject)).min(1).default([Subject.MATHS]),
  guardianEmail: z.string().email().optional(),
});

const importFromNdscreenSchema = z.object({
  sessionId: z.string().trim().min(1),
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

function makeTempPassword(length = 12): string {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function schoolYearToKeyStage(schoolYear: number): KeyStage {
  if (schoolYear <= 2) return KeyStage.KS1;
  if (schoolYear <= 6) return KeyStage.KS2;
  if (schoolYear <= 9) return KeyStage.KS3;
  return KeyStage.KS4;
}

onboardingRouter.post("/api/onboarding/student", async (req, res) => {
  const parsed = createStudentSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const organisationId = await getDefaultOrganisationId();
    const data = parsed.data;

    const existingUser = await prisma.user.findUnique({
      where: { email: data.email.toLowerCase() },
      select: { id: true },
    });

    if (existingUser) {
      return res.status(409).json({
        error: "A user with this email already exists",
      });
    }

    const plainPassword = data.password ?? makeTempPassword();
    const passwordHash = await bcrypt.hash(plainPassword, 10);
    const keyStage = schoolYearToKeyStage(data.schoolYear);

    const created = await prisma.user.create({
      data: {
        organisationId,
        email: data.email.toLowerCase(),
        passwordHash,
        role: Role.STUDENT,
        isActive: true,
        student: {
          create: {
            organisationId,
            firstName: data.firstName,
            lastName: data.lastName,
            age: data.age,
            schoolYear: data.schoolYear,
            keyStage,
            subjects: data.subjects,
            guardianEmail: data.guardianEmail,
          },
        },
      },
      select: {
        id: true,
        email: true,
        student: {
          select: {
            id: true,
            firstName: true,
            lastName: true,
            age: true,
            schoolYear: true,
            keyStage: true,
            subjects: true,
            guardianEmail: true,
          },
        },
      },
    });

    return res.status(201).json({
      message: "Student created successfully",
      userId: created.id,
      studentId: created.student?.id,
      email: created.email,
      temporaryPassword: data.password ? undefined : plainPassword,
      student: {
        ...created.student,
      },
    });
  } catch (error) {
    console.error("Failed to create student:", error);
    return res.status(500).json({
      error: "Failed to create student",
    });
  }
});

onboardingRouter.post("/api/onboarding/from-ndscreen", async (req, res) => {
  const parsed = importFromNdscreenSchema.safeParse(req.body);

  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const result = await importStudentFromNdscreen(parsed.data.sessionId);
    return res.status(201).json(result);
  } catch (error) {
    console.error("Failed to import student from ndscreen:", error);
    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to import student from ndscreen",
    });
  }
});
