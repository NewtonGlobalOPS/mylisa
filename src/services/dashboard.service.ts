import { AttemptStatus, Prisma, Subject, TaskType } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { listNdscreenChildScreenings } from "./ndscreenDirect.service.js";

function normalizeSearch(value: string | undefined) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function buildLearnerSearchWhere(
  query: string,
  options?: { includeNdscreenSessionId?: boolean }
): Prisma.StudentWhereInput {
  const nameTokens = query.split(/\s+/).filter(Boolean);
  const fullNameMatch =
    nameTokens.length > 1
      ? [
          {
            AND: nameTokens.map((token) => ({
              OR: [
                { firstName: { contains: token, mode: "insensitive" as const } },
                { lastName: { contains: token, mode: "insensitive" as const } },
              ],
            })),
          },
        ]
      : [];

  return {
    OR: [
      ...fullNameMatch,
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
            OR: [
              { externalId: { contains: query } },
              ...(options?.includeNdscreenSessionId
                ? [{ ndscreenSessionId: { contains: query } }]
                : []),
            ],
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
  };
}

function inferSchoolYear(
  schoolYear: number | null | undefined,
  age: number | null | undefined
): number | null {
  if (typeof schoolYear === "number" && Number.isFinite(schoolYear)) {
    return schoolYear >= 1 && schoolYear <= 13 ? schoolYear : null;
  }

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
      ...(query ? buildLearnerSearchWhere(query) : {}),
    },
    take: limit,
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      age: true,
      schoolYear: true,
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
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 3,
        select: {
          id: true,
          subject: true,
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
        schoolYear: inferSchoolYear(learner.schoolYear, learner.age),
        keyStage: learner.keyStage,
        subjects: learner.subjects,
        bookingIds: learner.integrationLinks.map((link) => link.externalId),
        ndscreenSessionId:
          learner.integrationLinks.find((link) => link.ndscreenSessionId)?.ndscreenSessionId ??
          null,
        latestAssessment: latestAssessment
          ? {
              id: latestAssessment.id,
              subject: latestAssessment.subject,
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

function buildAssessmentJourneyStatus(input: {
  hasCompletedAssessment: boolean;
  hasAssessmentInProgress: boolean;
  ndscreenSessionId: string | null;
}) {
  if (input.hasCompletedAssessment) return "ASSESSED";
  if (input.hasAssessmentInProgress) return "ASSESSMENT_IN_PROGRESS";
  if (!input.ndscreenSessionId) return "NO_SCREENING";
  return "SCREENED_AWAITING_ASSESSMENT";
}

function startOfUtcDay(date: Date): Date {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}

type LessonProgressSource = {
  id: string;
  title: string;
  status: string;
  createdAt: Date;
  updatedAt: Date;
  startedAt: Date | null;
  endedAt: Date | null;
  objective: {
    title: string;
    strand: string;
  };
  participants: Array<{
    questionsAnswered: number;
    questionsCorrect: number;
    status: string;
    lastActiveAt: Date | null;
  }>;
};

function lessonActivityAt(lesson: LessonProgressSource): Date {
  return lesson.endedAt ?? lesson.participants[0]?.lastActiveAt ?? lesson.startedAt ?? lesson.updatedAt ?? lesson.createdAt;
}

function summariseLessonWindow(lessons: LessonProgressSource[], since: Date) {
  const windowLessons = lessons.filter((lesson) => lessonActivityAt(lesson) >= since);
  const questionsAnswered = windowLessons.reduce(
    (sum, lesson) => sum + (lesson.participants[0]?.questionsAnswered ?? 0),
    0,
  );
  const questionsCorrect = windowLessons.reduce(
    (sum, lesson) => sum + (lesson.participants[0]?.questionsCorrect ?? 0),
    0,
  );
  return {
    lessonCount: windowLessons.length,
    completedLessonCount: windowLessons.filter((lesson) => lesson.status === "COMPLETED" || lesson.endedAt).length,
    questionsAnswered,
    questionsCorrect,
    accuracy:
      questionsAnswered > 0
        ? Number((questionsCorrect / questionsAnswered).toFixed(3))
        : null,
  };
}

function buildStudentProgressReport(lessons: LessonProgressSource[], now = new Date()) {
  const sorted = [...lessons].sort((a, b) => lessonActivityAt(b).getTime() - lessonActivityAt(a).getTime());
  const latest = sorted[0] ?? null;
  const latestParticipant = latest?.participants[0] ?? null;
  const todayStart = startOfUtcDay(now);
  const weekStart = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);

  return {
    latestSession: latest
      ? {
          id: latest.id,
          title: latest.title,
          status: latest.status,
          objectiveTitle: latest.objective.title,
          strand: latest.objective.strand,
          activityAt: lessonActivityAt(latest).toISOString(),
          endedAt: latest.endedAt?.toISOString() ?? null,
          questionsAnswered: latestParticipant?.questionsAnswered ?? 0,
          questionsCorrect: latestParticipant?.questionsCorrect ?? 0,
          accuracy:
            latestParticipant && latestParticipant.questionsAnswered > 0
              ? Number((latestParticipant.questionsCorrect / latestParticipant.questionsAnswered).toFixed(3))
              : null,
        }
      : null,
    today: summariseLessonWindow(sorted, todayStart),
    week: summariseLessonWindow(sorted, weekStart),
    month: summariseLessonWindow(sorted, monthStart),
    activeLessons: sorted
      .filter((lesson) => !lesson.endedAt && ["LIVE", "ACTIVE", "IN_PROGRESS", "STARTED"].includes(lesson.status))
      .map((lesson) => {
        const participant = lesson.participants[0];
        const questionsAnswered = participant?.questionsAnswered ?? 0;
        const questionsCorrect = participant?.questionsCorrect ?? 0;

        return {
          id: lesson.id,
          title: lesson.title,
          status: lesson.status,
          objectiveTitle: lesson.objective.title,
          strand: lesson.objective.strand,
          activityAt: lessonActivityAt(lesson).toISOString(),
          startedAt: lesson.startedAt?.toISOString() ?? null,
          questionsAnswered,
          questionsCorrect,
          accuracy:
            questionsAnswered > 0
              ? Number((questionsCorrect / questionsAnswered).toFixed(3))
              : null,
        };
      }),
  };
}

export async function getLearnerJourneyDashboard(input?: {
  query?: string;
  limit?: number;
}) {
  const query = normalizeSearch(input?.query);
  const limit = Math.min(Math.max(input?.limit ?? 50, 1), 100);

  const students = await prisma.student.findMany({
    where: {
      OR: [
        {
          integrationLinks: {
            some: {
              ndscreenSessionId: {
                not: null,
              },
            },
          },
        },
        {
          attempts: {
            some: {
              taskType: TaskType.ASSESSMENT,
            },
          },
        },
      ],
      ...(query ? buildLearnerSearchWhere(query, { includeNdscreenSessionId: true }) : {}),
    },
    take: limit,
    orderBy: [{ updatedAt: "desc" }],
    select: {
      id: true,
      firstName: true,
      lastName: true,
      age: true,
      schoolYear: true,
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
        where: {
          ndscreenSessionId: {
            not: null,
          },
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 1,
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
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 10,
        select: {
          id: true,
          subject: true,
          status: true,
          createdAt: true,
          updatedAt: true,
          submittedAt: true,
        },
      },
      wrapperVectors: {
        orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { updatedAt: "desc" }],
        select: {
          id: true,
          title: true,
          scope: true,
          strand: true,
          isActive: true,
        },
      },
      lessonParticipants: {
        where: {
          lessonSession: {
            status: { not: "ARCHIVED" },
          },
        },
        orderBy: [{ updatedAt: "desc" }],
        take: 20,
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
              objective: {
                select: {
                  title: true,
                  strand: true,
                },
              },
            },
          },
        },
      },
    },
  });

  const items = students.map((student) => {
    const latestScreening = student.integrationLinks[0] ?? null;
    const completedAssessment =
      student.attempts
        .filter((attempt) => attempt.status === AttemptStatus.SUBMITTED)
        .sort(
          (a, b) =>
            (b.submittedAt ?? b.updatedAt).getTime() -
            (a.submittedAt ?? a.updatedAt).getTime(),
        )[0] ?? null;
    const latestInProgressAssessment =
      student.attempts.find((attempt) => attempt.status !== AttemptStatus.SUBMITTED) ?? null;
    const latestAssessment = completedAssessment ?? latestInProgressAssessment;
    const hasCompletedAssessment = completedAssessment != null;
    const hasAssessmentInProgress = !hasCompletedAssessment && latestInProgressAssessment != null;
    const completedAssessmentSubjects = Array.from(
      new Set(
        student.attempts
          .filter((attempt) => attempt.status === AttemptStatus.SUBMITTED)
          .map((attempt) => attempt.subject),
      ),
    );
    const journeyStatus = buildAssessmentJourneyStatus({
      hasCompletedAssessment,
      hasAssessmentInProgress,
      ndscreenSessionId: latestScreening?.ndscreenSessionId ?? null,
    });

    return {
      studentId: student.id,
      userId: student.user.id,
      userEmail: student.user.email,
      firstName: student.firstName,
      lastName: student.lastName,
      displayName:
        [student.firstName, student.lastName].filter(Boolean).join(" ").trim() ||
        student.user.email,
      guardianEmail: student.guardianEmail,
      age: student.age,
      schoolYear: inferSchoolYear(student.schoolYear, student.age),
      keyStage: student.keyStage,
      subjects: student.subjects,
      journeyStatus,
      hasCompletedAssessment,
      hasAssessmentInProgress,
      completedAssessmentSubjects,
      ndscreenSessionId: latestScreening?.ndscreenSessionId ?? null,
      bookingId: latestScreening?.externalId ?? null,
      bookingType: latestScreening?.externalType ?? null,
      screeningUpdatedAt: latestScreening?.updatedAt.toISOString() ?? null,
      latestAssessment: latestAssessment
        ? {
            id: latestAssessment.id,
            subject: latestAssessment.subject,
            status: latestAssessment.status,
            createdAt: latestAssessment.createdAt.toISOString(),
            updatedAt: latestAssessment.updatedAt.toISOString(),
            submittedAt: latestAssessment.submittedAt?.toISOString() ?? null,
          }
        : null,
      wrapperVectorCount: student.wrapperVectors.length,
      activeWrapperVectorCount: student.wrapperVectors.filter((item) => item.isActive).length,
      wrapperVectorPreview: student.wrapperVectors.slice(0, 3).map((item) => ({
        id: item.id,
        title: item.title,
        scope: item.scope,
        strand: item.strand,
        isActive: item.isActive,
      })),
      progressReport: buildStudentProgressReport(
        student.lessonParticipants.map((participant) => ({
          ...participant.lessonSession,
          participants: [{
            questionsAnswered: participant.questionsAnswered,
            questionsCorrect: participant.questionsCorrect,
            status: participant.status,
            lastActiveAt: participant.lastActiveAt,
          }],
        })),
      ),
    };
  });

  return {
    query: query ?? null,
    count: items.length,
    totals: {
      assessed: items.filter((item) => item.journeyStatus === "ASSESSED").length,
      awaitingAssessment: items.filter(
        (item) => item.journeyStatus === "SCREENED_AWAITING_ASSESSMENT"
      ).length,
      assessmentInProgress: items.filter(
        (item) => item.journeyStatus === "ASSESSMENT_IN_PROGRESS"
      ).length,
    },
    assessed: items.filter((item) => item.journeyStatus === "ASSESSED"),
    awaitingAssessment: items.filter(
      (item) => item.journeyStatus === "SCREENED_AWAITING_ASSESSMENT"
    ),
    assessmentInProgress: items.filter(
      (item) => item.journeyStatus === "ASSESSMENT_IN_PROGRESS"
    ),
    items,
  };
}

export async function getDirectNdscreenDashboard() {
  const screenings = await listNdscreenChildScreenings();
  const sessionIds = screenings.map((item) => item.sessionId);

  const links = sessionIds.length
    ? await prisma.studentIntegrationLink.findMany({
        where: {
          ndscreenSessionId: {
            in: sessionIds,
          },
        },
        select: {
          studentId: true,
          ndscreenSessionId: true,
        },
      })
    : [];

  const studentIds = Array.from(
    new Set(links.map((item) => item.studentId).filter(Boolean))
  );

  const students = studentIds.length
    ? await prisma.student.findMany({
        where: {
          id: {
            in: studentIds,
          },
        },
        select: {
          id: true,
          firstName: true,
          lastName: true,
          age: true,
          schoolYear: true,
          keyStage: true,
          guardianEmail: true,
          user: {
            select: {
              id: true,
              email: true,
            },
          },
          attempts: {
            where: {
              taskType: TaskType.ASSESSMENT,
            },
            orderBy: [{ submittedAt: "desc" }, { updatedAt: "desc" }],
            take: 1,
            select: {
              id: true,
              subject: true,
              status: true,
              createdAt: true,
              updatedAt: true,
              submittedAt: true,
            },
          },
        },
      })
    : [];

  const linkBySessionId = new Map(
    links
      .filter((item) => item.ndscreenSessionId)
      .map((item) => [item.ndscreenSessionId as string, item.studentId])
  );
  const studentById = new Map(students.map((item) => [item.id, item]));

  const items = screenings.map((screening) => {
    const studentId = linkBySessionId.get(screening.sessionId) ?? null;
    const student = studentId ? studentById.get(studentId) ?? null : null;
    const latestAssessment = student?.attempts[0] ?? null;

    return {
      sessionId: screening.sessionId,
      screeningStatus: screening.status,
      screeningKind: screening.screeningKind,
      questionSet: screening.questionSet,
      childDisplayName:
        screening.child.displayName ||
        [screening.child.legalFirstName, screening.child.legalLastName]
          .filter(Boolean)
          .join(" ")
          .trim() ||
        "Child",
      firstName: screening.child.legalFirstName,
      lastName: screening.child.legalLastName,
      age: screening.child.ageYears,
      schoolYear: inferSchoolYear(
        schoolYearFromTextLike(screening.child.schoolYear),
        screening.child.ageYears
      ),
      guardianEmail: screening.guardian?.email ?? null,
      report: screening.report,
      latestResult: screening.latestResult,
      learningProfile: screening.learningProfile,
      isImportedToMylisa: Boolean(student),
      student: student
        ? {
            studentId: student.id,
            userId: student.user.id,
            userEmail: student.user.email,
            firstName: student.firstName,
            lastName: student.lastName,
            age: student.age,
            schoolYear: inferSchoolYear(student.schoolYear, student.age),
            keyStage: student.keyStage,
            guardianEmail: student.guardianEmail,
          }
        : null,
      latestAssessment: latestAssessment
        ? {
            id: latestAssessment.id,
            subject: latestAssessment.subject,
            status: latestAssessment.status,
            createdAt: latestAssessment.createdAt.toISOString(),
            updatedAt: latestAssessment.updatedAt.toISOString(),
            submittedAt: latestAssessment.submittedAt?.toISOString() ?? null,
          }
        : null,
    };
  });

  return {
    count: items.length,
    items,
  };
}

function schoolYearFromTextLike(value: string | null | undefined): number | null {
  const raw = value?.trim().toLowerCase();
  if (!raw) return null;
  const match = raw.match(/\b(\d{1,2})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) && year >= 1 && year <= 13 ? year : null;
}
