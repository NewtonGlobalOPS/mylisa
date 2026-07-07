import "dotenv/config";
import { Role, Subject, type KeyStage } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";
import { createLiveLessonSession } from "../src/services/liveLesson.service.js";
import {
  buildFourWeekReviewQuiz,
  createLessonPlanFromTopic,
} from "../src/services/lessonPlan.service.js";

type Args = {
  studentId: string;
  topic: string;
  lessonPlanId?: string;
  tutorUserId?: string;
  subject: Subject;
  keyStage?: KeyStage;
  yearGroup?: number;
  launch: boolean;
};

function usage() {
  return [
    "Usage:",
    "  npx tsx scripts/smoke-test-lesson-planning.ts --student-id <id> --topic \"Pythagoras theorem\" [--tutor-user-id <id>] [--subject MATHS] [--key-stage KS3] [--year-group 8] [--launch]",
    "  npx tsx scripts/smoke-test-lesson-planning.ts --student-id <id> --lesson-plan-id <id> --topic \"Existing plan smoke\" [--launch]",
    "",
    "Notes:",
    "  - Creates a real DRAFT LessonPlan for the learner.",
    "  - Builds a four-week review quiz draft.",
    "  - Does not launch a live lesson unless --launch is passed.",
  ].join("\n");
}

function readArgs(argv: string[]): Args {
  const values = new Map<string, string | true>();
  for (let i = 0; i < argv.length; i += 1) {
    const item = argv[i];
    if (!item.startsWith("--")) continue;
    const key = item.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith("--")) {
      values.set(key, true);
      continue;
    }
    values.set(key, next);
    i += 1;
  }

  const studentId = String(values.get("student-id") ?? "").trim();
  const topic = String(values.get("topic") ?? "").trim();
  const lessonPlanId = String(values.get("lesson-plan-id") ?? "").trim() || undefined;
  if (!studentId || !topic) {
    throw new Error(`${usage()}\n\nMissing required --student-id or --topic. Pass --lesson-plan-id only when reusing an existing plan.`);
  }

  const subject = String(values.get("subject") ?? "MATHS").toUpperCase();
  if (!Object.values(Subject).includes(subject as Subject)) {
    throw new Error(`Unsupported subject: ${subject}`);
  }

  const keyStageValue = values.get("key-stage");
  const keyStage = typeof keyStageValue === "string" ? keyStageValue.toUpperCase() : undefined;
  if (keyStage && !["KS1", "KS2", "KS3", "KS4"].includes(keyStage)) {
    throw new Error(`Unsupported key stage: ${keyStage}`);
  }

  const yearGroupValue = values.get("year-group");
  const yearGroup =
    typeof yearGroupValue === "string" && yearGroupValue.trim()
      ? Number.parseInt(yearGroupValue, 10)
      : undefined;
  if (yearGroup !== undefined && (!Number.isInteger(yearGroup) || yearGroup < 1 || yearGroup > 13)) {
    throw new Error(`Unsupported year group: ${yearGroupValue}`);
  }

  const tutorUserId = values.get("tutor-user-id");

  return {
    studentId,
    topic,
    lessonPlanId,
    tutorUserId: typeof tutorUserId === "string" ? tutorUserId : undefined,
    subject: subject as Subject,
    keyStage: keyStage as KeyStage | undefined,
    yearGroup,
    launch: values.has("launch"),
  };
}

async function resolveTutorUserId(input: Args) {
  if (input.tutorUserId) {
    const user = await prisma.user.findUnique({
      where: { id: input.tutorUserId },
      select: { id: true, role: true, organisationId: true, email: true },
    });
    if (!user) throw new Error(`Tutor user not found: ${input.tutorUserId}`);
    if (user.role !== Role.STAFF && user.role !== Role.ADMIN) {
      throw new Error(`User ${user.email} is ${user.role}, not STAFF or ADMIN.`);
    }
    return user.id;
  }

  const student = await prisma.student.findUnique({
    where: { id: input.studentId },
    select: { organisationId: true },
  });
  if (!student) throw new Error(`Student not found: ${input.studentId}`);

  const tutor = await prisma.user.findFirst({
    where: {
      organisationId: student.organisationId,
      role: { in: [Role.STAFF, Role.ADMIN] },
      isActive: true,
    },
    orderBy: [{ role: "desc" }, { createdAt: "asc" }],
    select: { id: true },
  });
  if (!tutor) throw new Error("No active STAFF or ADMIN user found for this student's organisation.");
  return tutor.id;
}

function assertSmokeResult(input: {
  plan: Awaited<ReturnType<typeof createLessonPlanFromTopic>>;
  reviewQuiz: Awaited<ReturnType<typeof buildFourWeekReviewQuiz>>;
}) {
  const { plan, reviewQuiz } = input;
  const failures: string[] = [];

  if (!plan.id) failures.push("LessonPlan was not created.");
  if (!plan.objectives.length) failures.push("LessonPlan has no Oak objective alignments.");
  if (!plan.sections.length) failures.push("LessonPlan has no lesson sections.");
  if (!plan.assessmentBlueprints.length) failures.push("LessonPlan has no assessment blueprint.");

  const generatedReadyItems = reviewQuiz.quizDraft.generatedCandidates.filter(
    (item: any) => item.status === "ASSESSMENT_READY" || item.source === "OAK_CANONICAL",
  );
  if (generatedReadyItems.length) {
    failures.push("Generated quiz candidates are being treated as assessment-ready.");
  }

  if (!reviewQuiz.taughtCoverage.length) failures.push("Four-week review has no taught coverage.");

  if (failures.length) {
    throw new Error(`Smoke test failed:\n- ${failures.join("\n- ")}`);
  }
}

async function main() {
  const args = readArgs(process.argv.slice(2));
  const tutorUserId = await resolveTutorUserId(args);

  console.log(args.lessonPlanId
    ? "[lesson-planning-smoke] Loading existing governed lesson plan..."
    : "[lesson-planning-smoke] Creating governed lesson plan...");
  const plan = args.lessonPlanId
    ? await prisma.lessonPlan.findFirstOrThrow({
        where: { id: args.lessonPlanId, studentId: args.studentId },
        include: {
          objectives: { include: { objective: true }, orderBy: { sequence: "asc" } },
          sections: { orderBy: { sequence: "asc" } },
          assessmentBlueprints: { orderBy: { createdAt: "desc" } },
        },
      })
    : await createLessonPlanFromTopic({
        tutorUserId,
        studentId: args.studentId,
        topic: args.topic,
        subject: args.subject,
        keyStage: args.keyStage,
        yearGroup: args.yearGroup,
        maxObjectives: 6,
        assessmentCadenceWeeks: 4,
      });

  console.log("[lesson-planning-smoke] Building four-week review quiz draft...");
  const reviewQuiz = await buildFourWeekReviewQuiz({
    tutorUserId,
    studentId: args.studentId,
    subject: args.subject,
    weeks: 4,
    maxQuestions: 16,
  });

  assertSmokeResult({ plan, reviewQuiz });

  let lessonSessionId: string | null = null;
  if (args.launch) {
    const objectiveId = plan.objectives[0]?.objectiveId;
    if (!objectiveId) throw new Error("Cannot launch: saved plan has no anchor objective.");

    console.log("[lesson-planning-smoke] Launching linked draft live lesson...");
    const lesson = await createLiveLessonSession({
      tutorUserId,
      objectiveId,
      studentIds: [args.studentId],
      lessonPlanId: plan.id,
      title: `Smoke: ${plan.title}`,
    });
    lessonSessionId = lesson.id;
  }

  console.log(JSON.stringify({
    ok: true,
    lessonPlan: {
      id: plan.id,
      title: plan.title,
      objectiveCount: plan.objectives.length,
      sectionCount: plan.sections.length,
      assessmentBlueprintCount: plan.assessmentBlueprints.length,
      anchorObjective: plan.objectives[0]
        ? {
            objectiveId: plan.objectives[0].objectiveId,
            code: plan.objectives[0].objective.code,
            title: plan.objectives[0].objective.title,
          }
        : null,
    },
    fourWeekReviewQuiz: {
      taughtObjectiveCount: reviewQuiz.taughtCoverage.length,
      oakCanonicalItems: reviewQuiz.quizDraft.oakCanonicalItems.length,
      generatedCandidates: reviewQuiz.quizDraft.generatedCandidates.length,
      generatedCandidateStatuses: Array.from(
        new Set(reviewQuiz.quizDraft.generatedCandidates.map((item: any) => item.status)),
      ),
    },
    lessonSessionId,
  }, null, 2));
}

main()
  .catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
