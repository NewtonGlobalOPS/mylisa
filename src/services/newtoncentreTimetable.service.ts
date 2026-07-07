import { IntegrationSource } from "@prisma/client";
import { Pool } from "pg";
import { prisma } from "../lib/prisma.js";

type RemoteTimetableRow = {
  slotId: string;
  dayOfWeek: number;
  dayLabel: string;
  startTime: string;
  endTime: string;
  title: string;
  subject: string;
  keyStage: string | null;
  ageRange: string | null;
  slotType: string;
  room: string | null;
  capacity: number | null;
  tutorId: string | null;
  tutorName: string | null;
  assignmentId: string | null;
  assignmentSource: string | null;
  remoteStudentId: string | null;
  firstName: string | null;
  lastName: string | null;
  dob: Date | null;
  yearGroup: string | null;
  workspaceEmail: string | null;
  signupApplicationId: string | null;
  parentEmails: string[] | null;
};

type RemoteStudentForMatch = {
  remoteStudentId: string;
  firstName: string;
  lastName: string;
  dob: Date | null;
  yearGroup: string | null;
  workspaceEmail: string | null;
  signupApplicationId: string | null;
  parentEmails: string[];
};

type TimetableGroupWithMappedStudents = {
  id: string;
  dayOfWeek: number;
  dayLabel: string;
  startTime: string;
  endTime: string;
  title: string;
  subject: string;
  keyStage: string | null;
  ageRange: string | null;
  slotType: string;
  room: string | null;
  capacity: number | null;
  tutor: { id: string; name: string } | null;
  students: Array<RemoteStudentForMatch & {
    assignmentId: string;
    assignmentSource: string;
    displayName: string;
    mylisaStudentId: string | null;
  }>;
};

type RemoteApiTimetableResponse = {
  source: string;
  groups: Array<{
    id: string;
    dayOfWeek: number;
    dayLabel: string;
    startTime: string;
    endTime: string;
    title: string;
    subject: string;
    keyStage: string | null;
    ageRange: string | null;
    slotType: string;
    room: string | null;
    capacity: number | null;
    tutor: { id: string; name: string } | null;
    students: Array<{
      assignmentId: string;
      assignmentSource: string;
      remoteStudentId: string;
      firstName: string;
      lastName: string;
      dob: string | null;
      yearGroup: string | null;
      workspaceEmail: string | null;
      signupApplicationId: string | null;
      parentEmails: string[];
    }>;
  }>;
};

let timetablePool: Pool | null = null;
let lastTimetableApiResult: {
  source: "REMOTE_API" | "REMOTE_API_CACHE";
  groups: Awaited<ReturnType<typeof addMylisaLinks>>;
} | null = null;

function getNewtonCentreTimetableApiConfig() {
  const url = String(process.env.NEWTONCENTRE_TIMETABLE_API_URL ?? "").trim();
  const token = String(process.env.NEWTONCENTRE_TIMETABLE_API_TOKEN ?? "").trim();
  return url && token ? { url, token } : null;
}

function getNewtonCentreTimetableDatabaseUrl(): string {
  return String(process.env.NEWTONCENTRE_TIMETABLE_DATABASE_URL ?? "").trim();
}

function getTimetablePool(): Pool | null {
  const connectionString = getNewtonCentreTimetableDatabaseUrl();
  if (!connectionString) return null;

  if (!timetablePool) {
    const usesSsl = connectionString.includes("sslmode=");
    timetablePool = new Pool({
      connectionString,
      ...(usesSsl ? { ssl: { rejectUnauthorized: false } } : {}),
      max: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 2_500,
    });
  }

  return timetablePool;
}

function normalizeText(value?: string | null) {
  return String(value ?? "").trim().toLowerCase();
}

function schoolYearFromText(value?: string | null) {
  const raw = normalizeText(value);
  if (!raw) return null;
  if (raw.includes("reception")) return 0;
  const match = raw.match(/\b(\d{1,2})\b/);
  if (!match) return null;
  const year = Number(match[1]);
  return Number.isFinite(year) && year >= 0 && year <= 13 ? year : null;
}

function displayName(student: { firstName?: string | null; lastName?: string | null }) {
  return [student.firstName, student.lastName].map((value) => value?.trim()).filter(Boolean).join(" ");
}

function parseRemoteDate(value: string | Date | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

async function findMylisaStudent(remoteStudent: RemoteStudentForMatch) {
  const directLink = await prisma.studentIntegrationLink.findFirst({
    where: {
      source: IntegrationSource.NEWTONCENTRE,
      externalId: {
        in: [
          remoteStudent.remoteStudentId,
          remoteStudent.signupApplicationId,
        ].filter(Boolean) as string[],
      },
    },
    select: { studentId: true },
  });

  if (directLink) return directLink.studentId;

  const parentEmails = remoteStudent.parentEmails.map(normalizeText).filter(Boolean);
  if (!parentEmails.length && !remoteStudent.workspaceEmail) return null;

  const remoteYear = schoolYearFromText(remoteStudent.yearGroup);
  const remoteFirst = normalizeText(remoteStudent.firstName);
  const remoteLast = normalizeText(remoteStudent.lastName);

  const candidates = await prisma.student.findMany({
    where: {
      OR: [
        { guardianEmail: { in: parentEmails, mode: "insensitive" } },
        ...(remoteStudent.workspaceEmail
          ? [{ user: { email: { equals: remoteStudent.workspaceEmail, mode: "insensitive" as const } } }]
          : []),
      ],
    },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      schoolYear: true,
      dateOfBirth: true,
    },
  });

  const exact = candidates.find((candidate) => {
    const firstMatches = normalizeText(candidate.firstName) === remoteFirst;
    const lastMatches = normalizeText(candidate.lastName) === remoteLast;
    const yearMatches = remoteYear == null || candidate.schoolYear == null || candidate.schoolYear === remoteYear;
    const dobMatches =
      !remoteStudent.dob ||
      !candidate.dateOfBirth ||
      candidate.dateOfBirth.toISOString().slice(0, 10) === remoteStudent.dob.toISOString().slice(0, 10);
    return firstMatches && lastMatches && yearMatches && dobMatches;
  });

  return exact?.id ?? null;
}

async function addMylisaLinks(groups: TimetableGroupWithMappedStudents[]) {
  for (const group of groups) {
    for (const student of group.students) {
      student.mylisaStudentId = await findMylisaStudent(student);
    }
  }

  return groups.map((group) => ({
    ...group,
    mappedStudentCount: group.students.filter((student) => student.mylisaStudentId).length,
    unmappedStudentCount: group.students.filter((student) => !student.mylisaStudentId).length,
  }));
}

async function loadTimetableGroupsFromApi() {
  const api = getNewtonCentreTimetableApiConfig();
  if (!api) return null;

  const url = new URL(api.url);
  url.searchParams.set("_mylisaRefresh", String(Date.now()));

  const response = await fetch(url, {
    cache: "no-store",
    headers: {
      "x-mylisa-integration-token": api.token,
      "Cache-Control": "no-cache, no-store, must-revalidate",
      Pragma: "no-cache",
    },
    signal: AbortSignal.timeout(5_000),
  });

  if (!response.ok) {
    throw new Error(`Newton Centre timetable API returned ${response.status}`);
  }

  const payload = (await response.json()) as RemoteApiTimetableResponse;
  const groups: TimetableGroupWithMappedStudents[] = payload.groups.map((group) => ({
    ...group,
    students: group.students.map((student) => ({
      ...student,
      dob: parseRemoteDate(student.dob),
      parentEmails: student.parentEmails ?? [],
      displayName: displayName(student) || student.workspaceEmail || student.remoteStudentId,
      mylisaStudentId: null,
    })),
  }));

  const result = {
    source: "REMOTE_API" as const,
    groups: await addMylisaLinks(groups),
  };
  lastTimetableApiResult = result;
  return result;
}

async function loadTimetableGroupsFromDatabase() {
  const pool = getTimetablePool();
  if (!pool) return null;

  const result = await pool.query<RemoteTimetableRow>(`
    SELECT
      slot.id AS "slotId",
      slot."dayOfWeek" AS "dayOfWeek",
      slot."dayLabel" AS "dayLabel",
      slot."startTime" AS "startTime",
      slot."endTime" AS "endTime",
      slot.title,
      slot.subject,
      slot."keyStage" AS "keyStage",
      slot."ageRange" AS "ageRange",
      slot."slotType" AS "slotType",
      slot.room,
      slot.capacity,
      tutor.id AS "tutorId",
      tutor.name AS "tutorName",
      assignment.id AS "assignmentId",
      assignment.source AS "assignmentSource",
      student.id AS "remoteStudentId",
      student."firstName" AS "firstName",
      student."lastName" AS "lastName",
      student.dob,
      student."yearGroup" AS "yearGroup",
      student."workspaceEmail" AS "workspaceEmail",
      student."signupApplicationId" AS "signupApplicationId",
      COALESCE(array_agg(parent.email) FILTER (WHERE parent.email IS NOT NULL), '{}') AS "parentEmails"
    FROM "TimetableSlot" slot
    LEFT JOIN "Tutor" tutor ON tutor.id = slot."tutorId"
    LEFT JOIN "TimetableAssignment" assignment
      ON assignment."slotId" = slot.id
     AND assignment.status = 'ACTIVE'
    LEFT JOIN "Student" student ON student.id = assignment."studentId"
    LEFT JOIN "_ParentStudents" parent_join ON parent_join."B" = student.id
    LEFT JOIN "Parent" parent ON parent.id = parent_join."A"
    WHERE slot.active = true
    GROUP BY slot.id, tutor.id, assignment.id, student.id
    ORDER BY slot."dayOfWeek" ASC, slot."startTime" ASC, slot.title ASC, student."firstName" ASC, student."lastName" ASC
  `);

  const groupsBySlot = new Map<string, TimetableGroupWithMappedStudents>();

  for (const row of result.rows) {
    if (!groupsBySlot.has(row.slotId)) {
      groupsBySlot.set(row.slotId, {
        id: row.slotId,
        dayOfWeek: row.dayOfWeek,
        dayLabel: row.dayLabel,
        startTime: row.startTime,
        endTime: row.endTime,
        title: row.title,
        subject: row.subject,
        keyStage: row.keyStage,
        ageRange: row.ageRange,
        slotType: row.slotType,
        room: row.room,
        capacity: row.capacity,
        tutor: row.tutorId && row.tutorName ? { id: row.tutorId, name: row.tutorName } : null,
        students: [],
      });
    }

    if (row.remoteStudentId && row.assignmentId) {
      const student: RemoteStudentForMatch & {
        assignmentId: string;
        assignmentSource: string;
        displayName: string;
        mylisaStudentId: string | null;
      } = {
        assignmentId: row.assignmentId,
        assignmentSource: row.assignmentSource ?? "UNKNOWN",
        remoteStudentId: row.remoteStudentId,
        firstName: row.firstName ?? "",
        lastName: row.lastName ?? "",
        dob: row.dob,
        yearGroup: row.yearGroup,
        workspaceEmail: row.workspaceEmail,
        signupApplicationId: row.signupApplicationId,
        parentEmails: row.parentEmails ?? [],
        displayName: displayName(row) || row.workspaceEmail || row.remoteStudentId,
        mylisaStudentId: null,
      };
      groupsBySlot.get(row.slotId)!.students.push(student);
    }
  }

  return {
    source: "REMOTE_DB" as const,
    groups: await addMylisaLinks(Array.from(groupsBySlot.values())),
  };
}

export async function listNewtonCentreTimetableGroups() {
  try {
    const apiResult = await loadTimetableGroupsFromApi();
    if (apiResult) return apiResult;
  } catch (error) {
    console.warn(
      "[newtoncentre-timetable] failed to load remote timetable API:",
      error instanceof Error ? error.message : error,
    );
    if (lastTimetableApiResult) {
      return {
        ...lastTimetableApiResult,
        source: "REMOTE_API_CACHE" as const,
      };
    }
  }

  try {
    const databaseResult = await loadTimetableGroupsFromDatabase();
    if (databaseResult) return databaseResult;
  } catch (error) {
    console.warn(
      "[newtoncentre-timetable] failed to load remote timetable database:",
      error instanceof Error ? error.message : error,
    );
  }

  return {
    source: getNewtonCentreTimetableApiConfig() || getNewtonCentreTimetableDatabaseUrl()
      ? "UNAVAILABLE" as const
      : "UNCONFIGURED" as const,
    groups: [],
  };
}
