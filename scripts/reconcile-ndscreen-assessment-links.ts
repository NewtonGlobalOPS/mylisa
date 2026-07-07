import "dotenv/config";
import { IntegrationSource, Subject, TaskType } from "@prisma/client";
import { prisma } from "../src/lib/prisma.js";

type NdscreenChildScreening = {
  sessionId: string;
  child: {
    displayName: string | null;
    legalFirstName: string | null;
    legalLastName: string | null;
  };
  guardian: {
    email: string | null;
  } | null;
};

type ReconcileAction = {
  sessionId: string;
  studentId: string;
  parentEmail: string;
  assessmentSessionId: string | null;
  action: "CREATE_LINK" | "UPDATE_ASSESSMENT_LINK" | "NOOP";
};

function hasFlag(name: string) {
  return process.argv.includes(name);
}

function cleanText(value: unknown) {
  return String(value ?? "").trim();
}

function normalize(value: unknown) {
  return cleanText(value).toLowerCase();
}

function getNdscreenBaseUrl() {
  return cleanText(process.env.NDSCREEN_API_BASE_URL || "http://127.0.0.1:4098").replace(/\/+$/, "");
}

function getNdscreenExportToken() {
  const token = cleanText(process.env.NDSCREEN_EXPORT_TOKEN);
  if (!token) throw new Error("Missing NDSCREEN_EXPORT_TOKEN");
  return token;
}

function parsedChildName(screening: NdscreenChildScreening) {
  const displayName = cleanText(screening.child.displayName);
  const parts = displayName.split(/\s+/).filter(Boolean);
  return {
    firstName: normalize(screening.child.legalFirstName || parts[0]),
    lastName: normalize(screening.child.legalLastName || parts.slice(1).join(" ")),
    guardianEmail: normalize(screening.guardian?.email),
  };
}

async function listNdscreenChildScreenings() {
  const response = await fetch(`${getNdscreenBaseUrl()}/api/integrations/mylisa/children`, {
    headers: {
      authorization: `Bearer ${getNdscreenExportToken()}`,
    },
  });

  const data = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(data?.error ?? `NDSCREEN children export failed (${response.status})`);
  }

  return (data?.items ?? []) as NdscreenChildScreening[];
}

async function main() {
  const apply = hasFlag("--apply");
  const screenings = await listNdscreenChildScreenings();

  const existingLinks = await prisma.studentIntegrationLink.findMany({
    where: {
      source: IntegrationSource.NDSCREEN,
    },
    select: {
      id: true,
      studentId: true,
      externalId: true,
      ndscreenSessionId: true,
      assessmentSessionId: true,
    },
  });
  const existingLinkBySessionId = new Map(
    existingLinks
      .filter((link) => link.ndscreenSessionId)
      .map((link) => [link.ndscreenSessionId as string, link])
  );

  const students = await prisma.student.findMany({
    select: {
      id: true,
      firstName: true,
      lastName: true,
      guardianEmail: true,
      attempts: {
        where: {
          taskType: TaskType.ASSESSMENT,
          subject: Subject.MATHS,
        },
        orderBy: [{ submittedAt: "desc" }, { updatedAt: "desc" }],
        select: {
          id: true,
          status: true,
        },
      },
    },
  });

  const actions: ReconcileAction[] = [];
  let skippedAlreadyLinked = 0;
  let skippedAmbiguousStudent = 0;
  let skippedNoStudentMatch = 0;
  let skippedMissingIdentity = 0;
  let skippedAmbiguousAssessment = 0;

  for (const screening of screenings) {
    const identity = parsedChildName(screening);
    if (!identity.guardianEmail || !identity.firstName || !identity.lastName) {
      skippedMissingIdentity += 1;
      continue;
    }

    const candidates = students.filter(
      (student) =>
        normalize(student.guardianEmail) === identity.guardianEmail &&
        normalize(student.firstName) === identity.firstName &&
        normalize(student.lastName) === identity.lastName
    );

    if (candidates.length > 1) {
      skippedAmbiguousStudent += 1;
      continue;
    }
    if (candidates.length === 0) {
      skippedNoStudentMatch += 1;
      continue;
    }

    const student = candidates[0];
    const assessmentSessionId = student.attempts.length === 1 ? student.attempts[0].id : null;
    if (student.attempts.length > 1) skippedAmbiguousAssessment += 1;

    const existing = existingLinkBySessionId.get(screening.sessionId);
    if (existing) {
      if (!existing.assessmentSessionId && assessmentSessionId) {
        actions.push({
          sessionId: screening.sessionId,
          studentId: existing.studentId,
          parentEmail: identity.guardianEmail,
          assessmentSessionId,
          action: "UPDATE_ASSESSMENT_LINK",
        });
      } else {
        skippedAlreadyLinked += 1;
      }
      continue;
    }

    actions.push({
      sessionId: screening.sessionId,
      studentId: student.id,
      parentEmail: identity.guardianEmail,
      assessmentSessionId,
      action: "CREATE_LINK",
    });
  }

  if (apply) {
    const now = new Date();
    for (const action of actions) {
      if (action.action === "CREATE_LINK") {
        await prisma.studentIntegrationLink.upsert({
          where: {
            source_externalId: {
              source: IntegrationSource.NDSCREEN,
              externalId: action.sessionId,
            },
          },
          update: {
            studentId: action.studentId,
            externalType: "DIRECT_SCREENING_EXPORT",
            parentEmail: action.parentEmail,
            ndscreenSessionId: action.sessionId,
            assessmentSessionId: action.assessmentSessionId,
            syncedAt: now,
          },
          create: {
            studentId: action.studentId,
            source: IntegrationSource.NDSCREEN,
            externalId: action.sessionId,
            externalType: "DIRECT_SCREENING_EXPORT",
            parentEmail: action.parentEmail,
            ndscreenSessionId: action.sessionId,
            assessmentSessionId: action.assessmentSessionId,
            syncedAt: now,
          },
        });
      }

      if (action.action === "UPDATE_ASSESSMENT_LINK" && action.assessmentSessionId) {
        await prisma.studentIntegrationLink.update({
          where: {
            source_externalId: {
              source: IntegrationSource.NDSCREEN,
              externalId: action.sessionId,
            },
          },
          data: {
            assessmentSessionId: action.assessmentSessionId,
            syncedAt: now,
          },
        });
      }
    }
  }

  const summary = {
    mode: apply ? "apply" : "dry-run",
    screenings: screenings.length,
    actions: actions.length,
    createLinks: actions.filter((action) => action.action === "CREATE_LINK").length,
    updateAssessmentLinks: actions.filter((action) => action.action === "UPDATE_ASSESSMENT_LINK").length,
    createLinksWithAssessmentSessionId: actions.filter(
      (action) => action.action === "CREATE_LINK" && action.assessmentSessionId
    ).length,
    skippedAlreadyLinked,
    skippedAmbiguousStudent,
    skippedNoStudentMatch,
    skippedMissingIdentity,
    skippedAmbiguousAssessment,
  };

  console.log(JSON.stringify(summary, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
