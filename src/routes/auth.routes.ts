import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";

export const authRouter = Router();

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

authRouter.post("/register", async (req, res) => {
  const body = registerSchema.parse(req.body);

  const email = body.email.toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing)
    return res.status(409).json({ error: "Email already registered" });

  const passwordHash = await bcrypt.hash(body.password, 12);

  const user = await prisma.user.create({
    data: {
      email,
      passwordHash,
      role: "STUDENT",
      student: {
        create: {
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
    include: { student: true },
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
