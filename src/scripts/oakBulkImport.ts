import "dotenv/config";
import crypto from "node:crypto";
import { createWriteStream, mkdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFileSync } from "node:child_process";
import type { ChunkType, DifficultyBand, KeyStage, Subject } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { ensureOakSource } from "../services/oakSync.service.js";

type BulkLesson = {
  lessonTitle?: string;
  lessonSlug?: string;
  oakUrl?: string;
  canonicalUrl?: string;
  unitSlug?: string;
  unitTitle?: string;
  subjectSlug?: string;
  subjectTitle?: string;
  keyStageSlug?: string;
  keyStageTitle?: string;
  lessonKeywords?: Array<{ keyword?: string; description?: string }>;
  keyLearningPoints?: Array<{ keyLearningPoint?: string }>;
  misconceptionsAndCommonMistakes?: Array<{
    misconception?: string;
    response?: string;
    teacherResponse?: string;
  }>;
  pupilLessonOutcome?: string;
  teacherTips?: Array<{ teacherTip?: string; body?: string; content?: string }>;
  contentGuidance?: string | null;
  downloadsavailable?: boolean;
  downloadsAvailable?: boolean;
  transcript_sentences?: string | null;
  transcript_vtt?: string | null;
};

type BulkUnit = {
  unitSlug?: string;
  unitTitle?: string;
  canonicalUrl?: string;
  threads?: Array<{ threadTitle?: string; threadSlug?: string }>;
  priorKnowledgeRequirements?: string[];
  nationalCurriculumContent?: string[];
  description?: string;
  year?: number | string;
  keyStageSlug?: string;
  subjectSlug?: string;
  whyThisWhyNow?: string;
  unitLessons?: Array<{ lessonSlug?: string; lessonTitle?: string; state?: string }>;
};

type BulkPayload = {
  sequenceSlug: string;
  subjectTitle: string;
  sequence: BulkUnit[];
  lessons: BulkLesson[];
};

type ObjectiveRef = {
  id: string;
  code: string;
  strandId: string | null;
  strand: string;
  title: string;
  statement: string;
};

const DEFAULT_SUBJECTS = ["maths"];
const PHASES = ["primary", "secondary"];
const TRANSCRIPT_CHUNK_CHARS = Number(
  process.env.OAK_BULK_TRANSCRIPT_CHUNK_CHARS ?? "1600",
);
const TRANSCRIPT_MAX_CHUNKS = Number(
  process.env.OAK_BULK_TRANSCRIPT_MAX_CHUNKS ?? "20",
);

function readSubjectArgs() {
  const arg = process.argv.find((value) => value.startsWith("--subjects="));
  const raw = arg
    ? arg
        .slice("--subjects=".length)
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean)
    : DEFAULT_SUBJECTS;
  return Array.from(new Set(raw.map((value) => value.toLowerCase())));
}

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

function sha1(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function objectiveCode(
  subjectSlug: string,
  keyStageSlug: string,
  unitSlug: string,
  statement: string,
) {
  return `oak:${subjectSlug}:${keyStageSlug}:${unitSlug}:${sha1(statement)}`;
}

function chunkId(lessonIdentity: string, type: ChunkType, suffix?: string) {
  const base = `${lessonIdentity}:${type}${suffix ? `:${suffix}` : ""}`;
  return `oak_chunk_${sha1(base)}`;
}

function bulkLessonIdentity(
  sequenceSlug: string,
  lesson: BulkLesson,
  lessonIndex: number,
) {
  return [
    sequenceSlug,
    String(lessonIndex).padStart(5, "0"),
    lesson.unitSlug ?? "unit-unknown",
    lesson.lessonSlug ?? "lesson-unknown",
  ].join(":");
}

function mapOakKsToEnumKeyStage(oakKs: string | undefined): KeyStage {
  const ks = String(oakKs ?? "").toLowerCase();
  if (ks === "ks1") return "KS1";
  if (ks === "ks2") return "KS2";
  if (ks === "ks3") return "KS3";
  if (ks === "ks4") return "KS4";
  return "KS2";
}

function mapOakSubjectToEnum(subjectSlug: string | undefined): Subject {
  const slug = String(subjectSlug ?? "").toLowerCase();
  if (slug === "maths" || slug === "math" || slug.includes("maths")) return "MATHS";
  if (
    slug === "science" ||
    slug === "biology" ||
    slug === "chemistry" ||
    slug === "physics" ||
    slug.includes("science")
  ) {
    return "SCIENCE";
  }
  if (slug === "computing" || slug.includes("computing")) return "COMPUTING";
  if (slug === "english" || slug.includes("english")) return "ENGLISH";
  return "MATHS";
}

function safeYearGroup(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const parsed = Number(String(value ?? "").replace(/[^0-9]/g, ""));
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

function tokens(value: string) {
  const stop = new Set([
    "and",
    "the",
    "with",
    "from",
    "that",
    "this",
    "into",
    "using",
    "where",
    "which",
    "will",
  ]);
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 4 && !stop.has(token)),
  );
}

function chooseObjective(objectives: ObjectiveRef[], lesson: BulkLesson) {
  if (objectives.length <= 1) return objectives[0] ?? null;
  const lessonText = [
    lesson.lessonTitle,
    lesson.pupilLessonOutcome,
    ...(lesson.lessonKeywords ?? []).flatMap((keyword) => [
      keyword.keyword,
      keyword.description,
    ]),
    ...(lesson.keyLearningPoints ?? []).map((point) => point.keyLearningPoint),
    lesson.transcript_sentences?.slice(0, 4000),
  ]
    .filter(Boolean)
    .join("\n");
  const lessonTokens = tokens(lessonText);

  let best: { objective: ObjectiveRef; score: number } | null = null;
  for (const objective of objectives) {
    let score = 0;
    for (const token of tokens(`${objective.title}\n${objective.statement}`)) {
      if (lessonTokens.has(token)) score += 1;
    }
    if (!best || score > best.score) best = { objective, score };
  }
  return best?.objective ?? objectives[0] ?? null;
}

function compactLessonSummary(lesson: BulkLesson) {
  const lines: string[] = [];
  lines.push(`Lesson: ${lesson.lessonTitle ?? lesson.lessonSlug ?? "Oak lesson"}`);
  lines.push(`Unit: ${lesson.unitTitle ?? lesson.unitSlug ?? "Oak unit"}`);
  if (lesson.pupilLessonOutcome) lines.push(`Outcome: ${lesson.pupilLessonOutcome}`);

  if (lesson.lessonKeywords?.length) {
    lines.push("Keywords:");
    for (const keyword of lesson.lessonKeywords) {
      const key = String(keyword.keyword ?? "").trim();
      const description = String(keyword.description ?? "").trim();
      if (key) lines.push(`- ${key}${description ? `: ${description}` : ""}`);
    }
  }

  if (lesson.keyLearningPoints?.length) {
    lines.push("Key learning points:");
    for (const point of lesson.keyLearningPoints) {
      const text = String(point.keyLearningPoint ?? "").trim();
      if (text) lines.push(`- ${text}`);
    }
  }

  return lines.join("\n");
}

function compactMisconceptions(lesson: BulkLesson) {
  return (lesson.misconceptionsAndCommonMistakes ?? [])
    .map((item) =>
      [
        String(item.misconception ?? "").trim(),
        String(item.response ?? item.teacherResponse ?? "").trim(),
      ]
        .filter(Boolean)
        .join(" - "),
    )
    .filter(Boolean)
    .join("\n");
}

function compactTeacherTips(lesson: BulkLesson) {
  return (lesson.teacherTips ?? [])
    .map((item) =>
      String(item.teacherTip ?? item.body ?? item.content ?? "").trim(),
    )
    .filter(Boolean)
    .join("\n");
}

function compactDownloadAvailability(lesson: BulkLesson) {
  const lines: string[] = [];
  lines.push(`Oak downloadable resources are available for ${lesson.lessonTitle ?? lesson.lessonSlug}.`);
  lines.push(`Lesson slug: ${lesson.lessonSlug}`);
  lines.push("Use the lesson assets endpoint for current worksheet, quiz, slide deck, video, and attribution URLs.");
  return lines.join("\n");
}

function splitTranscript(text: string, maxLen: number, maxChunks: number) {
  const clean = String(text ?? "").replace(/\r\n/g, "\n").trim();
  if (!clean) return [];
  const paras = clean
    .split(/\n{2,}/)
    .map((part) => part.trim())
    .filter(Boolean);
  const out: string[] = [];
  let buffer = "";

  const flush = () => {
    if (buffer.trim()) out.push(buffer.trim());
    buffer = "";
  };

  for (const para of paras) {
    if (out.length >= maxChunks) break;
    const candidate = buffer ? `${buffer}\n\n${para}` : para;
    if (candidate.length <= maxLen) {
      buffer = candidate;
      continue;
    }
    flush();
    if (para.length <= maxLen) {
      buffer = para;
      continue;
    }
    for (let index = 0; index < para.length && out.length < maxChunks; index += maxLen) {
      out.push(para.slice(index, index + maxLen).trim());
    }
  }

  if (out.length < maxChunks) flush();
  return out.slice(0, maxChunks);
}

async function downloadBulkZip(subjectPhase: string, dir: string) {
  const zipPath = path.join(dir, `${subjectPhase}.zip`);
  const response = await fetch(`${bulkOrigin()}/api/bulk`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${requiredEnv("OAK_API_KEY")}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ subjects: [subjectPhase] }),
  });
  if (!response.ok || !response.body) {
    throw new Error(
      `Oak bulk download failed for ${subjectPhase}: ${response.status} ${response.statusText}`,
    );
  }

  await new Promise<void>((resolve, reject) => {
    const stream = createWriteStream(zipPath);
    response
      .body!.pipeTo(
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
      )
      .catch(reject);
  });

  return zipPath;
}

function readBulkJson(zipPath: string, subjectPhase: string): BulkPayload {
  const json = execFileSync("unzip", ["-p", zipPath, `${subjectPhase}.json`], {
    maxBuffer: 250 * 1024 * 1024,
  }).toString("utf8");
  return JSON.parse(json) as BulkPayload;
}

async function upsertChunk(input: {
  organisationId: string;
  sourceId: string;
  sequenceSlug: string;
  subjectSlug: string;
  lessonIndex: number;
  lesson: BulkLesson;
  unit: BulkUnit | undefined;
  objective: ObjectiveRef | null;
  type: ChunkType;
  difficulty: DifficultyBand;
  content: string;
  tags: string[];
  citations: string[];
  suffix: string;
}) {
  if (!input.lesson.lessonSlug || !input.content.trim()) return false;
  const subject = mapOakSubjectToEnum(
    input.lesson.subjectSlug ?? input.unit?.subjectSlug ?? input.subjectSlug,
  );
  const keyStage = mapOakKsToEnumKeyStage(input.lesson.keyStageSlug ?? input.unit?.keyStageSlug);
  const id = chunkId(
    bulkLessonIdentity(input.sequenceSlug, input.lesson, input.lessonIndex),
    input.type,
    input.suffix,
  );
  const contentSha256 = sha256(
    JSON.stringify({
      organisationId: input.organisationId,
      sourceId: input.sourceId,
      sequenceSlug: input.sequenceSlug,
      lessonIndex: input.lessonIndex,
      unitSlug: input.lesson.unitSlug ?? input.unit?.unitSlug ?? null,
      lessonSlug: input.lesson.lessonSlug,
      type: input.type,
      idSuffix: input.suffix,
      content: input.content,
    }),
  );

  await prisma.contentChunk.upsert({
    where: { id },
    update: {
      organisationId: input.organisationId,
      sourceId: input.sourceId,
      objectiveId: input.objective?.id ?? null,
      subject,
      keyStage,
      yearGroup: safeYearGroup(input.unit?.year),
      strand: input.objective?.strand ?? input.lesson.unitTitle ?? input.unit?.unitTitle ?? null,
      strandId: input.objective?.strandId ?? null,
      type: input.type,
      difficulty: input.difficulty,
      content: input.content,
      contentSha256,
      citations: input.citations,
      tags: input.tags,
      isActive: true,
    },
    create: {
      id,
      organisationId: input.organisationId,
      sourceId: input.sourceId,
      objectiveId: input.objective?.id ?? null,
      subject,
      keyStage,
      yearGroup: safeYearGroup(input.unit?.year),
      strand: input.objective?.strand ?? input.lesson.unitTitle ?? input.unit?.unitTitle ?? null,
      strandId: input.objective?.strandId ?? null,
      type: input.type,
      difficulty: input.difficulty,
      content: input.content,
      contentSha256,
      citations: input.citations,
      tags: input.tags,
      isActive: true,
    },
  });

  return true;
}

async function importPayload(payload: BulkPayload, source: Awaited<ReturnType<typeof ensureOakSource>>) {
  const stats = {
    sequenceSlug: payload.sequenceSlug,
    units: 0,
    lessons: 0,
    objectives: 0,
    chunks: 0,
    transcriptChunks: 0,
    skippedLessonsNoSlug: 0,
  };
  const unitsBySlug = new Map(
    payload.sequence
      .filter((unit) => unit.unitSlug)
      .map((unit) => [unit.unitSlug!, unit]),
  );
  const objectivesByUnit = new Map<string, ObjectiveRef[]>();
  const payloadSubjectSlug = payload.sequenceSlug.replace(/-(primary|secondary)$/, "");

  for (const unit of payload.sequence) {
    if (!unit.unitSlug) continue;
    stats.units++;
    const subjectSlug = unit.subjectSlug ?? payloadSubjectSlug;
    const keyStageSlug = unit.keyStageSlug ?? "";
    const subject = mapOakSubjectToEnum(subjectSlug);
    const keyStage = mapOakKsToEnumKeyStage(keyStageSlug);
    const strand = unit.unitTitle ?? "Oak Unit";
    const unitObjectives: ObjectiveRef[] = [];

    for (const statement of unit.nationalCurriculumContent ?? []) {
      const cleanStatement = String(statement ?? "").trim();
      if (!cleanStatement) continue;
      const code = objectiveCode(subjectSlug, keyStageSlug, unit.unitSlug, cleanStatement);
      const objective = await prisma.curriculumObjective.upsert({
        where: {
          organisationId_code: {
            organisationId: source.organisationId,
            code,
          },
        },
        update: {
          subject,
          keyStage,
          yearGroup: safeYearGroup(unit.year),
          strand,
          title: cleanStatement.slice(0, 160),
          statement: cleanStatement,
          statutory: true,
          keywords: ["oak", subjectSlug, keyStageSlug].filter(Boolean),
          sourceId: source.id,
          isActive: true,
        },
        create: {
          organisationId: source.organisationId,
          code,
          subject,
          keyStage,
          yearGroup: safeYearGroup(unit.year),
          strand,
          title: cleanStatement.slice(0, 160),
          statement: cleanStatement,
          statutory: true,
          keywords: ["oak", subjectSlug, keyStageSlug].filter(Boolean),
          sourceId: source.id,
          isActive: true,
        },
      });
      unitObjectives.push({
        id: objective.id,
        code: objective.code,
        strandId: objective.strandId,
        strand: objective.strand,
        title: objective.title,
        statement: objective.statement,
      });
      stats.objectives++;
    }

    objectivesByUnit.set(unit.unitSlug, unitObjectives);
  }

  for (const [lessonIndex, lesson] of payload.lessons.entries()) {
    if (!lesson.lessonSlug) {
      stats.skippedLessonsNoSlug++;
      continue;
    }
    stats.lessons++;
    const unit = lesson.unitSlug ? unitsBySlug.get(lesson.unitSlug) : undefined;
    const objective = chooseObjective(
      lesson.unitSlug ? objectivesByUnit.get(lesson.unitSlug) ?? [] : [],
      lesson,
    );
    const baseTags = [
      "oak",
      "bulk",
      "lesson",
      String(lesson.subjectSlug ?? unit?.subjectSlug ?? ""),
      String(lesson.keyStageSlug ?? unit?.keyStageSlug ?? ""),
    ].filter(Boolean);
    const citations = [
      lesson.canonicalUrl,
      lesson.oakUrl,
      lesson.lessonSlug ? `/lessons/${lesson.lessonSlug}` : null,
    ]
      .map((value) => String(value ?? "").trim())
      .filter(Boolean);

    if (
      await upsertChunk({
        organisationId: source.organisationId,
        sourceId: source.id,
        sequenceSlug: payload.sequenceSlug,
        subjectSlug: payloadSubjectSlug,
        lessonIndex,
        lesson,
        unit,
        objective,
        type: "EXPLANATION",
        difficulty: "MEDIUM",
        content: compactLessonSummary(lesson),
        tags: [...baseTags, "summary"],
        citations,
        suffix: "summary",
      })
    ) {
      stats.chunks++;
    }

    const misconceptions = compactMisconceptions(lesson);
    if (
      misconceptions &&
      (await upsertChunk({
        organisationId: source.organisationId,
        sourceId: source.id,
        sequenceSlug: payload.sequenceSlug,
        subjectSlug: payloadSubjectSlug,
        lessonIndex,
        lesson,
        unit,
        objective,
        type: "MISCONCEPTION",
        difficulty: "MEDIUM",
        content: misconceptions,
        tags: [...baseTags, "misconceptions"],
        citations,
        suffix: "misconceptions",
      }))
    ) {
      stats.chunks++;
    }

    const teacherTips = compactTeacherTips(lesson);
    if (
      teacherTips &&
      (await upsertChunk({
        organisationId: source.organisationId,
        sourceId: source.id,
        sequenceSlug: payload.sequenceSlug,
        subjectSlug: payloadSubjectSlug,
        lessonIndex,
        lesson,
        unit,
        objective,
        type: "EXPLANATION",
        difficulty: "MEDIUM",
        content: teacherTips,
        tags: [...baseTags, "teacher-tips"],
        citations,
        suffix: "teacher-tips",
      }))
    ) {
      stats.chunks++;
    }

    if (lesson.downloadsavailable === true || lesson.downloadsAvailable === true) {
      if (
        await upsertChunk({
          organisationId: source.organisationId,
          sourceId: source.id,
          sequenceSlug: payload.sequenceSlug,
          subjectSlug: payloadSubjectSlug,
          lessonIndex,
          lesson,
          unit,
          objective,
          type: "EXPLANATION",
          difficulty: "MEDIUM",
          content: compactDownloadAvailability(lesson),
          tags: [...baseTags, "assets", "downloads", "bulk-assets"],
          citations: [
            ...citations,
            lesson.lessonSlug ? `/lessons/${lesson.lessonSlug}/assets` : "",
          ].filter(Boolean),
          suffix: "bulk-assets",
        })
      ) {
        stats.chunks++;
      }
    }

    for (const [index, part] of splitTranscript(
      lesson.transcript_sentences ?? "",
      TRANSCRIPT_CHUNK_CHARS,
      TRANSCRIPT_MAX_CHUNKS,
    ).entries()) {
      if (
        await upsertChunk({
          organisationId: source.organisationId,
          sourceId: source.id,
          sequenceSlug: payload.sequenceSlug,
          subjectSlug: payloadSubjectSlug,
          lessonIndex,
          lesson,
          unit,
          objective,
          type: "EXPLANATION",
          difficulty: "MEDIUM",
          content: part,
          tags: [...baseTags, "transcript", "chunk"],
          citations,
          suffix: `transcript:${String(index).padStart(2, "0")}`,
        })
      ) {
        stats.chunks++;
        stats.transcriptChunks++;
      }
    }

    if (stats.lessons % 100 === 0) {
      console.log(
        `[oak-bulk-import] ${payload.sequenceSlug} lessons=${stats.lessons}/${payload.lessons.length} chunks=${stats.chunks}`,
      );
    }
  }

  return stats;
}

async function main() {
  const subjectSlugs = readSubjectArgs();
  const subjectPhases = subjectSlugs.flatMap((subject) =>
    PHASES.map((phase) => `${subject}-${phase}`),
  );
  const tempDir = path.join(tmpdir(), `oak-bulk-import-${Date.now()}`);
  mkdirSync(tempDir, { recursive: true });
  const source = await ensureOakSource();
  const allStats = [];

  for (const subjectSlug of subjectSlugs) {
    const subject = mapOakSubjectToEnum(subjectSlug);
    const deactivated = await prisma.contentChunk.updateMany({
      where: {
        sourceId: source.id,
        subject,
        tags: { has: "bulk" },
        isActive: true,
      },
      data: { isActive: false },
    });
    console.log(
      `[oak-bulk-import] deactivated previous active bulk chunks subject=${subject} count=${deactivated.count}`,
    );
  }

  try {
    for (const subjectPhase of subjectPhases) {
      console.log(`[oak-bulk-import] downloading ${subjectPhase}`);
      const zipPath = await downloadBulkZip(subjectPhase, tempDir);
      const payload = readBulkJson(zipPath, subjectPhase);
      allStats.push(await importPayload(payload, source));
    }
  } finally {
    rmSync(tempDir, { recursive: true, force: true });
  }

  console.log("Oak bulk import complete:", JSON.stringify(allStats, null, 2));
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
