import { IntegrationSource, KeyStage, Role, Subject } from "@prisma/client";
import bcrypt from "bcryptjs";
import { prisma } from "../lib/prisma.js";

type NdscreenChildScreening = {
  sessionId: string;
  createdAt: string;
  updatedAt: string;
  status: string;
  screeningKind: string;
  questionSet: {
    key: string;
    version: number;
  } | null;
  child: {
    displayName: string | null;
    legalFirstName: string | null;
    legalLastName: string | null;
    ageYears: number | null;
    schoolYear: string | null;
    locale: string | null;
    dob: string | null;
    schoolName: string | null;
  };
  guardian: {
    relationship: string | null;
    firstName: string | null;
    lastName: string | null;
    email: string | null;
    phone: string | null;
  } | null;
  report: {
    status: string | null;
    readyAt: string | null;
    generatedAt: string | null;
    errorMessage: string | null;
  };
  latestResult: {
    validity: string | null;
    confidence: number | null;
    confidenceBand: string | null;
    overall: number | null;
    overallAdjusted: number | null;
    profileType: string | null;
    recommendation: string | null;
  } | null;
  learningProfile: {
    summaryText: string | null;
    profiles: string[];
    primaryProfile: string | null;
    confidence: number | null;
    confidenceBand: string | null;
    summary: string | null;
    recommendation: string | null;
  } | null;
};

function cleanText(value: string | null | undefined) {
  return String(value ?? "").trim();
}

function requiredConfiguredValue(name: string) {
  const value = cleanText(process.env[name]);
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

function schoolYearFromText(value: string | null | undefined) {
  const raw = cleanText(value).toLowerCase();
  if (!raw) return null;
  if (raw.includes("reception")) return 1;
  const match = raw.match(/\b(\d{1,2})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) && year >= 1 && year <= 13 ? year : null;
}

function keyStageFromSchoolYear(schoolYear: number | null): KeyStage | null {
  if (schoolYear == null) return null;
  if (schoolYear <= 2) return KeyStage.KS1;
  if (schoolYear <= 6) return KeyStage.KS2;
  if (schoolYear <= 9) return KeyStage.KS3;
  return KeyStage.KS4;
}

function makePlaceholderEmail(sessionId: string) {
  return `ndscreen-${sessionId}@mylisa.local`;
}

function makeTempPassword(length = 16): string {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

function getNdscreenBaseUrl() {
  return cleanText(process.env.NDSCREEN_API_BASE_URL || "http://127.0.0.1:4098");
}

function getNdscreenExportToken() {
  return requiredConfiguredValue("NDSCREEN_EXPORT_TOKEN");
}

async function fetchNdscreenJson<T>(path: string): Promise<T> {
  const res = await fetch(`${getNdscreenBaseUrl().replace(/\/+$/, "")}${path}`, {
    headers: {
      authorization: `Bearer ${getNdscreenExportToken()}`,
    },
  });

  const data = await res.json().catch(() => null);
  if (!res.ok) {
    throw new Error(data?.error ?? `ndscreen request failed (${res.status})`);
  }

  return data as T;
}

export async function listNdscreenChildScreenings() {
  const data = await fetchNdscreenJson<{
    ok: boolean;
    count: number;
    items: NdscreenChildScreening[];
  }>("/api/integrations/mylisa/children");

  return data.items;
}

export async function getNdscreenChildScreening(sessionId: string) {
  const data = await fetchNdscreenJson<{
    ok: boolean;
    item: NdscreenChildScreening;
  }>(`/api/integrations/mylisa/children/${encodeURIComponent(sessionId)}`);

  return data.item;
}

async function getDefaultOrganisationId() {
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

async function findExistingStudentByScreening(input: {
  organisationId: string;
  sessionId: string;
  firstName: string | null;
  lastName: string | null;
  guardianEmail: string | null;
  dateOfBirth: Date | null;
}) {
  const byLink = await prisma.studentIntegrationLink.findFirst({
    where: {
      source: IntegrationSource.NDSCREEN,
      ndscreenSessionId: input.sessionId,
    },
    select: {
      studentId: true,
    },
  });

  if (byLink?.studentId) {
    return prisma.student.findUnique({
      where: { id: byLink.studentId },
      select: {
        id: true,
        userId: true,
        firstName: true,
        lastName: true,
        age: true,
        schoolYear: true,
        keyStage: true,
        guardianEmail: true,
        user: {
          select: {
            email: true,
          },
        },
      },
    });
  }

  if (!input.guardianEmail || !input.firstName || !input.lastName) return null;

  return prisma.student.findFirst({
    where: {
      organisationId: input.organisationId,
      guardianEmail: input.guardianEmail,
      firstName: {
        equals: input.firstName,
        mode: "insensitive",
      },
      lastName: {
        equals: input.lastName,
        mode: "insensitive",
      },
      ...(input.dateOfBirth ? { dateOfBirth: input.dateOfBirth } : {}),
    },
    select: {
      id: true,
      userId: true,
      firstName: true,
      lastName: true,
      age: true,
      schoolYear: true,
      keyStage: true,
      guardianEmail: true,
      user: {
        select: {
          email: true,
        },
      },
    },
  });
}

export async function importStudentFromNdscreen(sessionId: string) {
  const screening = await getNdscreenChildScreening(sessionId);
  const organisationId = await getDefaultOrganisationId();

  const firstName =
    cleanText(screening.child.legalFirstName) ||
    cleanText(screening.child.displayName).split(/\s+/)[0] ||
    "Child";
  const lastName =
    cleanText(screening.child.legalLastName) ||
    cleanText(screening.child.displayName).split(/\s+/).slice(1).join(" ") ||
    "Screening";
  const guardianEmail = cleanText(screening.guardian?.email).toLowerCase() || null;
  const schoolYear =
    schoolYearFromText(screening.child.schoolYear) ??
    (typeof screening.child.ageYears === "number" ? screening.child.ageYears - 4 : null) ??
    1;
  const age = screening.child.ageYears ?? Math.max(4, schoolYear + 4);
  const keyStage = keyStageFromSchoolYear(schoolYear);
  const dateOfBirth = screening.child.dob ? new Date(screening.child.dob) : null;

  const existing = await findExistingStudentByScreening({
    organisationId,
    sessionId,
    firstName,
    lastName,
    guardianEmail,
    dateOfBirth,
  });

  let studentId = existing?.id ?? null;
  let userId = existing?.userId ?? null;
  let email = existing?.user.email ?? null;

  if (!studentId) {
    const passwordHash = await bcrypt.hash(makeTempPassword(), 10);
    const created = await prisma.user.create({
      data: {
        organisationId,
        email: makePlaceholderEmail(sessionId),
        passwordHash,
        role: Role.STUDENT,
        isActive: true,
        student: {
          create: {
            organisationId,
            firstName,
            lastName,
            dateOfBirth: dateOfBirth ?? undefined,
            age,
            schoolYear,
            keyStage: keyStage ?? undefined,
            subjects: [Subject.MATHS],
            guardianEmail: guardianEmail ?? undefined,
          },
        },
      },
      select: {
        id: true,
        email: true,
        student: {
          select: {
            id: true,
          },
        },
      },
    });

    studentId = created.student?.id ?? null;
    userId = created.id;
    email = created.email;
  } else {
    await prisma.student.update({
      where: { id: studentId },
      data: {
        firstName,
        lastName,
        dateOfBirth: dateOfBirth ?? undefined,
        age,
        schoolYear,
        keyStage: keyStage ?? undefined,
        guardianEmail: guardianEmail ?? undefined,
      },
    });
  }

  if (!studentId || !userId || !email) {
    throw new Error("Failed to create or match student");
  }

  await prisma.studentIntegrationLink.upsert({
    where: {
      source_externalId: {
        source: IntegrationSource.NDSCREEN,
        externalId: sessionId,
      },
    },
    update: {
      externalType: "DIRECT_SCREENING_EXPORT",
      parentEmail: guardianEmail,
      ndscreenSessionId: sessionId,
      syncedAt: new Date(),
    },
    create: {
      studentId,
      source: IntegrationSource.NDSCREEN,
      externalId: sessionId,
      externalType: "DIRECT_SCREENING_EXPORT",
      parentEmail: guardianEmail,
      ndscreenSessionId: sessionId,
      syncedAt: new Date(),
    },
  });

  return {
    message: "Student created successfully",
    userId,
    studentId,
    email,
    student: {
      id: studentId,
      firstName,
      lastName,
      age,
      schoolYear,
      keyStage: keyStage ?? undefined,
      subjects: [Subject.MATHS],
      guardianEmail: guardianEmail ?? undefined,
    },
    ndscreenSessionId: sessionId,
    screening,
  };
}
