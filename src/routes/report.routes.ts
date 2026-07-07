import { Router } from "express";
import type { Response } from "express";
import { z } from "zod";
import { AttemptStatus, IntegrationSource, Subject, TaskType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { requireApiKey } from "../middleware/apiKey.js";
import { buildCombinedChildProfile } from "../services/childProfile.service.js";
import {
  createAssessmentReportPdf,
  createProgressReportPdf,
  createStoredReport,
  getStoredReportFileById,
  getStoredReportFileByPublicToken,
  listStoredReports,
} from "../services/storedReport.service.js";

export const reportRouter = Router();
export const publicReportRouter = Router();

const createReportSchema = z.object({
  studentId: z.string().trim().min(1),
  subject: z.nativeEnum(Subject).optional(),
  assessmentSessionId: z.string().trim().min(1).optional(),
  ndscreenSessionId: z.string().trim().min(1).optional(),
});

const listReportQuerySchema = z.object({
  studentId: z.string().trim().min(1),
  subject: z.nativeEnum(Subject).optional(),
});

const progressReportQuerySchema = z.object({
  studentId: z.string().trim().min(1),
  subject: z.nativeEnum(Subject).optional(),
});

const assessmentReportPdfQuerySchema = z.object({
  studentId: z.string().trim().min(1),
  subject: z.nativeEnum(Subject).optional(),
  assessmentSessionId: z.string().trim().min(1).optional(),
  ndscreenSessionId: z.string().trim().min(1).optional(),
});

const newtonCentreReportsQuerySchema = z.object({
  externalId: z.string().trim().min(1),
  firstName: z.string().trim().min(1).optional(),
  lastName: z.string().trim().min(1).optional(),
  studentEmail: z.string().trim().email().optional(),
  parentEmail: z.string().trim().email().optional(),
  subject: z.nativeEnum(Subject).optional(),
});

const endNewtonCentreLessonSchema = z.object({
  studentId: z.string().trim().min(1),
});

type NewtonCentreReportsQuery = z.infer<typeof newtonCentreReportsQuerySchema>;
type CombinedChildProfile = Awaited<ReturnType<typeof buildCombinedChildProfile>>;

function startOfUtcDay(value: Date) {
  return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
}

function lessonActivityAt(lesson: {
  endedAt: Date | null;
  startedAt: Date | null;
  updatedAt: Date;
  participants: Array<{ lastActiveAt: Date | null }>;
}) {
  return lesson.endedAt ?? lesson.participants[0]?.lastActiveAt ?? lesson.startedAt ?? lesson.updatedAt;
}

function isCompletedLessonSession(lesson: { status: string; endedAt: Date | string | null }) {
  return lesson.status === "COMPLETED" || Boolean(lesson.endedAt);
}

function summariseLessons(
  lessons: Array<{
    status: string;
    endedAt: Date | null;
    activityAt: Date;
    participants: Array<{ questionsAnswered: number; questionsCorrect: number }>;
  }>,
  since: Date
) {
  const windowLessons = lessons.filter(isCompletedLessonSession);
  const matchingLessons = windowLessons.filter((lesson) => lesson.activityAt >= since);
  const questionsAnswered = matchingLessons.reduce(
    (sum, lesson) => sum + (lesson.participants[0]?.questionsAnswered ?? 0),
    0
  );
  const questionsCorrect = matchingLessons.reduce(
    (sum, lesson) => sum + (lesson.participants[0]?.questionsCorrect ?? 0),
    0
  );

  return {
    lessonCount: matchingLessons.length,
    completedLessonCount: matchingLessons.length,
    questionsAnswered,
    questionsCorrect,
    accuracy:
      questionsAnswered > 0
        ? Number((questionsCorrect / questionsAnswered).toFixed(3))
        : null,
  };
}

function normalizeMatchText(value: string | null | undefined) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

function normalizeEmail(value: string | null | undefined) {
  return String(value || "").trim().toLowerCase();
}

function editDistanceAtMostOne(a: string, b: string) {
  if (a === b) return true;
  if (Math.abs(a.length - b.length) > 1) return false;

  let edits = 0;
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) {
      i += 1;
      j += 1;
      continue;
    }
    edits += 1;
    if (edits > 1) return false;
    if (a.length > b.length) i += 1;
    else if (b.length > a.length) j += 1;
    else {
      i += 1;
      j += 1;
    }
  }

  return edits + (a.length - i) + (b.length - j) <= 1;
}

async function resolveNewtonCentreStudentId(input: NewtonCentreReportsQuery) {
  const explicitLink = await prisma.studentIntegrationLink.findFirst({
    where: {
      source: IntegrationSource.NEWTONCENTRE,
      externalId: input.externalId,
    },
    select: { studentId: true },
  });
  if (explicitLink) return explicitLink.studentId;

  const studentEmail = normalizeEmail(input.studentEmail);
  const parentEmail = normalizeEmail(input.parentEmail);
  const firstName = normalizeMatchText(input.firstName);
  const lastName = normalizeMatchText(input.lastName);

  if (!studentEmail && (!parentEmail || !firstName || !lastName)) return null;

  const candidates = await prisma.student.findMany({
    where: {
      OR: [
        ...(studentEmail
          ? [
              {
                user: {
                  email: { equals: studentEmail, mode: "insensitive" as const },
                },
              },
            ]
          : []),
        ...(parentEmail
          ? [
              {
                guardianEmail: {
                  equals: parentEmail,
                  mode: "insensitive" as const,
                },
              },
            ]
          : []),
      ],
    },
    include: {
      user: { select: { email: true } },
    },
    take: 10,
  });

  const matches = candidates.filter((student) => {
    const userEmail = normalizeEmail(student.user.email);
    if (studentEmail && userEmail === studentEmail) return true;

    const guardianEmail = normalizeEmail(student.guardianEmail);
    const candidateFirst = normalizeMatchText(student.firstName);
    const candidateLast = normalizeMatchText(student.lastName);
    return (
      parentEmail &&
      guardianEmail === parentEmail &&
      firstName &&
      lastName &&
      candidateFirst === firstName &&
      editDistanceAtMostOne(candidateLast, lastName)
    );
  });

  if (matches.length !== 1) return null;

  const matched = matches[0];
  await prisma.studentIntegrationLink.upsert({
    where: {
      source_externalId: {
        source: IntegrationSource.NEWTONCENTRE,
        externalId: input.externalId,
      },
    },
    create: {
      studentId: matched.id,
      source: IntegrationSource.NEWTONCENTRE,
      externalId: input.externalId,
      externalType: "Student",
      parentEmail: input.parentEmail ?? matched.guardianEmail,
      syncedAt: new Date(),
    },
    update: {
      studentId: matched.id,
      parentEmail: input.parentEmail ?? matched.guardianEmail,
      syncedAt: new Date(),
    },
  });

  return matched.id;
}

async function listLiveAssessmentReports(studentId: string) {
  const attempts = await prisma.attempt.findMany({
    where: {
      studentId,
      taskType: "ASSESSMENT",
      status: "SUBMITTED",
      subject: {
        in: [Subject.MATHS, Subject.SCIENCE],
      },
    },
    orderBy: [{ submittedAt: "desc" }, { updatedAt: "desc" }],
    select: {
      id: true,
      subject: true,
      score: true,
      submittedAt: true,
      updatedAt: true,
    },
  });

  return attempts.map((attempt) => {
    const params = new URLSearchParams({
      studentId,
      assessmentSessionId: attempt.id,
      subject: attempt.subject,
    });
    const subjectTitle = attempt.subject === Subject.SCIENCE ? "Science" : "Maths";
    return {
      id: attempt.id,
      title: `${subjectTitle} assessment report`,
      subject: attempt.subject,
      score: attempt.score,
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      generatedAt: (attempt.submittedAt ?? attempt.updatedAt).toISOString(),
      downloadUrl: `/api/reports/assessment/pdf?${params.toString()}`,
    };
  });
}

function serializeLearningReport(profile: CombinedChildProfile) {
  const lessons = profile.learningReport.lessons.filter(isCompletedLessonSession);
  const totalQuestionsAnswered = lessons.reduce(
    (sum, lesson) => sum + lesson.questionsAnswered,
    0
  );
  const totalQuestionsCorrect = lessons.reduce(
    (sum, lesson) => sum + lesson.questionsCorrect,
    0
  );

  return {
    subject: profile.assessment?.subject ?? profile.learningReport.course.subject,
    assessment: profile.assessment
      ? {
          sessionId: profile.assessment.sessionId,
          status: profile.assessment.status,
          score: profile.assessment.score,
          submittedAt: profile.assessment.submittedAt,
          overallConfidence: profile.assessment.overallConfidence,
          questionCount: profile.assessment.questionCount,
        }
      : null,
    course: profile.learningReport.course,
    summary: {
      ...profile.learningReport.progressSummary,
      lessonCount: lessons.length,
      completedLessonCount: lessons.length,
      inProgressLessonCount: 0,
      totalQuestionsAnswered,
      totalQuestionsCorrect,
      overallLessonAccuracy:
        totalQuestionsAnswered > 0
          ? Number((totalQuestionsCorrect / totalQuestionsAnswered).toFixed(3))
          : null,
    },
    lessons: lessons.map((lesson) => ({
      lessonSessionId: lesson.lessonSessionId,
      title: lesson.title,
      status: lesson.status,
      startedAt: lesson.startedAt,
      endedAt: lesson.endedAt,
      updatedAt: lesson.updatedAt,
      lastActiveAt: lesson.lastActiveAt,
      questionsAnswered: lesson.questionsAnswered,
      questionsCorrect: lesson.questionsCorrect,
      accuracy: lesson.accuracy,
      progressLabel: lesson.progressLabel,
      objective: {
        id: lesson.objective.id,
        code: lesson.objective.code,
        title: lesson.objective.title,
        yearGroup: lesson.objective.yearGroup,
        strand: lesson.objective.strand,
      },
      recentEvents: lesson.recentEvents,
    })),
    objectives: profile.learningReport.objectives.slice(0, 12).map((objective) => ({
      objectiveId: objective.objectiveId,
      code: objective.code,
      title: objective.title,
      yearGroup: objective.yearGroup,
      strand: objective.strand,
      sequence: objective.sequence,
      status: objective.status,
      reason: objective.reason,
      source: objective.source,
    })),
  };
}

async function buildNewtonCentreProgressData(studentId: string, requestedSubject?: Subject) {
  const lessonParticipants = await prisma.lessonSessionParticipant.findMany({
    where: {
      studentId,
      lessonSession: {
        status: { not: "ARCHIVED" },
      },
    },
    orderBy: [{ updatedAt: "desc" }],
    take: 30,
    select: {
      questionsAnswered: true,
      questionsCorrect: true,
      status: true,
      lastActiveAt: true,
      lessonSession: {
        select: {
          id: true,
          title: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          startedAt: true,
          endedAt: true,
          currentBlockKey: true,
          objective: {
            select: {
              id: true,
              code: true,
              title: true,
              strand: true,
              subject: true,
            },
          },
        },
      },
    },
  });

  const lessonSources = lessonParticipants.map((participant) => ({
    ...participant.lessonSession,
    participants: [
      {
        questionsAnswered: participant.questionsAnswered,
        questionsCorrect: participant.questionsCorrect,
        status: participant.status,
        lastActiveAt: participant.lastActiveAt,
      },
    ],
    activityAt: lessonActivityAt({
      ...participant.lessonSession,
      participants: [{ lastActiveAt: participant.lastActiveAt }],
    }),
  }));
  const sortedLessons = lessonSources.sort((a, b) => b.activityAt.getTime() - a.activityAt.getTime());
  const completedSortedLessons = sortedLessons.filter(isCompletedLessonSession);
  const latest = completedSortedLessons[0] ?? null;
  const latestParticipant = latest?.participants[0] ?? null;
  const now = new Date();

  const subjects = requestedSubject
    ? [requestedSubject]
    : Array.from(
        new Set([
          ...lessonSources.map((lesson) => lesson.objective.subject),
          ...(await prisma.attempt.findMany({
            where: {
              studentId,
              taskType: TaskType.ASSESSMENT,
              status: AttemptStatus.SUBMITTED,
              subject: { in: [Subject.MATHS, Subject.SCIENCE] },
            },
            select: { subject: true },
          })).map((attempt) => attempt.subject),
        ])
      ).filter((subject) => subject === Subject.MATHS || subject === Subject.SCIENCE);

  const subjectReports = (
    await Promise.all(
      subjects.map(async (subject) => {
        try {
          const profile = await buildCombinedChildProfile({ studentId, subject });
          return serializeLearningReport(profile);
        } catch (error) {
          console.error("Failed to build Newton Centre progress subject report:", subject, error);
          return null;
        }
      })
    )
  ).filter((item): item is NonNullable<typeof item> => Boolean(item));

  const subjectsWithDirectLessonTotals = subjectReports.map((report) => {
    const subjectLessons = completedSortedLessons.filter(
      (lesson) => lesson.objective.subject === report.subject
    );
    const totalQuestionsAnswered = subjectLessons.reduce(
      (sum, lesson) => sum + (lesson.participants[0]?.questionsAnswered ?? 0),
      0
    );
    const totalQuestionsCorrect = subjectLessons.reduce(
      (sum, lesson) => sum + (lesson.participants[0]?.questionsCorrect ?? 0),
      0
    );
    return {
      ...report,
      summary: {
        ...report.summary,
        lessonCount: subjectLessons.length,
        completedLessonCount: subjectLessons.length,
        inProgressLessonCount: 0,
        totalQuestionsAnswered,
        totalQuestionsCorrect,
        overallLessonAccuracy:
          totalQuestionsAnswered > 0
            ? Number((totalQuestionsCorrect / totalQuestionsAnswered).toFixed(3))
            : null,
      },
    };
  });
  const activeLessons = sortedLessons
    .filter((lesson) => !lesson.endedAt && ["LIVE", "ACTIVE", "IN_PROGRESS", "STARTED"].includes(lesson.status))
    .map((lesson) => {
      const participant = lesson.participants[0];
      const questionsAnswered = participant?.questionsAnswered ?? 0;
      const questionsCorrect = participant?.questionsCorrect ?? 0;

      return {
        lessonSessionId: lesson.id,
        title: lesson.title,
        status: lesson.status,
        subject: lesson.objective.subject,
        objective: {
          id: lesson.objective.id,
          code: lesson.objective.code,
          title: lesson.objective.title,
          strand: lesson.objective.strand,
        },
        startedAt: lesson.startedAt?.toISOString() ?? null,
        activityAt: lesson.activityAt.toISOString(),
        currentBlockKey: lesson.currentBlockKey,
        questionsAnswered,
        questionsCorrect,
        accuracy:
          questionsAnswered > 0
            ? Number((questionsCorrect / questionsAnswered).toFixed(3))
            : null,
      };
    });

  return {
    latestSession: latest
      ? {
          id: latest.id,
          title: latest.title,
          status: latest.status,
          subject: latest.objective.subject,
          objectiveTitle: latest.objective.title,
          strand: latest.objective.strand,
          activityAt: latest.activityAt.toISOString(),
          endedAt: latest.endedAt?.toISOString() ?? null,
          questionsAnswered: latestParticipant?.questionsAnswered ?? 0,
          questionsCorrect: latestParticipant?.questionsCorrect ?? 0,
          accuracy:
            latestParticipant && latestParticipant.questionsAnswered > 0
              ? Number((latestParticipant.questionsCorrect / latestParticipant.questionsAnswered).toFixed(3))
              : null,
        }
      : null,
    windows: {
      today: summariseLessons(completedSortedLessons, startOfUtcDay(now)),
      week: summariseLessons(completedSortedLessons, new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000)),
      month: summariseLessons(completedSortedLessons, new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000)),
    },
    recentLessons: completedSortedLessons.slice(0, 12).map((lesson) => {
      const participant = lesson.participants[0];
      const questionsAnswered = participant?.questionsAnswered ?? 0;
      const questionsCorrect = participant?.questionsCorrect ?? 0;
      return {
        lessonSessionId: lesson.id,
        title: lesson.title,
        status: lesson.status,
        subject: lesson.objective.subject,
        objective: {
          id: lesson.objective.id,
          code: lesson.objective.code,
          title: lesson.objective.title,
          strand: lesson.objective.strand,
        },
        activityAt: lesson.activityAt.toISOString(),
        startedAt: lesson.startedAt?.toISOString() ?? null,
        endedAt: lesson.endedAt?.toISOString() ?? null,
        questionsAnswered,
        questionsCorrect,
        accuracy:
          questionsAnswered > 0
            ? Number((questionsCorrect / questionsAnswered).toFixed(3))
            : null,
      };
    }),
    subjects: subjectsWithDirectLessonTotals,
    activeLessons,
  };
}

function sendReportFile(
  res: Response,
  payload: Awaited<ReturnType<typeof getStoredReportFileById>>
) {
  if (!payload) {
    return res.status(404).json({ error: "Report not found" });
  }

  res.setHeader("Content-Type", payload.report.mimeType);
  res.setHeader(
    "Content-Disposition",
    `inline; filename="${payload.report.filename.replaceAll('"', "")}"`
  );
  return res.sendFile(payload.filePath);
}

reportRouter.post("/api/reports", async (req, res) => {
  const parsed = createReportSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const report = await createStoredReport(parsed.data);
    return res.status(201).json({ report });
  } catch (error) {
    console.error("Failed to create stored report:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to create report",
    });
  }
});

reportRouter.get("/api/reports", async (req, res) => {
  const parsed = listReportQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const reports = await listStoredReports(parsed.data);
    return res.json({ reports });
  } catch (error) {
    console.error("Failed to list stored reports:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to list reports",
    });
  }
});

reportRouter.get("/api/integrations/newtoncentre/reports", requireApiKey, async (req, res) => {
  const parsed = newtonCentreReportsQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const studentId = await resolveNewtonCentreStudentId(parsed.data);
    if (!studentId) {
      return res.json({
        linked: false,
        mylisaStudentId: null,
        reports: [],
        progress: null,
        progressPdfUrl: null,
      });
    }

    const [reports, assessmentReports, progress] = await Promise.all([
      listStoredReports({
        studentId,
        subject: parsed.data.subject,
      }),
      listLiveAssessmentReports(studentId),
      buildNewtonCentreProgressData(studentId, parsed.data.subject),
    ]);
    const progressParams = new URLSearchParams({ studentId });
    if (parsed.data.subject) progressParams.set("subject", parsed.data.subject);

    return res.json({
      linked: true,
      mylisaStudentId: studentId,
      reports,
      assessmentReports: parsed.data.subject
        ? assessmentReports.filter((report) => report.subject === parsed.data.subject)
        : assessmentReports,
      progress,
      progressPdfUrl: `/api/reports/progress/pdf?${progressParams.toString()}`,
    });
  } catch (error) {
    console.error("Failed to list Newton Centre linked reports:", error);
    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to list linked reports",
    });
  }
});

reportRouter.post(
  "/api/integrations/newtoncentre/lessons/:lessonSessionId/end",
  requireApiKey,
  async (req, res) => {
    const parsed = endNewtonCentreLessonSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return res.status(400).json({
        error: "Validation failed",
        issues: parsed.error.issues,
      });
    }

    try {
      const lessonSessionId = String(req.params.lessonSessionId);
      const lesson = await prisma.lessonSession.findFirst({
        where: {
          id: lessonSessionId,
          participants: {
            some: {
              studentId: parsed.data.studentId,
            },
          },
        },
        select: {
          id: true,
          organisationId: true,
          title: true,
          status: true,
          startedAt: true,
          endedAt: true,
          currentBlockKey: true,
          objectiveId: true,
          participants: {
            where: { studentId: parsed.data.studentId },
            select: { id: true, status: true },
            take: 1,
          },
        },
      });

      if (!lesson) {
        return res.status(404).json({ error: "Lesson was not found for this student." });
      }

      if (lesson.endedAt || lesson.status === "COMPLETED") {
        return res.status(409).json({ error: "Completed lessons cannot be ended from this view." });
      }

      if (!["LIVE", "ACTIVE", "IN_PROGRESS", "STARTED"].includes(lesson.status)) {
        return res.status(409).json({ error: "Only live or started lessons can be ended from this view." });
      }

      const cancelledAt = new Date();
      const updated = await prisma.lessonSession.update({
        where: { id: lesson.id },
        data: {
          status: "ARCHIVED",
          participants: {
            updateMany: {
              where: {
                lessonSessionId: lesson.id,
                studentId: parsed.data.studentId,
              },
              data: {
                status: "CANCELLED",
                lastActiveAt: cancelledAt,
              },
            },
          },
          events: {
            create: {
              organisationId: lesson.organisationId,
              studentId: parsed.data.studentId,
              type: "NEWTONCENTRE_INCOMPLETE_LESSON_CANCELLED",
              blockKey: lesson.currentBlockKey,
              payload: {
                objectiveId: lesson.objectiveId,
                title: lesson.title,
                cancelledAt: cancelledAt.toISOString(),
                source: "newtoncentre-admin",
                reason: "Ended before completion so it can be selected again.",
              },
            },
          },
        },
        select: {
          id: true,
          title: true,
          status: true,
          startedAt: true,
          endedAt: true,
        },
      });

      return res.json({
        ok: true,
        lesson: {
          ...updated,
          startedAt: updated.startedAt?.toISOString() ?? null,
          endedAt: updated.endedAt?.toISOString() ?? null,
        },
      });
    } catch (error) {
      console.error("Failed to end Newton Centre linked lesson:", error);
      return res.status(500).json({
        error:
          error instanceof Error
            ? error.message
            : "Failed to end linked lesson",
      });
    }
  },
);

reportRouter.get("/api/reports/assessment/pdf", async (req, res) => {
  const parsed = assessmentReportPdfQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const report = await createAssessmentReportPdf(parsed.data);
    res.setHeader("Content-Type", report.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${report.filename.replaceAll('"', "")}"`
    );
    return res.send(report.buffer);
  } catch (error) {
    console.error("Failed to create assessment report:", error);
    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to create assessment report",
    });
  }
});

reportRouter.get("/api/reports/progress/pdf", async (req, res) => {
  const parsed = progressReportQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({
      error: "Validation failed",
      issues: parsed.error.issues,
    });
  }

  try {
    const report = await createProgressReportPdf(parsed.data);
    res.setHeader("Content-Type", report.mimeType);
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="${report.filename.replaceAll('"', "")}"`
    );
    return res.send(report.buffer);
  } catch (error) {
    console.error("Failed to create progress report:", error);
    return res.status(500).json({
      error:
        error instanceof Error
          ? error.message
          : "Failed to create progress report",
    });
  }
});

reportRouter.get("/api/reports/:reportId/pdf", async (req, res) => {
  try {
    return sendReportFile(res, await getStoredReportFileById(req.params.reportId));
  } catch (error) {
    console.error("Failed to send stored report:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load report",
    });
  }
});

publicReportRouter.get("/public/reports/:publicToken/pdf", async (req, res) => {
  try {
    return sendReportFile(
      res,
      await getStoredReportFileByPublicToken(req.params.publicToken)
    );
  } catch (error) {
    console.error("Failed to send public stored report:", error);
    return res.status(500).json({
      error: error instanceof Error ? error.message : "Failed to load report",
    });
  }
});
