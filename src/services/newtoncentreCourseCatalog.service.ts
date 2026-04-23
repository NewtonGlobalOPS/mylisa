import { Subject } from "@prisma/client";
import { Pool } from "pg";

export type PublishedCourseModule = {
  courseSlug: string;
  courseTitle: string;
  courseLevel: string | null;
  versionNumber: number;
  moduleId: string;
  moduleTitle: string;
  moduleDescription: string | null;
  sortOrder: number;
  objectiveCode: string | null;
};

export type PublishedCourseCatalog = {
  course: {
    slug: string;
    title: string;
    level: string | null;
    versionNumber: number;
  } | null;
  modules: PublishedCourseModule[];
  source: "REMOTE_DB" | "UNCONFIGURED" | "UNSUPPORTED";
};

let newtonCentrePool: Pool | null = null;

function getNewtonCentreCourseDatabaseUrl(): string {
  return String(process.env.NEWTONCENTRE_COURSE_DATABASE_URL ?? "").trim();
}

function getNewtonCentrePool(): Pool | null {
  const connectionString = getNewtonCentreCourseDatabaseUrl();
  if (!connectionString) return null;

  if (!newtonCentrePool) {
    newtonCentrePool = new Pool({
      connectionString,
      max: 2,
      idleTimeoutMillis: 5_000,
      connectionTimeoutMillis: 2_500,
    });
  }

  return newtonCentrePool;
}

function keyStageSlugFromSchoolYear(schoolYear: number | null): string | null {
  if (schoolYear == null) return null;
  if (schoolYear <= 2) return "ks1";
  if (schoolYear <= 6) return "ks2";
  if (schoolYear <= 9) return "ks3";
  if (schoolYear <= 11) return "ks4";
  return null;
}

function subjectSlug(subject: Subject): string | null {
  switch (subject) {
    case Subject.MATHS:
      return "maths";
    case Subject.ENGLISH:
      return "english";
    case Subject.SCIENCE:
      return "science";
    case Subject.COMPUTING:
      return "computing";
    default:
      return null;
  }
}

function courseSlugForSubject(subject: Subject, schoolYear: number | null): string | null {
  const keyStageSlug = keyStageSlugFromSchoolYear(schoolYear);
  const subjectName = subjectSlug(subject);

  if (!keyStageSlug || !subjectName) {
    return null;
  }

  return `${keyStageSlug}-${subjectName}`;
}

function extractObjectiveCode(description: string | null): string | null {
  const text = String(description ?? "");
  const match = text.match(/Objective code:\s*([^\s]+)/i);
  return match?.[1]?.trim() ?? null;
}

export async function loadPublishedCourseModules(params: {
  subject: Subject;
  schoolYear: number | null;
}): Promise<PublishedCourseCatalog> {
  const slug = courseSlugForSubject(params.subject, params.schoolYear);
  if (!slug) {
    return {
      course: null,
      modules: [],
      source: "UNSUPPORTED",
    };
  }

  const pool = getNewtonCentrePool();
  if (!pool) {
    return {
      course: null,
      modules: [],
      source: "UNCONFIGURED",
    };
  }

  const result = await pool.query<{
    courseSlug: string;
    courseTitle: string;
    courseLevel: string | null;
    versionNumber: number;
    moduleId: string;
    moduleTitle: string;
    moduleDescription: string | null;
    sortOrder: number;
  }>(
    `
      SELECT
        c.slug AS "courseSlug",
        c.title AS "courseTitle",
        c.level AS "courseLevel",
        cv."versionNumber" AS "versionNumber",
        cm.id AS "moduleId",
        cm.title AS "moduleTitle",
        cm.description AS "moduleDescription",
        cm."sortOrder" AS "sortOrder"
      FROM "Course" c
      JOIN "CourseVersion" cv
        ON cv."courseId" = c.id
      JOIN "CourseModule" cm
        ON cm."courseVersionId" = cv.id
      WHERE c.slug = $1
        AND cv.status = 'PUBLISHED'
      ORDER BY cm."sortOrder" ASC
    `,
    [slug]
  );

  const rows = result.rows.map((row) => ({
    ...row,
    objectiveCode: extractObjectiveCode(row.moduleDescription),
  }));

  return {
    course:
      rows.length > 0
        ? {
            slug: rows[0].courseSlug,
            title: rows[0].courseTitle,
            level: rows[0].courseLevel,
            versionNumber: rows[0].versionNumber,
          }
        : null,
    modules: rows,
    source: "REMOTE_DB",
  };
}
