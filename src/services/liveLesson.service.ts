import { Role, Subject } from "@prisma/client";
import { answerMaskMatches } from "../lib/answerMask.js";
import { prisma } from "../lib/prisma.js";
import { buildCombinedChildProfile } from "./childProfile.service.js";
import { buildLearnerSupportFocus, buildLessonRuntimeByObjective } from "./lessonRuntime.service.js";
import { generateNeuroTeachingCards } from "./neuroTeachingGenerator.service.js";

type CreateCoursePlanInput = {
  studentId: string;
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
};

type CreateLessonSessionInput = {
  tutorUserId: string;
  objectiveId: string;
  studentIds: string[];
  coursePlanId?: string;
  lessonPlanId?: string;
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
  selectedChunkIds?: string[];
  title?: string;
};

const lessonBlockOrder = [
  "whole-group-objective-1",
  "student-oak-practice-1",
  "whole-group-objective-2",
  "student-oak-practice-2",
  "whole-group-objective-3",
  "student-oak-practice-3",
];

function keyStageRank(keyStage?: string | null) {
  if (!keyStage) return null;
  const match = keyStage.match(/\d+/);
  return match ? Number(match[0]) : null;
}

function objectiveIsAboveStudent(
  objective: { keyStage: string; yearGroup: number | null },
  student: { keyStage: string | null; schoolYear: number | null },
) {
  const objectiveRank = keyStageRank(objective.keyStage);
  const studentRank = keyStageRank(student.keyStage);
  if (objectiveRank != null && studentRank != null && objectiveRank > studentRank) return true;
  if (
    typeof objective.yearGroup === "number" &&
    typeof student.schoolYear === "number" &&
    objective.yearGroup > student.schoolYear
  ) {
    return true;
  }
  return false;
}

function displayName(student: {
  firstName: string | null;
  lastName: string | null;
  user: { email: string };
}) {
  const name = [student.firstName, student.lastName]
    .map((value) => value?.trim())
    .filter(Boolean)
    .join(" ");
  return name || student.user.email;
}

function objectiveIsMathsGeometry(objective: {
  subject: Subject;
  title: string;
  statement?: string | null;
  strand: string;
}) {
  if (objective.subject !== Subject.MATHS) return false;
  const text = [objective.title, objective.statement, objective.strand].join(" ").toLowerCase();
  return [
    "geometry",
    "geometrical",
    "shape",
    "shapes",
    "polygon",
    "polygons",
    "angle",
    "angles",
    "cube",
    "cuboid",
    "prism",
    "faces",
    "edges",
    "vertices",
    "net",
    "nets",
  ].some((term) => text.includes(term));
}

function isLegacyKs2GeometryTopUp(question: any) {
  return (
    question?.generatorVersion === "mylisa-ks2-geometry-top-up-v1" ||
    question?.contentJson?.source === "deterministic-ks2-geometry-top-up" ||
    question?.contentJson?.generated?.source === "deterministic-ks2-geometry-top-up"
  );
}

function isGenericObjectiveStrandTopUp(question: any) {
  return (
    question?.contentJson?.source === "deterministic-objective-strand-top-up" ||
    question?.contentJson?.generated?.source === "deterministic-objective-strand-top-up" ||
    question?.generatorMeta?.source === "deterministic-objective-strand-top-up"
  );
}

function isUnsafeStudentQuestion(
  question: any,
  objective: { subject: Subject; title: string; statement?: string | null; strand: string },
) {
  if (isGenericObjectiveStrandTopUp(question)) return true;
  if (!objectiveIsMathsGeometry(objective) && isLegacyKs2GeometryTopUp(question)) return true;
  return false;
}

function sanitizeRuntimeJsonForObjective(
  runtimeJson: Record<string, any>,
  objective: { subject: Subject; title: string; statement?: string | null; strand: string },
): Record<string, any> {
  const sanitizeQuestions = (questions: any) =>
    Array.isArray(questions)
      ? questions.filter((question) => !isUnsafeStudentQuestion(question, objective))
      : questions;

  const personalisedQuestionRounds = Array.isArray(runtimeJson.personalisedQuestionRounds)
    ? runtimeJson.personalisedQuestionRounds.map((round: any) => ({
        ...round,
        questions: sanitizeQuestions(round?.questions),
      }))
    : runtimeJson.personalisedQuestionRounds;
  const lessonFlow =
    runtimeJson.lessonFlow && typeof runtimeJson.lessonFlow === "object"
      ? {
          ...runtimeJson.lessonFlow,
          personalisedQuestionRounds: Array.isArray(runtimeJson.lessonFlow.personalisedQuestionRounds)
            ? runtimeJson.lessonFlow.personalisedQuestionRounds.map((round: any) => ({
                ...round,
                questions: sanitizeQuestions(round?.questions),
              }))
            : runtimeJson.lessonFlow.personalisedQuestionRounds,
        }
      : runtimeJson.lessonFlow;

  const canonicalCards = sanitizeQuestions(runtimeJson.canonicalCards);

  return {
    ...runtimeJson,
    personalisedQuestionRounds,
    lessonFlow,
    canonicalCards,
  };
}

async function getTutorUser(tutorUserId: string) {
  const user = await prisma.user.findUnique({
    where: { id: tutorUserId },
    select: { id: true, organisationId: true, role: true, email: true },
  });

  if (!user) throw new Error("Tutor user not found");
  if (user.role !== Role.STAFF && user.role !== Role.ADMIN) {
    throw new Error("Only staff or admin users can launch live lessons");
  }

  return user;
}

export async function createMathsCoursePlan(input: CreateCoursePlanInput) {
  const profile = await buildCombinedChildProfile({
    studentId: input.studentId,
    assessmentSessionId: input.assessmentSessionId,
    ndscreenSessionId: input.ndscreenSessionId,
  });

  const student = await prisma.student.findUnique({
    where: { id: input.studentId },
    select: { id: true, organisationId: true, firstName: true, lastName: true, user: { select: { email: true } } },
  });

  if (!student) throw new Error("Student not found");

  const objectiveIds = Array.from(
    new Set(
      profile.recommendations.objectives
        .map((objective) => objective.objectiveId)
        .filter(Boolean),
    ),
  ).slice(0, 12);

  if (!objectiveIds.length) {
    throw new Error("No recommended Maths objectives are available for this learner yet");
  }

  const objectives = await prisma.curriculumObjective.findMany({
    where: {
      id: { in: objectiveIds },
      organisationId: student.organisationId,
      subject: Subject.MATHS,
      isActive: true,
    },
    select: {
      id: true,
      code: true,
      title: true,
      strand: true,
      yearGroup: true,
    },
  });
  const objectiveById = new Map(objectives.map((objective) => [objective.id, objective]));
  const orderedItems = profile.recommendations.objectives
    .filter((recommendation) => objectiveById.has(recommendation.objectiveId))
    .slice(0, 12)
    .map((recommendation, index) => {
      const objective = objectiveById.get(recommendation.objectiveId)!;
      return {
        organisationId: student.organisationId,
        studentId: student.id,
        objectiveId: objective.id,
        sequence: index + 1,
        strand: objective.strand,
        yearGroup: objective.yearGroup,
        priorityWeight: recommendation.priorityWeight ?? 1,
        reason: recommendation.reason,
      };
    });

  return prisma.coursePlan.create({
    data: {
      organisationId: student.organisationId,
      studentId: student.id,
      subject: Subject.MATHS,
      title: `${displayName(student)} Maths objective course`,
      status: "ACTIVE",
      assessmentSessionId: input.assessmentSessionId,
      ndscreenSessionId: input.ndscreenSessionId,
      sourceSummary: {
        course: profile.recommendations.course,
        deliveryProfile: profile.recommendations.deliveryProfile,
      },
      items: { create: orderedItems },
    },
    include: {
      student: { select: { id: true, firstName: true, lastName: true, user: { select: { email: true } } } },
      items: {
        orderBy: { sequence: "asc" },
        include: { objective: { select: { id: true, code: true, title: true, strand: true, yearGroup: true } } },
      },
    },
  });
}

export async function createLiveLessonSession(input: CreateLessonSessionInput) {
  const tutor = await getTutorUser(input.tutorUserId);
  const studentIds = Array.from(new Set(input.studentIds.map((id) => id.trim()).filter(Boolean)));
  if (!studentIds.length) throw new Error("At least one student is required");

  const students = await prisma.student.findMany({
    where: { id: { in: studentIds }, organisationId: tutor.organisationId },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      keyStage: true,
      schoolYear: true,
      user: { select: { email: true } },
    },
  });
  if (students.length !== studentIds.length) {
    throw new Error("One or more students could not be found for this organisation");
  }

  const objective = await prisma.curriculumObjective.findFirst({
    where: { id: input.objectiveId, organisationId: tutor.organisationId },
    select: { id: true, keyStage: true, yearGroup: true },
  });
  if (!objective) throw new Error("Lesson objective not found");

  const runtimes = await Promise.all(
    students.map(async (student) => ({
      student,
      runtime: await buildLessonRuntimeByObjective({
        objectiveId: input.objectiveId,
        studentId: student.id,
        assessmentSessionId: input.assessmentSessionId,
        ndscreenSessionId: input.ndscreenSessionId,
        selectedChunkIds: input.selectedChunkIds,
      }),
    })),
  );
  const enrichedRuntimes = await Promise.all(
    runtimes.map(async ({ student, runtime }) => {
      const neuroTeachingCards = await generateNeuroTeachingCards({
        screenPayload: runtime.screenPayload,
      });
      return { student, runtime, neuroTeachingCards };
    }),
  );

  const firstRuntime = enrichedRuntimes[0]?.runtime;
  if (!firstRuntime) throw new Error("Unable to build lesson runtime");
  const firstNeuroTeachingCards = enrichedRuntimes[0]?.neuroTeachingCards ?? [];

  const title = input.title?.trim() || firstRuntime.screenPayload.objective.title;
  const firstBlockKey = firstRuntime.screenPayload.lessonFlow.sessionBlocks[0]?.key ?? lessonBlockOrder[0];

  return prisma.lessonSession.create({
    data: {
      organisationId: tutor.organisationId,
      tutorUserId: tutor.id,
      objectiveId: input.objectiveId,
      coursePlanId: input.coursePlanId,
      lessonPlanId: input.lessonPlanId,
      title,
      status: "DRAFT",
      currentBlockKey: firstBlockKey,
      flowJson: firstRuntime.screenPayload.lessonFlow,
      tutorRuntimeJson: {
        objective: firstRuntime.screenPayload.objective,
        objectives: firstRuntime.screenPayload.objectives,
        supportCards: firstRuntime.screenPayload.supportCards,
        candidateSupportCards: firstRuntime.screenPayload.candidateSupportCards,
        neuroTeachingCards: firstNeuroTeachingCards,
      },
      participants: {
        create: enrichedRuntimes.map(({ student, runtime, neuroTeachingCards }) => ({
          organisation: { connect: { id: tutor.organisationId } },
          student: { connect: { id: student.id } },
          status: "INVITED",
          currentBlockKey: firstBlockKey,
          runtimeJson: {
            ...runtime.screenPayload,
            neuroTeachingCards,
          } as any,
          progressJson: { answeredQuestionIds: [], correctQuestionIds: [] } as any,
        })),
      },
      events: {
        create: {
          organisationId: tutor.organisationId,
          userId: tutor.id,
          type: "LESSON_CREATED",
          blockKey: firstBlockKey,
          payload: { studentIds, title },
        },
      },
    },
    include: liveLessonInclude,
  });
}

const liveLessonInclude = {
  tutorUser: { select: { id: true, email: true, role: true } },
  objective: { select: { id: true, code: true, title: true, strand: true, yearGroup: true, subject: true, keyStage: true } },
  participants: {
    orderBy: { createdAt: "asc" as const },
    include: {
      student: { select: { id: true, firstName: true, lastName: true, age: true, schoolYear: true, user: { select: { email: true } } } },
    },
  },
  events: { orderBy: { createdAt: "desc" as const }, take: 20 },
};

function moodPolicy(moodKey: string) {
  switch (moodKey) {
    case "ready":
      return {
        moodLabel: "Ready to go",
        pacingHint: "No action needed. Continue with the planned lesson flow.",
        actionLevel: "NONE",
        studentAction: "CONTINUE",
        tutorVisibility: "NONE",
        tutorMessage: "No intervention needed.",
      };
    case "steady":
      return {
        moodLabel: "Need a gentle start",
        pacingHint: "Keep questions low pressure and easy until the learner settles.",
        actionLevel: "LOW_PRESSURE",
        studentAction: "EASY_START",
        tutorVisibility: "PRIVATE_NOTE",
        tutorMessage: "Gentle start selected. Keep the first questions easy and low pressure.",
      };
    case "wobbly":
      return {
        moodLabel: "Feeling unsure",
        pacingHint: "Private tutor flag sent. Monitor confidence and step in if uncertainty builds.",
        actionLevel: "MONITOR",
        studentAction: "CONTINUE_WITH_SUPPORT",
        tutorVisibility: "PRIVATE_FLAG",
        tutorMessage: "Monitor privately. The learner is unsure and may need quieter prompting or reassurance.",
      };
    case "stretched":
      return {
        moodLabel: "Brain feels busy",
        pacingHint: "Pause for a reset. A private tutor alert has been sent.",
        actionLevel: "INTERVENE",
        studentAction: "PAUSE",
        tutorVisibility: "PRIVATE_ALERT",
        tutorMessage: "Intervention needed now. Pause the learner, reduce input, and offer a short reset before continuing.",
      };
    default:
      return {
        moodLabel: "Ready to go",
        pacingHint: "No action needed. Continue with the planned lesson flow.",
        actionLevel: "NONE",
        studentAction: "CONTINUE",
        tutorVisibility: "NONE",
        tutorMessage: "No intervention needed.",
      };
  }
}

export async function getLiveLessonSession(lessonSessionId: string) {
  const lesson = await prisma.lessonSession.findUnique({
    where: { id: lessonSessionId },
    include: liveLessonInclude,
  });
  if (!lesson) throw new Error("Live lesson session not found");
  return {
    ...lesson,
    participants: lesson.participants.map((participant) => ({
      ...participant,
      runtimeJson: sanitizeRuntimeJsonForObjective(
        participant.runtimeJson && typeof participant.runtimeJson === "object"
          ? (participant.runtimeJson as Record<string, any>)
          : {},
        lesson.objective,
      ),
    })),
  };
}

export async function getStudentLiveLesson(input: { lessonSessionId: string; studentId: string }) {
  const participant = await prisma.lessonSessionParticipant.findUnique({
    where: {
      lessonSessionId_studentId: {
        lessonSessionId: input.lessonSessionId,
        studentId: input.studentId,
      },
    },
    include: {
      lessonSession: {
        include: {
          objective: { select: { id: true, code: true, title: true, strand: true, yearGroup: true, subject: true, keyStage: true } },
        },
      },
      student: { select: { id: true, firstName: true, lastName: true, age: true, schoolYear: true, user: { select: { email: true } } } },
    },
  });

  if (!participant) throw new Error("Student is not part of this live lesson");
  const runtimeJson =
    participant.runtimeJson && typeof participant.runtimeJson === "object"
      ? (participant.runtimeJson as Record<string, any>)
      : {};
  const sanitizedRuntimeJson = sanitizeRuntimeJsonForObjective(
    runtimeJson,
    participant.lessonSession.objective,
  );

  if (!sanitizedRuntimeJson.learnerSupportFocus) {
    return {
      ...participant,
      runtimeJson: {
        ...sanitizedRuntimeJson,
        learnerSupportFocus: buildLearnerSupportFocus({
          presentation: sanitizedRuntimeJson.presentation,
          wrapperVectors: sanitizedRuntimeJson.wrapperVectors,
        }),
      },
    };
  }

  return {
    ...participant,
    runtimeJson: sanitizedRuntimeJson,
  };
}

export async function submitLiveLessonMood(input: {
  lessonSessionId: string;
  studentId: string;
  moodKey: string;
  moodLabel: string;
  pacingHint: string;
}) {
  const participant = await prisma.lessonSessionParticipant.findUnique({
    where: {
      lessonSessionId_studentId: {
        lessonSessionId: input.lessonSessionId,
        studentId: input.studentId,
      },
    },
  });

  if (!participant) throw new Error("Student is not part of this live lesson");

  const checkedInAt = new Date().toISOString();
  const progress =
    participant.progressJson && typeof participant.progressJson === "object"
      ? (participant.progressJson as Record<string, any>)
      : {};
  const moodCheckIn = {
    moodKey: input.moodKey,
    ...moodPolicy(input.moodKey),
    checkedInAt,
  };

  const updated = await prisma.lessonSessionParticipant.update({
    where: { id: participant.id },
    data: {
      status: "ACTIVE",
      lastActiveAt: new Date(),
      progressJson: {
        ...progress,
        moodCheckIn,
      },
      lessonSession: {
        update: {
          events: {
            create: {
              organisationId: participant.organisationId,
              studentId: input.studentId,
              type: "MOOD_CHECKED_IN",
              blockKey: participant.currentBlockKey,
              payload: moodCheckIn,
            },
          },
        },
      },
    },
  });

  if (moodCheckIn.actionLevel === "INTERVENE") {
    await prisma.lessonSessionEvent.create({
      data: {
        organisationId: participant.organisationId,
        lessonSessionId: participant.lessonSessionId,
        studentId: input.studentId,
        type: "MOOD_INTERVENTION_ALERT",
        blockKey: participant.currentBlockKey,
        payload: moodCheckIn,
      },
    });
  }

  return { moodCheckIn, participant: updated };
}

export async function advanceLiveLessonBlock(input: {
  lessonSessionId: string;
  tutorUserId: string;
  blockKey: string;
}) {
  const lesson = await getLiveLessonSession(input.lessonSessionId);
  if (lesson.tutorUserId !== input.tutorUserId) {
    await getTutorUser(input.tutorUserId);
  }

  const updated = await prisma.lessonSession.update({
    where: { id: input.lessonSessionId },
    data: {
      status: lesson.status === "DRAFT" ? "LIVE" : lesson.status,
      currentBlockKey: input.blockKey,
      blockStartedAt: new Date(),
      startedAt: lesson.startedAt ?? new Date(),
      participants: {
        updateMany: {
          where: { lessonSessionId: input.lessonSessionId },
          data: { currentBlockKey: input.blockKey },
        },
      },
      events: {
        create: {
          organisationId: lesson.organisationId,
          userId: input.tutorUserId,
          type: "BLOCK_STARTED",
          blockKey: input.blockKey,
          payload: {},
        },
      },
    },
    include: liveLessonInclude,
  });

  return updated;
}

export async function completeLiveLessonObjective(input: {
  lessonSessionId: string;
  tutorUserId: string;
}) {
  const lesson = await getLiveLessonSession(input.lessonSessionId);
  const tutor = await getTutorUser(input.tutorUserId);
  if (tutor.organisationId !== lesson.organisationId) {
    throw new Error("Tutor is not authorised for this live lesson");
  }

  const completedAt = new Date();
  const alreadyCompleted = lesson.status === "COMPLETED" || Boolean(lesson.endedAt);

  const updated = await prisma.lessonSession.update({
    where: { id: input.lessonSessionId },
    data: {
      status: "COMPLETED",
      endedAt: lesson.endedAt ?? completedAt,
      startedAt: lesson.startedAt ?? completedAt,
      participants: {
        updateMany: {
          where: { lessonSessionId: input.lessonSessionId },
          data: {
            status: "COMPLETED",
            lastActiveAt: completedAt,
          },
        },
      },
      events: alreadyCompleted
        ? undefined
        : {
            create: {
              organisationId: lesson.organisationId,
              userId: input.tutorUserId,
              type: "OBJECTIVE_COMPLETED",
              blockKey: lesson.currentBlockKey,
              payload: {
                objectiveId: lesson.objectiveId,
                title: lesson.title,
                completedAt: completedAt.toISOString(),
              },
            },
          },
    },
    include: liveLessonInclude,
  });

  return updated;
}

export async function cancelIncompleteLiveLesson(input: {
  lessonSessionId: string;
  tutorUserId: string;
}) {
  const lesson = await getLiveLessonSession(input.lessonSessionId);
  const tutor = await getTutorUser(input.tutorUserId);
  if (tutor.organisationId !== lesson.organisationId) {
    throw new Error("Tutor is not authorised for this live lesson");
  }

  if (lesson.status === "COMPLETED" || lesson.endedAt) {
    throw new Error("Completed lessons cannot be ended from the student list.");
  }

  if (!["LIVE", "ACTIVE", "IN_PROGRESS", "STARTED"].includes(lesson.status)) {
    throw new Error("Only live or started lessons can be ended from the student list.");
  }

  const cancelledAt = new Date();
  return prisma.lessonSession.update({
    where: { id: input.lessonSessionId },
    data: {
      status: "ARCHIVED",
      participants: {
        updateMany: {
          where: { lessonSessionId: input.lessonSessionId },
          data: {
            status: "CANCELLED",
            lastActiveAt: cancelledAt,
          },
        },
      },
      events: {
        create: {
          organisationId: lesson.organisationId,
          userId: input.tutorUserId,
          type: "INCOMPLETE_LESSON_CANCELLED",
          blockKey: lesson.currentBlockKey,
          payload: {
            objectiveId: lesson.objectiveId,
            title: lesson.title,
            cancelledAt: cancelledAt.toISOString(),
            reason: "Ended before completion so it can be selected again.",
          },
        },
      },
    },
    include: liveLessonInclude,
  });
}

export async function regenerateLiveLessonTeachingCards(input: {
  lessonSessionId: string;
  tutorUserId: string;
}) {
  const lesson = await getLiveLessonSession(input.lessonSessionId);
  const tutor = await getTutorUser(input.tutorUserId);
  if (tutor.organisationId !== lesson.organisationId) {
    throw new Error("Tutor is not authorised for this live lesson");
  }

  const participants = await Promise.all(
    lesson.participants.map(async (participant) => {
      const runtimeJson =
        participant.runtimeJson && typeof participant.runtimeJson === "object"
          ? (participant.runtimeJson as Record<string, any>)
          : {};
      const neuroTeachingCards = await generateNeuroTeachingCards({
        screenPayload: runtimeJson,
      });
      return {
        participantId: participant.id,
        runtimeJson: {
          ...runtimeJson,
          neuroTeachingCards,
        },
        neuroTeachingCards,
      };
    }),
  );

  const firstCards = participants[0]?.neuroTeachingCards ?? [];
  const tutorRuntimeJson =
    lesson.tutorRuntimeJson && typeof lesson.tutorRuntimeJson === "object"
      ? (lesson.tutorRuntimeJson as Record<string, any>)
      : {};

  const updated = await prisma.$transaction(async (tx) => {
    for (const participant of participants) {
      await tx.lessonSessionParticipant.update({
        where: { id: participant.participantId },
        data: {
          runtimeJson: participant.runtimeJson as any,
          lastActiveAt: new Date(),
        },
      });
    }

    return tx.lessonSession.update({
      where: { id: input.lessonSessionId },
      data: {
        tutorRuntimeJson: {
          ...tutorRuntimeJson,
          neuroTeachingCards: firstCards,
        } as any,
        events: {
          create: {
            organisationId: lesson.organisationId,
            userId: input.tutorUserId,
            type: "TEACHING_CARDS_REGENERATED",
            blockKey: lesson.currentBlockKey,
            payload: {
              participantCount: participants.length,
              cardCount: firstCards.length,
            },
          },
        },
      },
      include: liveLessonInclude,
    });
  });

  return updated;
}


function normaliseAnswer(value: string) {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

function normaliseChoice(value: unknown) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

function formatOakText(value: string) {
  return value
    .replace(/\{\{\s*\}\}/g, "____")
    .replace(/\$\$/g, "")
    .replace(/\\text\{([^{}]+)\}/g, "$1")
    .replace(/\\(?:dfrac|frac)\{([^{}]+)\}\{([^{}]+)\}/g, "$1/$2")
    .replace(/(\d+)\s*\{\s*([^{}]+?)\s+\\?over\s+\{?([^{}]+?)\}?\s*\}/g, "$1 $2/$3")
    .replace(/\{\s*([^{}]+?)\s+\\?over\s+\{?([^{}]+?)\}?\s*\}/g, "$1/$2")
    .replace(/\{\s*([^{}]+?)\s*\}\s*\\?over\s*\{\s*([^{}]+?)\s*\}/g, "$1/$2")
    .replace(/((?=[^{}\s]*\d)[^{}\s]+)\s+\\?over\s+((?=[^{}\s]*\d)[^{}\s]+)/g, "$1/$2")
    .replace(/(\d+)\{(\d+\/\d+)\}/g, "$1 $2")
    .replace(/\\times/g, "x")
    .replace(/\\div/g, "/")
    .replace(/\\le/g, "<=")
    .replace(/\\ge/g, ">=")
    .replace(/\\not=/g, "!=")
    .replace(/\s+([.,;:!?])/g, "$1")
    .replace(/\s+/g, " ")
    .trim();
}

function normaliseOakAnswer(value: unknown) {
  return normaliseAnswer(formatOakText(String(value ?? "")));
}

function labelFromOakAnswerContent(value: unknown) {
  return labelFromOakAnswerContentAt(value, 0);
}

function optionLetter(index: number) {
  return String.fromCharCode(65 + index);
}

function labelFromOakAnswerContentAt(value: unknown, index: number) {
  if (value && typeof value === "object") {
    const raw = value as Record<string, unknown>;
    const url = String(raw.url ?? "").trim();
    if (url) {
      return String(raw.text ?? raw.label ?? "").trim() || `Option ${optionLetter(index)}`;
    }
    return formatOakText(String(raw.text ?? raw.label ?? raw.alt ?? JSON.stringify(value)).trim());
  }

  return formatOakText(String(value ?? "").trim());
}

function oakCorrectAnswers(question: any) {
  const rawAnswers = question?.contentJson?.oak?.rawAnswers;
  if (!Array.isArray(rawAnswers)) return [];

  return rawAnswers
    .filter((answer: any) => answer?.distractor === false)
    .map((answer: any, index: number) => labelFromOakAnswerContentAt(answer?.content, index))
    .filter(Boolean);
}

function oakSingleChoiceAnswers(question: any) {
  const rawAnswers = question?.contentJson?.oak?.rawAnswers;
  if (!Array.isArray(rawAnswers)) return [];

  return rawAnswers
    .filter((answer: any) => answer?.distractor === false || answer?.isCorrect === true)
    .map((answer: any, index: number) =>
      labelFromOakAnswerContentAt(answer?.content ?? answer?.label, index),
    )
    .filter(Boolean);
}

function oakMatchPairs(question: any) {
  const rawAnswers = question?.contentJson?.oak?.rawAnswers;
  if (!Array.isArray(rawAnswers)) return [];

  return rawAnswers
    .map((answer: any, index: number) => {
      const left = labelFromOakAnswerContentAt(answer?.matchOption?.content, index);
      const right = labelFromOakAnswerContentAt(answer?.correctChoice?.content, index);
      return left && right ? { left, right } : null;
    })
    .filter((pair: { left: string; right: string } | null): pair is { left: string; right: string } => pair !== null);
}

function parseStructuredAnswer(value: string): unknown {
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function canonicalTruth(question: any) {
  const contentJson =
    question?.contentJson && typeof question.contentJson === "object"
      ? question.contentJson
      : null;
  const truth =
    contentJson?.canonicalTruth && typeof contentJson.canonicalTruth === "object"
      ? contentJson.canonicalTruth
      : null;
  return truth as
    | {
        answerContract?: string;
        immutableAnswers?: unknown[];
        orderedAnswers?: unknown[];
        requiredAnswerCount?: number;
        matchPairs?: Array<{ left?: unknown; right?: unknown }>;
      }
    | null;
}

function normalisePairs(pairs: Array<{ left?: unknown; right?: unknown }>) {
  return pairs
    .map((pair) => ({
      left: normaliseChoice(pair.left),
      right: normaliseChoice(pair.right),
    }))
    .filter((pair) => pair.left && pair.right)
    .map((pair) => `${pair.left} -> ${pair.right}`);
}

function markLiveLessonAnswer(question: any, answerText: string) {
  const truth = canonicalTruth(question);
  if (truth?.answerContract === "single_choice") {
    const expected = normaliseOakAnswer(question.answerText ?? "");
    const recoveredExpected = expected === "[object object]"
      ? oakSingleChoiceAnswers(question).map(normaliseOakAnswer)
      : [expected, ...oakSingleChoiceAnswers(question).map(normaliseOakAnswer)];
    const actual = normaliseOakAnswer(answerText);

    return recoveredExpected.length
      ? recoveredExpected.some((answer) => answerMaskMatches(answer, actual))
      : answerMaskMatches(expected, actual);
  }

  if (truth?.answerContract === "match_pairs") {
    const parsed = parseStructuredAnswer(answerText);
    const submittedPairs =
      parsed && typeof parsed === "object" && Array.isArray((parsed as any).pairs)
        ? (parsed as any).pairs
        : String(answerText)
            .split(";")
            .map((item) => {
              const [left, right] = item.split("->");
              return { left, right };
            });

    const truthPairs = Array.isArray(truth.matchPairs) ? truth.matchPairs : [];
    const expectedPairs = truthPairs.length ? truthPairs : oakMatchPairs(question);
    const expected = normalisePairs(expectedPairs);
    const actual = normalisePairs(submittedPairs);

    if (!expected.length || actual.length !== expected.length) return false;
    const expectedSet = new Set(expected);
    return (
      actual.every((item) => expectedSet.has(item)) &&
      new Set(actual).size === expectedSet.size
    );
  }

  if (truth?.answerContract === "multi_blank_choice") {
    const parsed = parseStructuredAnswer(answerText);
    const submitted =
      parsed && typeof parsed === "object" && Array.isArray((parsed as any).slots)
        ? (parsed as any).slots
        : String(answerText)
            .split(/[|,;]/)
            .map((item) => item.trim())
            .filter(Boolean);

    const expected = Array.isArray(truth.immutableAnswers)
      ? truth.immutableAnswers.map(normaliseChoice)
      : [];
    const recoveredExpected = expected.some((answer) => answer === "[object object]")
      ? oakCorrectAnswers(question).map(normaliseChoice)
      : expected;
    const actual = submitted.map(normaliseChoice);

    if (!recoveredExpected.length || actual.length !== recoveredExpected.length) return false;
    const unmatched = [...recoveredExpected];
    for (const submitted of actual) {
      const matchIndex = unmatched.findIndex((expectedAnswer) =>
        answerMaskMatches(expectedAnswer, submitted),
      );
      if (matchIndex < 0) return false;
      unmatched.splice(matchIndex, 1);
    }
    return unmatched.length === 0;
  }

  if (truth?.answerContract === "ordered_sequence") {
    const parsed = parseStructuredAnswer(answerText);
    const submitted =
      parsed && typeof parsed === "object" && Array.isArray((parsed as any).orderedAnswers)
        ? (parsed as any).orderedAnswers
        : String(answerText)
            .split(/->|[|,;]/)
            .map((item) => item.trim())
            .filter(Boolean);
    const expectedSource = Array.isArray(truth.orderedAnswers) && truth.orderedAnswers.length
      ? truth.orderedAnswers
      : Array.isArray(truth.immutableAnswers)
        ? truth.immutableAnswers
        : [];
    const expected = expectedSource.map(normaliseChoice);
    const actual = submitted.map(normaliseChoice);

    if (!expected.length || actual.length !== expected.length) return false;
    return expected.every((item, index) => answerMaskMatches(item, actual[index] ?? ""));
  }

  return answerMaskMatches(question.answerText ?? "", answerText);
}

function displayCorrectAnswer(question: any) {
  const raw = formatOakText(String(question.answerText ?? ""));
  if (raw.trim() !== "[object Object]") return raw;

  const truth = canonicalTruth(question);
  if (truth?.answerContract === "single_choice") {
    const recovered = oakSingleChoiceAnswers(question);
    if (recovered.length) return recovered.join(" / ");
  }

  if (truth?.answerContract === "match_pairs") {
    const recovered = oakMatchPairs(question);
    if (recovered.length) {
      return recovered.map((pair) => `${pair.left} -> ${pair.right}`).join("; ");
    }
  }

  return raw;
}

function allPersonalisedQuestions(runtimeJson: any) {
  const rounds = Array.isArray(runtimeJson?.personalisedQuestionRounds)
    ? runtimeJson.personalisedQuestionRounds
    : [];
  return rounds.flatMap((round: any) =>
    Array.isArray(round?.questions)
      ? round.questions.map((question: any) => ({ ...question, roundKey: round.key }))
      : [],
  );
}

export async function submitLiveLessonAnswer(input: {
  lessonSessionId: string;
  studentId: string;
  questionId: string;
  answerText: string;
}) {
  const participant = await prisma.lessonSessionParticipant.findUnique({
    where: {
      lessonSessionId_studentId: {
        lessonSessionId: input.lessonSessionId,
        studentId: input.studentId,
      },
    },
  });

  if (!participant) throw new Error("Student is not part of this live lesson");

  const questions = allPersonalisedQuestions(participant.runtimeJson);
  const question = questions.find((item: any) => item.id === input.questionId);
  if (!question) throw new Error("Question is not part of this student's live lesson");

  const isCorrect = markLiveLessonAnswer(question, input.answerText);
  const expectedAnswer = displayCorrectAnswer(question);
  const progress =
    participant.progressJson && typeof participant.progressJson === "object"
      ? (participant.progressJson as Record<string, any>)
      : {};
  const answeredQuestionIds = Array.from(
    new Set([...(Array.isArray(progress.answeredQuestionIds) ? progress.answeredQuestionIds : []), input.questionId]),
  );
  const correctQuestionIds = Array.from(
    new Set([
      ...(Array.isArray(progress.correctQuestionIds) ? progress.correctQuestionIds : []),
      ...(isCorrect ? [input.questionId] : []),
    ]),
  );

  const updated = await prisma.lessonSessionParticipant.update({
    where: { id: participant.id },
    data: {
      status: "ACTIVE",
      currentQuestionId: input.questionId,
      questionsAnswered: answeredQuestionIds.length,
      questionsCorrect: correctQuestionIds.length,
      lastActiveAt: new Date(),
      progressJson: {
        ...progress,
        answeredQuestionIds,
        correctQuestionIds,
        latestAnswer: {
          questionId: input.questionId,
          answerText: input.answerText,
          expectedAnswer,
          isCorrect,
          answeredAt: new Date().toISOString(),
        },
      },
      lessonSession: {
        update: {
          events: {
            create: {
              organisationId: participant.organisationId,
              studentId: input.studentId,
              type: "QUESTION_ANSWERED",
              blockKey: participant.currentBlockKey,
              payload: {
                questionId: input.questionId,
                answerText: input.answerText,
                expectedAnswer,
                isCorrect,
                objectiveCode: question.objectiveCode,
                roundKey: question.roundKey,
              },
            },
          },
        },
      },
    },
  });

  return {
    isCorrect,
    correctAnswer: expectedAnswer,
    participant: updated,
  };
}
