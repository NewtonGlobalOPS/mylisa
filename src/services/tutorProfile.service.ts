import { prisma } from "../lib/prisma.js";
import type { TutoringMode } from "@prisma/client";

export async function buildTutorProfileCard(userId: string) {
  const user = await prisma.user.findUnique({
    where: { id: userId },
    include: {
      student: {
        include: {
          preferences: true,
          mastery: {
            orderBy: { masteryScore: "asc" },
            take: 3,
            include: { objective: true },
          },
        },
      },
    },
  });

  if (!user?.student) {
    throw new Error("Student not found for user");
  }

  const student = user.student;

  const weakestObjectives = student.mastery.map((m) => ({
    objectiveId: m.objectiveId,
    code: m.objective.code,
    mastery: m.masteryScore,
  }));

  const mode = computeTutoringMode(student);

  return {
    student: {
      id: student.id,
      age: student.age,
      keyStage: student.keyStage,
      subjects: student.subjects,
    },
    delivery: {
      mode,
      verbosity: student.preferences?.verbosity ?? "LOW",
      stepSize: student.preferences?.stepSize ?? "SMALL",
      lowStimulus: student.preferences?.lowStimulus ?? true,
      useBullets: student.preferences?.useBullets ?? true,
    },
    weaknesses: weakestObjectives,
  };
}

function computeTutoringMode(student: {
  preferences?: { tutoringMode: TutoringMode } | null;
  mastery: Array<{ masteryScore: number }>;
}): TutoringMode {
  if (!student.preferences) return "AUTO";

  if (student.preferences.tutoringMode !== "AUTO") {
    return student.preferences.tutoringMode;
  }

  // Simple initial logic
  const lowMastery = student.mastery.some((m) => m.masteryScore < 0.4);

  if (lowMastery) return "GENTLE";

  return "COACH";
}
