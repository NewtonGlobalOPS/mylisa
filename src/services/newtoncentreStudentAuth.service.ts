import bcrypt from "bcryptjs";
import { OAuth2Client } from "google-auth-library";
import { IntegrationSource, KeyStage, Role, Subject } from "@prisma/client";
import { Pool } from "pg";
import { prisma } from "../lib/prisma.js";
import { env } from "../lib/env.js";

type GoogleIdentity = {
  sub: string;
  email: string;
  emailVerified: boolean;
  issuer: string;
  name: string | null;
  pictureUrl: string | null;
};

type NewtonCentreStudent = {
  id: string;
  firstName: string;
  lastName: string;
  yearGroup: string | null;
  workspaceEmail: string | null;
  googleSub: string | null;
  parentEmail: string | null;
};

const googleClient = new OAuth2Client();
let newtonCentrePool: Pool | null = null;

function googleClientIds() {
  return env.GOOGLE_OIDC_CLIENT_IDS.split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function newtonCentreDb() {
  if (!env.NEWTONCENTRE_COURSE_DATABASE_URL) return null;
  if (!newtonCentrePool) {
    newtonCentrePool = new Pool({
      connectionString: env.NEWTONCENTRE_COURSE_DATABASE_URL,
      max: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 2_500,
    });
  }
  return newtonCentrePool;
}

function schoolYearFromNewtonCentre(value: string | null) {
  const text = String(value ?? "").trim().toLowerCase();
  if (!text) return null;
  if (text.includes("reception")) return 0;
  const match = text.match(/\b(\d{1,2})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) && year >= 0 && year <= 13 ? year : null;
}

function keyStageFromSchoolYear(schoolYear: number | null): KeyStage | null {
  if (schoolYear == null) return null;
  if (schoolYear <= 2) return KeyStage.KS1;
  if (schoolYear <= 6) return KeyStage.KS2;
  if (schoolYear <= 9) return KeyStage.KS3;
  return KeyStage.KS4;
}

function makePassword() {
  const chars =
    "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!@#$%^&*";
  let out = "";
  for (let i = 0; i < 18; i += 1) {
    out += chars[Math.floor(Math.random() * chars.length)];
  }
  return out;
}

async function getDefaultOrganisationId() {
  const organisation = await prisma.organisation.findFirst({
    where: { isActive: true },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });
  if (!organisation) throw new Error("No active organisation found.");
  return organisation.id;
}

export async function verifyGoogleIdToken(idToken: string): Promise<GoogleIdentity> {
  const audience = googleClientIds();
  if (!audience.length) {
    throw new Error("Google sign-in is not configured.");
  }

  const ticket = await googleClient.verifyIdToken({ idToken, audience });
  const payload = ticket.getPayload();
  if (!payload?.sub || !payload.email) {
    throw new Error("Google identity payload missing required claims.");
  }

  return {
    sub: payload.sub,
    email: payload.email.toLowerCase(),
    emailVerified: payload.email_verified === true,
    issuer: payload.iss || "https://accounts.google.com",
    name: payload.name || null,
    pictureUrl: payload.picture || null,
  };
}

async function findNewtonCentreStudent(identity: GoogleIdentity) {
  const pool = newtonCentreDb();
  if (!pool) throw new Error("NewtonCentre student database is not configured.");

  const result = await pool.query<NewtonCentreStudent>(
    `
      SELECT
        s.id,
        s."firstName" AS "firstName",
        s."lastName" AS "lastName",
        s."yearGroup" AS "yearGroup",
        s."workspaceEmail" AS "workspaceEmail",
        ga."googleSub" AS "googleSub",
        MIN(p.email) AS "parentEmail"
      FROM "Student" s
      LEFT JOIN "StudentGoogleAccount" ga ON ga."studentId" = s.id
      LEFT JOIN "_ParentStudents" ps ON ps."B" = s.id
      LEFT JOIN "Parent" p ON p.id = ps."A"
      WHERE ga."googleSub" = $1
        OR lower(s."workspaceEmail") = lower($2)
      GROUP BY s.id, ga."googleSub"
      LIMIT 1
    `,
    [identity.sub, identity.email],
  );

  return result.rows[0] ?? null;
}

export async function signInNewtonCentreStudent(idToken: string) {
  const identity = await verifyGoogleIdToken(idToken);
  if (!identity.emailVerified) {
    throw new Error("Google account email is not verified.");
  }

  const remoteStudent = await findNewtonCentreStudent(identity);
  if (!remoteStudent) {
    throw new Error("No NewtonCentre student is linked to this Google account.");
  }

  if (
    remoteStudent.workspaceEmail &&
    remoteStudent.workspaceEmail.toLowerCase() !== identity.email
  ) {
    throw new Error("This Google account does not match the student's workspace account.");
  }

  const organisationId = await getDefaultOrganisationId();
  const schoolYear = schoolYearFromNewtonCentre(remoteStudent.yearGroup);
  const keyStage = keyStageFromSchoolYear(schoolYear);
  const email = (remoteStudent.workspaceEmail || identity.email).toLowerCase();

  const user = await prisma.$transaction(async (tx) => {
    const linked = await tx.studentIntegrationLink.findUnique({
      where: {
        source_externalId: {
          source: IntegrationSource.NEWTONCENTRE,
          externalId: remoteStudent.id,
        },
      },
      select: { student: { select: { userId: true } } },
    });
    if (linked?.student.userId) {
      return tx.user.update({
        where: { id: linked.student.userId },
        data: { email, isActive: true, lastLoginAt: new Date() },
        select: authUserSelect,
      });
    }

    const existingUser = await tx.user.findUnique({
      where: { email },
      select: { id: true, student: { select: { id: true } } },
    });
    if (existingUser?.student) {
      await tx.studentIntegrationLink.upsert({
        where: {
          source_externalId: {
            source: IntegrationSource.NEWTONCENTRE,
            externalId: remoteStudent.id,
          },
        },
        update: { syncedAt: new Date(), parentEmail: remoteStudent.parentEmail },
        create: {
          studentId: existingUser.student.id,
          source: IntegrationSource.NEWTONCENTRE,
          externalId: remoteStudent.id,
          externalType: "STUDENT",
          parentEmail: remoteStudent.parentEmail,
          syncedAt: new Date(),
        },
      });
      return tx.user.update({
        where: { id: existingUser.id },
        data: { isActive: true, lastLoginAt: new Date() },
        select: authUserSelect,
      });
    }

    const matchedStudent = await tx.student.findFirst({
      where: {
        organisationId,
        firstName: { equals: remoteStudent.firstName, mode: "insensitive" },
        lastName: { equals: remoteStudent.lastName, mode: "insensitive" },
        ...(schoolYear == null ? {} : { schoolYear }),
      },
      select: { id: true, userId: true },
    });

    if (matchedStudent) {
      await tx.student.update({
        where: { id: matchedStudent.id },
        data: {
          firstName: remoteStudent.firstName,
          lastName: remoteStudent.lastName,
          schoolYear: schoolYear ?? undefined,
          keyStage: keyStage ?? undefined,
          guardianEmail: remoteStudent.parentEmail,
        },
      });
      await tx.studentIntegrationLink.upsert({
        where: {
          source_externalId: {
            source: IntegrationSource.NEWTONCENTRE,
            externalId: remoteStudent.id,
          },
        },
        update: { syncedAt: new Date(), parentEmail: remoteStudent.parentEmail },
        create: {
          studentId: matchedStudent.id,
          source: IntegrationSource.NEWTONCENTRE,
          externalId: remoteStudent.id,
          externalType: "STUDENT",
          parentEmail: remoteStudent.parentEmail,
          syncedAt: new Date(),
        },
      });
      return tx.user.update({
        where: { id: matchedStudent.userId },
        data: { email, isActive: true, lastLoginAt: new Date() },
        select: authUserSelect,
      });
    }

    const passwordHash = await bcrypt.hash(makePassword(), 10);
    return tx.user.create({
      data: {
        organisationId,
        email,
        passwordHash,
        role: Role.STUDENT,
        isActive: true,
        lastLoginAt: new Date(),
        student: {
          create: {
            organisationId,
            firstName: remoteStudent.firstName,
            lastName: remoteStudent.lastName,
            age: schoolYear == null ? 8 : Math.max(4, schoolYear + 4),
            schoolYear: schoolYear ?? undefined,
            keyStage: keyStage ?? undefined,
            subjects: [Subject.MATHS],
            guardianEmail: remoteStudent.parentEmail,
            integrationLinks: {
              create: {
                source: IntegrationSource.NEWTONCENTRE,
                externalId: remoteStudent.id,
                externalType: "STUDENT",
                parentEmail: remoteStudent.parentEmail,
                syncedAt: new Date(),
              },
            },
          },
        },
      },
      select: authUserSelect,
    });
  });

  return user;
}

const authUserSelect = {
  id: true,
  email: true,
  role: true,
  isActive: true,
  student: {
    select: {
      id: true,
      firstName: true,
      lastName: true,
      age: true,
      schoolYear: true,
      keyStage: true,
      subjects: true,
      guardianEmail: true,
    },
  },
} as const;
