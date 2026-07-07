import "dotenv/config";
import { createWriteStream, mkdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";

type BulkLesson = {
  lessonSlug?: string;
  lessonTitle?: string;
  unitSlug?: string;
  unitTitle?: string;
  subjectSlug?: string;
  keyStageSlug?: string;
  keyStageTitle?: string;
  lessonKeywords?: unknown[];
  keyLearningPoints?: unknown[];
  misconceptionsAndCommonMistakes?: unknown[];
  teacherTips?: unknown[];
  downloadsavailable?: boolean;
  downloadsAvailable?: boolean;
  transcript_sentences?: string | null;
  transcript_vtt?: string | null;
};

type BulkUnit = {
  unitSlug?: string;
  unitTitle?: string;
  keyStageSlug?: string;
  year?: number | string;
  threads?: unknown[];
  priorKnowledgeRequirements?: unknown[];
  nationalCurriculumContent?: unknown[];
  unitLessons?: unknown[];
};

type BulkPayload = {
  sequenceSlug: string;
  subjectTitle: string;
  sequence: BulkUnit[];
  lessons: BulkLesson[];
};

const BULK_SUBJECTS = ["maths-primary", "maths-secondary"];

function requiredEnv(name: string) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env ${name}`);
  return value;
}

function bulkOrigin() {
  return (process.env.OAK_BASE_URL ?? "https://open-api.thenational.academy/api/v0")
    .replace(/\/+$/, "")
    .replace(/\/api\/v0$/, "");
}

async function downloadBulkZip(subject: string, dir: string) {
  const zipPath = path.join(dir, `${subject}.zip`);
  const response = await fetch(`${bulkOrigin()}/api/bulk`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("OAK_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ subjects: [subject] }),
  });
  if (!response.ok || !response.body) {
    throw new Error(`Bulk download failed for ${subject}: ${response.status} ${response.statusText}`);
  }

  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(zipPath);
    response.body!.pipeTo(
      new WritableStream({
        write(chunk) {
          stream.write(Buffer.from(chunk));
        },
        close() {
          stream.end(resolve);
        },
        abort(error) {
          stream.destroy(error);
          reject(error);
        },
      }),
    ).catch(reject);
  });

  return zipPath;
}

function readBulkJson(zipPath: string, subject: string): BulkPayload {
  const json = execFileSync("unzip", ["-p", zipPath, `${subject}.json`], {
    maxBuffer: 200 * 1024 * 1024,
  }).toString("utf8");
  return JSON.parse(json) as BulkPayload;
}

function csvValue(value: unknown) {
  const text = String(value ?? "");
  return /[",\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

function countBy<T extends string | number | symbol>(
  items: Array<Record<string, unknown>>,
  key: string,
) {
  const out: Record<string, number> = {};
  for (const item of items) {
    const value = String(item[key] ?? "unknown");
    out[value] = (out[value] ?? 0) + 1;
  }
  return out as Record<T, number>;
}

function summarise(payload: BulkPayload) {
  const unitNc = payload.sequence.reduce(
    (sum, unit) => sum + (Array.isArray(unit.nationalCurriculumContent) ? unit.nationalCurriculumContent.length : 0),
    0,
  );
  const unitPrior = payload.sequence.reduce(
    (sum, unit) => sum + (Array.isArray(unit.priorKnowledgeRequirements) ? unit.priorKnowledgeRequirements.length : 0),
    0,
  );
  const unitLessons = payload.sequence.reduce(
    (sum, unit) => sum + (Array.isArray(unit.unitLessons) ? unit.unitLessons.length : 0),
    0,
  );
  const lessonKeywords = payload.lessons.reduce(
    (sum, lesson) => sum + (Array.isArray(lesson.lessonKeywords) ? lesson.lessonKeywords.length : 0),
    0,
  );
  const keyLearningPoints = payload.lessons.reduce(
    (sum, lesson) => sum + (Array.isArray(lesson.keyLearningPoints) ? lesson.keyLearningPoints.length : 0),
    0,
  );
  const misconceptions = payload.lessons.reduce(
    (sum, lesson) =>
      sum +
      (Array.isArray(lesson.misconceptionsAndCommonMistakes)
        ? lesson.misconceptionsAndCommonMistakes.length
        : 0),
    0,
  );
  const teacherTips = payload.lessons.reduce(
    (sum, lesson) => sum + (Array.isArray(lesson.teacherTips) ? lesson.teacherTips.length : 0),
    0,
  );
  const transcriptLessons = payload.lessons.filter((lesson) =>
    String(lesson.transcript_sentences ?? "").trim(),
  ).length;
  const vttLessons = payload.lessons.filter((lesson) =>
    String(lesson.transcript_vtt ?? "").trim(),
  ).length;
  const downloadableLessons = payload.lessons.filter(
    (lesson) => lesson.downloadsavailable === true || lesson.downloadsAvailable === true,
  ).length;

  return {
    sequenceSlug: payload.sequenceSlug,
    subjectTitle: payload.subjectTitle,
    units: payload.sequence.length,
    unitLessons,
    lessons: payload.lessons.length,
    keyStages: JSON.stringify(countBy(payload.lessons as Array<Record<string, unknown>>, "keyStageSlug")),
    nationalCurriculumStatements: unitNc,
    priorKnowledgeRequirements: unitPrior,
    lessonKeywords,
    keyLearningPoints,
    misconceptions,
    teacherTips,
    transcriptLessons,
    vttLessons,
    downloadableLessons,
  };
}

async function main() {
  const outDir = path.resolve("reports");
  mkdirSync(outDir, { recursive: true });
  const tempDir = path.join(tmpdir(), `oak-maths-bulk-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });

  const summaries: ReturnType<typeof summarise>[] = [];
  const lessonRows: Array<Record<string, unknown>> = [];

  try {
    for (const subject of BULK_SUBJECTS) {
      console.log(`[oak-bulk-audit] downloading ${subject}`);
      const zipPath = await downloadBulkZip(subject, tempDir);
      const payload = readBulkJson(zipPath, subject);
      summaries.push(summarise(payload));

      for (const lesson of payload.lessons) {
        lessonRows.push({
          sequenceSlug: payload.sequenceSlug,
          keyStageSlug: lesson.keyStageSlug ?? "",
          unitSlug: lesson.unitSlug ?? "",
          unitTitle: lesson.unitTitle ?? "",
          lessonSlug: lesson.lessonSlug ?? "",
          lessonTitle: lesson.lessonTitle ?? "",
          keywords: Array.isArray(lesson.lessonKeywords) ? lesson.lessonKeywords.length : 0,
          keyLearningPoints: Array.isArray(lesson.keyLearningPoints) ? lesson.keyLearningPoints.length : 0,
          misconceptions: Array.isArray(lesson.misconceptionsAndCommonMistakes)
            ? lesson.misconceptionsAndCommonMistakes.length
            : 0,
          teacherTips: Array.isArray(lesson.teacherTips) ? lesson.teacherTips.length : 0,
          hasTranscript: Boolean(String(lesson.transcript_sentences ?? "").trim()),
          hasVtt: Boolean(String(lesson.transcript_vtt ?? "").trim()),
          downloadsAvailable: lesson.downloadsavailable === true || lesson.downloadsAvailable === true,
        });
      }
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  const summaryPath = path.join(outDir, "oak_maths_bulk_summary.csv");
  const summaryHeaders = Object.keys(summaries[0] ?? {});
  const summaryCsv = [
    summaryHeaders.join(","),
    ...summaries.map((row) => summaryHeaders.map((key) => csvValue((row as any)[key])).join(",")),
  ].join("\n");

  const lessonPath = path.join(outDir, "oak_maths_bulk_lessons.csv");
  const lessonHeaders = Object.keys(lessonRows[0] ?? {});
  const lessonCsv = [
    lessonHeaders.join(","),
    ...lessonRows.map((row) => lessonHeaders.map((key) => csvValue(row[key])).join(",")),
  ].join("\n");

  await import("node:fs/promises").then((fs) =>
    Promise.all([
      fs.writeFile(summaryPath, summaryCsv + "\n"),
      fs.writeFile(lessonPath, lessonCsv + "\n"),
    ]),
  );

  console.log(`[oak-bulk-audit] wrote ${summaryPath}`);
  console.log(`[oak-bulk-audit] wrote ${lessonPath}`);
  console.log(JSON.stringify(summaries, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
