import bcrypt from "bcryptjs";
import { IntegrationSource, KeyStage, Role, Subject } from "@prisma/client";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";

const bookingTypeSchema = z.enum([
  "ADULT_ADHD_AUTISM",
  "ADULT_LEARNING_DIFFICULTIES",
  "ADULT_COMBINED",
  "CHILD_ADHD_AUTISM",
  "CHILD_LEARNING_LEVEL",
  "CHILD_LEARNING_DIFFICULTIES",
  "CHILD_COMBINED_ADHD_AUTISM_LEARNING_DIFFICULTIES",
  "CHILD_COMBINED_ALL",
]);

const bookingExportSchema = z.object({
  booking: z.object({
    id: z.string().min(1),
    bookingType: bookingTypeSchema,
    status: z.string().min(1).optional(),
    isForAdult: z.boolean().optional(),
    parentFirstName: z.string().min(1),
    parentLastName: z.string().min(1),
    email: z.string().email(),
    phone: z.string().min(1),
    addressLine1: z.string().min(1),
    addressLine2: z.string().nullable().optional(),
    city: z.string().nullable().optional(),
    postcode: z.string().nullable().optional(),
    childFirstName: z.string().nullable().optional(),
    childLastName: z.string().nullable().optional(),
    childDob: z.string().nullable().optional(),
    childYearGroup: z.string().nullable().optional(),
    currentSchool: z.string().nullable().optional(),
    ndscreenSessionId: z.string().nullable().optional(),
    ndscreenScreeningKind: z.string().nullable().optional(),
    ndscreenQuestionSetKey: z.string().nullable().optional(),
    ndscreenQuestionSetVersion: z.number().int().nullable().optional(),
  }),
});

type RemoteBooking = z.infer<typeof bookingExportSchema>["booking"];

function requiredEnv(name: string) {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new Error(`Missing env var: ${name}`);
  }
  return value;
}

function safeParseJson(text: string) {
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

function normalizeIsoDate(value?: string | null) {
  const raw = String(value ?? "").trim();
  if (!raw) return null;
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function ageFromDateOfBirth(dateOfBirth?: Date | null) {
  if (!dateOfBirth) return null;
  const today = new Date();
  let age = today.getUTCFullYear() - dateOfBirth.getUTCFullYear();
  const hasHadBirthdayThisYear =
    today.getUTCMonth() > dateOfBirth.getUTCMonth() ||
    (today.getUTCMonth() === dateOfBirth.getUTCMonth() &&
      today.getUTCDate() >= dateOfBirth.getUTCDate());

  if (!hasHadBirthdayThisYear) age -= 1;
  return age >= 0 ? age : null;
}

function schoolYearFromText(value?: string | null) {
  const raw = String(value ?? "").trim().toLowerCase();
  if (!raw) return null;
  if (raw.includes("reception")) return 0;
  const match = raw.match(/\b(\d{1,2})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) && year >= 1 && year <= 13 ? year : null;
}

function schoolYearToAge(schoolYear?: string | null) {
  const year = schoolYearFromText(schoolYear);
  if (year == null) return null;
  return year + 4;
}

function schoolYearToKeyStage(schoolYear: number | null): KeyStage | null {
  if (schoolYear == null) return null;
  if (schoolYear <= 2) return KeyStage.KS1;
  if (schoolYear <= 6) return KeyStage.KS2;
  if (schoolYear <= 9) return KeyStage.KS3;
  if (schoolYear <= 13) return KeyStage.KS4;
  return null;
}

function placeholderEmailForBooking(bookingId: string) {
  return `booking-${bookingId}@newtoncentre.mylisa.local`;
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

function childNameFromBooking(booking: RemoteBooking) {
  return {
    firstName: booking.childFirstName?.trim() || booking.parentFirstName.trim(),
    lastName: booking.childLastName?.trim() || booking.parentLastName.trim(),
  };
}

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

export function assertNewtonCentreWebhookSecret(provided: string | undefined) {
  const expected = requiredEnv("NEWTONCENTRE_WEBHOOK_SECRET");
  if (!provided || provided !== expected) {
    throw new Error("Unauthorized integration request");
  }
}

export async function fetchNewtonCentreBooking(bookingId: string) {
  const baseUrl = requiredEnv("NEWTONCENTRE_EXPORT_BASE_URL").replace(/\/+$/, "");
  const exportToken = requiredEnv("NEWTONCENTRE_EXPORT_TOKEN");

  const res = await fetch(
    `${baseUrl}/api/integrations/bookings/${encodeURIComponent(bookingId)}/export`,
    {
      headers: {
        Authorization: `Bearer ${exportToken}`,
      },
    },
  );

  const text = await res.text();
  const json = safeParseJson(text);

  if (!res.ok) {
    const message = (json as any)?.error || `Newton Centre booking fetch failed (${res.status})`;
    throw new Error(message);
  }

  return bookingExportSchema.parse(json).booking;
}

function isLearningBooking(bookingType: RemoteBooking["bookingType"]) {
  return (
    bookingType === "CHILD_LEARNING_LEVEL" ||
    bookingType === "CHILD_LEARNING_DIFFICULTIES" ||
    bookingType === "CHILD_COMBINED_ADHD_AUTISM_LEARNING_DIFFICULTIES" ||
    bookingType === "CHILD_COMBINED_ALL"
  );
}

async function findMatchingStudent(
  tx: Prisma.TransactionClient,
  organisationId: string,
  booking: RemoteBooking,
  dateOfBirth: Date | null
) {
  const child = childNameFromBooking(booking);
  const guardianEmail = booking.email.trim().toLowerCase();

  return tx.student.findFirst({
    where: {
      organisationId,
      guardianEmail,
      firstName: {
        equals: child.firstName,
        mode: "insensitive",
      },
      lastName: {
        equals: child.lastName,
        mode: "insensitive",
      },
      ...(dateOfBirth ? { dateOfBirth } : {}),
    },
    select: {
      id: true,
      userId: true,
      firstName: true,
      lastName: true,
      dateOfBirth: true,
      age: true,
      keyStage: true,
      guardianEmail: true,
    },
  });
}

export async function importNewtonCentreBooking(bookingId: string) {
  const booking = await fetchNewtonCentreBooking(bookingId);

  if (booking.isForAdult || !isLearningBooking(booking.bookingType)) {
    return {
      ok: false,
      skipped: true,
      reason: "Booking type does not require MyLisa learner creation",
      bookingId: booking.id,
    };
  }

  const organisationId = await getDefaultOrganisationId();
  const dateOfBirth = normalizeIsoDate(booking.childDob);
  const schoolYear = schoolYearFromText(booking.childYearGroup);
  const age =
    ageFromDateOfBirth(dateOfBirth) ??
    schoolYearToAge(booking.childYearGroup) ??
    8;
  const keyStage = schoolYearToKeyStage(schoolYear);
  const child = childNameFromBooking(booking);
  const guardianEmail = booking.email.trim().toLowerCase();

  return prisma.$transaction(async (tx) => {
    const existingLink = await tx.studentIntegrationLink.findUnique({
      where: {
        source_externalId: {
          source: IntegrationSource.NEWTONCENTRE,
          externalId: booking.id,
        },
      },
      select: {
        studentId: true,
      },
    });

    let studentId = existingLink?.studentId ?? null;
    let matchedExisting = Boolean(existingLink);

    if (!studentId) {
      const matchedStudent = await findMatchingStudent(
        tx,
        organisationId,
        booking,
        dateOfBirth
      );
      if (matchedStudent) {
        studentId = matchedStudent.id;
        matchedExisting = true;

        await tx.student.update({
          where: { id: matchedStudent.id },
          data: {
            firstName: matchedStudent.firstName || child.firstName,
            lastName: matchedStudent.lastName || child.lastName,
            dateOfBirth: matchedStudent.dateOfBirth ?? dateOfBirth,
            age: matchedStudent.age ?? age,
            keyStage: matchedStudent.keyStage ?? keyStage ?? undefined,
            guardianEmail: matchedStudent.guardianEmail ?? guardianEmail,
          },
        });
      }
    }

    if (!studentId) {
      const passwordHash = await bcrypt.hash(makeTempPassword(), 10);
      const created = await tx.user.create({
        data: {
          organisationId,
          email: placeholderEmailForBooking(booking.id),
          passwordHash,
          role: Role.STUDENT,
          isActive: true,
          student: {
            create: {
              organisationId,
              firstName: child.firstName,
              lastName: child.lastName,
              dateOfBirth: dateOfBirth ?? undefined,
              age,
              keyStage: keyStage ?? undefined,
              subjects: [Subject.MATHS],
              guardianEmail,
            },
          },
        },
        select: {
          student: {
            select: {
              id: true,
            },
          },
        },
      });

      studentId = created.student?.id ?? null;
      matchedExisting = false;
    }

    if (!studentId) {
      throw new Error("Failed to create or match student");
    }

    await tx.studentIntegrationLink.upsert({
      where: {
        source_externalId: {
          source: IntegrationSource.NEWTONCENTRE,
          externalId: booking.id,
        },
      },
      update: {
        externalType: booking.bookingType,
        parentEmail: guardianEmail,
        ndscreenSessionId: booking.ndscreenSessionId ?? null,
        syncedAt: new Date(),
      },
      create: {
        studentId,
        source: IntegrationSource.NEWTONCENTRE,
        externalId: booking.id,
        externalType: booking.bookingType,
        parentEmail: guardianEmail,
        ndscreenSessionId: booking.ndscreenSessionId ?? null,
        syncedAt: new Date(),
      },
    });

    return {
      ok: true,
      bookingId: booking.id,
      bookingType: booking.bookingType,
      studentId,
      matchedExisting,
      ndscreenSessionId: booking.ndscreenSessionId ?? null,
    };
  });
}
