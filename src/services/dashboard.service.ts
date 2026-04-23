import { AttemptStatus, Subject, TaskType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

function normalizeSearch(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function inferSchoolYear(age: number | null | undefined): number | null {
  if (typeof age !== "number" || !Number.isFinite(age)) return null;
  const year = age - 4;
  return year >= 1 && year <= 13 ? year : null;
}

export async function searchLearnersForDashboard(input?: {
  query?: string;
  limit?: number;
}) {
  const query = normalizeSearch(input?.query);
  const limit = Math.min(Math.max(input?.limit ?? 20, 1), 50);

  const learners = await prisma.student.findMany({
    where: {
      ...(query
        ? {
            OR: [
              { firstName: { contains: query, mode: "insensitive" } },
              { lastName: { contains: query, mode: "insensitive" } },
              { guardianEmail: { contains: query, mode: "insensitive" } },
              {
                user: {
                  email: {
                    contains: query,
                    mode: "insensitive",
                  },
                },
              },
              {
                integrationLinks: {
                  some: {
                    externalId: {
                      contains: query,
                    },
                  },
                },
              },
              {
                attempts: {
                  some: {
                    id: {
                      contains: query,
                    },
                  },
                },
              },
            ],
          }
        : {}),
    },
    take: limit,
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      age: true,
      keyStage: true,
      subjects: true,
      guardianEmail: true,
      user: {
        select: {
          id: true,
          email: true,
        },
      },
      integrationLinks: {
        orderBy: [{ updatedAt: "desc" }],
        take: 3,
        select: {
          externalId: true,
          externalType: true,
          ndscreenSessionId: true,
          updatedAt: true,
        },
      },
      attempts: {
        where: {
          taskType: TaskType.ASSESSMENT,
          subject: Subject.MATHS,
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 3,
        select: {
          id: true,
          status: true,
          score: true,
          createdAt: true,
          updatedAt: true,
          submittedAt: true,
        },
      },
      _count: {
        select: {
          attempts: true,
        },
      },
    },
  });

  return {
    query: query ?? null,
    count: learners.length,
    items: learners.map((learner) => {
      const latestAssessment = learner.attempts[0] ?? null;

      return {
        studentId: learner.id,
        userId: learner.user.id,
        userEmail: learner.user.email,
        firstName: learner.firstName,
        lastName: learner.lastName,
        displayName:
          [learner.firstName, learner.lastName].filter(Boolean).join(" ").trim() ||
          learner.user.email,
        guardianEmail: learner.guardianEmail,
        age: learner.age,
        schoolYear: inferSchoolYear(learner.age),
        keyStage: learner.keyStage,
        subjects: learner.subjects,
        bookingIds: learner.integrationLinks.map((link) => link.externalId),
        ndscreenSessionId:
          learner.integrationLinks.find((link) => link.ndscreenSessionId)?.ndscreenSessionId ??
          null,
        latestAssessment: latestAssessment
          ? {
              id: latestAssessment.id,
              status: latestAssessment.status,
              isSubmitted: latestAssessment.status === AttemptStatus.SUBMITTED,
              score: latestAssessment.score,
              createdAt: latestAssessment.createdAt.toISOString(),
              updatedAt: latestAssessment.updatedAt.toISOString(),
              submittedAt: latestAssessment.submittedAt?.toISOString() ?? null,
            }
          : null,
        assessmentCount: learner.attempts.length,
        totalAttemptCount: learner._count.attempts,
      };
    }),
  };
}
