// src/services/oakSync.service.ts
// BEST FULL DROP-IN Oak sync with:
// - Progress logging + heartbeat (so it never looks hung)
// - Robust handling of Oak payload shape variations
// - Skips 404/NOT_FOUND unit summaries (common in Oak datasets)
// - FIX: Oak unit summaries often expose lessons as `unitLessons` (not `lessons`)
// - FIX: Treats transcript “Lesson is blocked / Transcript not available” (400) as normal/unavailable
// - NEW: Robust curriculum objective extraction across Oak payload shapes (strings OR objects; multiple field names)
// - NEW: Transcript is chunked into multiple ContentChunk rows (RAG-friendly) with deterministic IDs
// - Optional: DB identity logging to confirm which DB is being written to
//
// Run:
//   OAK_SYNC_LOG_EVERY=25 OAK_SYNC_DEBUG=1 npx tsx src/scripts/oakSync.ts
//
// Optional env:
//   OAK_SYNC_LOG_EVERY=10
//   OAK_SYNC_DEBUG=1
//   OAK_SYNC_DB_LOG=1                 (log current_database/current_user at start)
//   OAK_SYNC_DRY_RUN=1                (no writes; still fetches + logs)
//   OAK_SYNC_SKIP_TRANSCRIPT=1        (skip transcript fetches entirely)
//   OAK_SYNC_TRANSCRIPT_CHUNK_CHARS=1600  (chunk size in characters; default 1600)
//   OAK_SYNC_TRANSCRIPT_MAX_CHUNKS=20     (cap chunks per transcript; default 20)

import { prisma } from "../lib/prisma.js";
import { oakGet } from "../lib/oakClient.js";
import type {
  OakSubjectListItem,
  OakUnitSummary,
  OakLessonSummary,
  OakLessonTranscript,
  OakSequenceQuestions,
} from "./oak.types.js";
import crypto from "node:crypto";
import type {
  ChunkType,
  DifficultyBand,
  KeyStage,
  Subject,
} from "@prisma/client";

const LOG_EVERY = Number(process.env.OAK_SYNC_LOG_EVERY ?? "25");
const DEBUG = process.env.OAK_SYNC_DEBUG === "1";
const DB_LOG = process.env.OAK_SYNC_DB_LOG === "1";
const DRY_RUN = process.env.OAK_SYNC_DRY_RUN === "1";
const SKIP_TRANSCRIPT = process.env.OAK_SYNC_SKIP_TRANSCRIPT === "1";
const TRANSCRIPT_CHUNK_CHARS = Number(
  process.env.OAK_SYNC_TRANSCRIPT_CHUNK_CHARS ?? "1600",
);
const TRANSCRIPT_MAX_CHUNKS = Number(
  process.env.OAK_SYNC_TRANSCRIPT_MAX_CHUNKS ?? "20",
);

function now() {
  return Date.now();
}
function ms(n: number) {
  return `${Math.round(n)}ms`;
}
function sha1(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}

function mapOakKsToEnumKeyStage(oakKs: string): KeyStage {
  const ks = (oakKs ?? "").toLowerCase();
  if (ks === "ks1") return "KS1";
  if (ks === "ks2") return "KS2";
  if (ks === "ks3") return "KS3";
  if (ks === "ks4") return "KS4";
  return "KS2";
}

function mapOakSubjectToEnum(subjectSlug: string): Subject {
  const s = (subjectSlug ?? "").toLowerCase();
  if (s === "maths" || s === "math") return "MATHS";
  if (s === "science") return "SCIENCE";
  if (s === "computing") return "COMPUTING";
  return "MATHS";
}

function safeYearGroup(y: unknown): number | null {
  return typeof y === "number" && Number.isFinite(y) ? y : null;
}

function objectiveCode(
  subjectSlug: string,
  keyStageSlug: string,
  unitSlug: string,
  statement: string,
) {
  return `oak:${subjectSlug}:${keyStageSlug}:${unitSlug}:${sha1(statement)}`;
}

// Deterministic chunk id; supports suffix so transcript chunks can be multiple.
function chunkId(lessonSlug: string, type: ChunkType, suffix?: string) {
  const base = `${lessonSlug}:${type}${suffix ? `:${suffix}` : ""}`;
  return `oak_chunk_${sha1(base)}`;
}

/**
 * Oak /sequences/{sequenceSlug}/units response can vary.
 * Normalize into: [{ units: [...] }, ...]
 */
function normalizeUnitsResponse(
  raw: any,
): Array<{ units: any[]; year?: any; title?: any }> {
  if (Array.isArray(raw)) {
    if (raw.length === 0) return [];
    // Shape A: [{year, units:[...]}]
    if (raw.every((x) => x && Array.isArray(x.units))) return raw as any;
    // Shape B: [unit, unit, ...]
    if (
      raw.every(
        (x) => x && typeof x === "object" && ("unitSlug" in x || "slug" in x),
      )
    ) {
      return [{ units: raw as any[] }];
    }
    // Mixed: keep only entries with units
    return raw.filter((x) => x && Array.isArray(x.units));
  }

  // Shape C: { units:[...] }
  if (raw && typeof raw === "object" && Array.isArray(raw.units))
    return [{ units: raw.units as any[] }];

  return [];
}

/**
 * Some sequence unit items might have slug fields named differently.
 * Normalize to {unitSlug, unitTitle} minimal.
 */
function normalizeSequenceUnitItem(u: any): {
  unitSlug: string | null;
  unitTitle: string | null;
} {
  const unitSlug =
    typeof u?.unitSlug === "string"
      ? u.unitSlug
      : typeof u?.slug === "string"
        ? u.slug
        : null;

  const unitTitle =
    typeof u?.unitTitle === "string"
      ? u.unitTitle
      : typeof u?.title === "string"
        ? u.title
        : null;

  return { unitSlug, unitTitle };
}

function compactTextFromLessonSummary(s: OakLessonSummary) {
  const lines: string[] = [];
  lines.push(`Lesson: ${s.lessonTitle}`);
  lines.push(`Unit: ${s.unitTitle}`);

  if (s.lessonKeywords?.length) {
    lines.push("Keywords:");
    for (const k of s.lessonKeywords) {
      const kw = (k.keyword ?? "").trim();
      const d = (k.description ?? "").trim();
      if (kw) lines.push(`- ${kw}${d ? ` — ${d}` : ""}`);
    }
  }

  if (s.teacherTips?.length) {
    lines.push("Teacher tips:");
    for (const t of s.teacherTips) {
      const body = (t.body ?? t.content ?? "").trim();
      if (body) lines.push(`- ${body}`);
    }
  }

  if (s.misconceptions?.length) {
    lines.push("Misconceptions:");
    for (const m of s.misconceptions) {
      const a = (m.misconception ?? "").trim();
      const b = (m.teacherResponse ?? m.pupilLessonOutcome ?? "").trim();
      const joined = [a, b].filter(Boolean).join(" — ");
      if (joined) lines.push(`- ${joined}`);
    }
  }

  return lines.join("\n");
}

function compactTextFromQuiz(q: any) {
  // Store questions only; do not store answers in searchable chunks.
  const lines: string[] = [];
  lines.push(`Quiz for lesson: ${String(q.lessonTitle ?? "").trim()}`);

  for (const sectionName of ["starterQuiz", "exitQuiz"] as const) {
    const arr = Array.isArray(q?.[sectionName]) ? q[sectionName] : [];
    if (!arr.length) continue;
    lines.push(
      sectionName === "starterQuiz"
        ? "Starter quiz questions:"
        : "Exit quiz questions:",
    );
    for (const item of arr) {
      const question = String(item?.question ?? "").trim();
      if (question) lines.push(`Q: ${question}`);
    }
  }
  return lines.join("\n");
}

function isOakNotFound(err: any): boolean {
  const msg = String(err?.message ?? err ?? "");
  return (
    msg.includes("Oak API error 404") ||
    msg.includes('"code":"NOT_FOUND"') ||
    msg.includes("NOT_FOUND") ||
    msg.includes("Unit not found") ||
    msg.includes("Lesson not found")
  );
}

/**
 * Oak transcripts may return 400 BAD_REQUEST with
 * "Transcript not available" and/or "Lesson is blocked".
 * Treat as normal "unavailable", not an error.
 */
function isOakTranscriptUnavailable(err: any): boolean {
  const msg = String(err?.message ?? err ?? "");
  return (
    msg.includes("Transcript not available") ||
    msg.includes("Lesson is blocked") ||
    msg.includes('"code":"BAD_REQUEST"') ||
    msg.includes("Oak API error 400 Bad Request")
  );
}

/**
 * Oak unit summaries often expose lessons as `unitLessons` rather than `lessons`.
 * Normalises multiple known shapes into lesson slugs.
 */
function extractLessonSlugsFromUnitSummary(unitSummary: any): string[] {
  const candidates =
    unitSummary?.unitLessons ??
    unitSummary?.lessons ??
    unitSummary?.unitLessonSummaries ??
    unitSummary?.items ??
    [];

  const arr = Array.isArray(candidates) ? candidates : [];

  return arr
    .filter((l: any) => l && typeof l === "object")
    .filter(
      (l: any) =>
        typeof l.lessonSlug === "string" && l.lessonSlug.trim().length > 0,
    )
    .filter(
      (l: any) => !l.state || String(l.state).toLowerCase() === "published",
    )
    .map((l: any) => String(l.lessonSlug).trim());
}

/**
 * NEW: Robust extraction of curriculum statements from unit summary.
 * Handles strings OR objects and common alternative field names.
 */
function extractNationalCurriculumStatements(unitSummary: any): string[] {
  const raw =
    unitSummary?.nationalCurriculumContent ??
    unitSummary?.nationalCurriculumStatements ??
    unitSummary?.nationalCurriculum ??
    unitSummary?.curriculumContent ??
    unitSummary?.curriculum ??
    [];

  const arr = Array.isArray(raw) ? raw : [];

  const statements = arr
    .map((item: any) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") {
        return (
          item.statement ??
          item.content ??
          item.description ??
          item.text ??
          item.title ??
          ""
        );
      }
      return "";
    })
    .map((s: any) => String(s ?? "").trim())
    .filter(Boolean);

  // de-dupe while preserving order
  const seen = new Set<string>();
  const out: string[] = [];
  for (const s of statements) {
    const key = s.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(s);
  }
  return out;
}

/**
 * NEW: transcript chunking (RAG-friendly)
 * Splits transcript into chunks of ~TRANSCRIPT_CHUNK_CHARS characters,
 * preferring paragraph boundaries; falls back to hard slicing if needed.
 */
function splitTranscript(
  text: string,
  maxLen: number,
  maxChunks: number,
): string[] {
  const clean = String(text ?? "")
    .replace(/\r\n/g, "\n")
    .trim();
  if (!clean) return [];

  const paras = clean
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean);
  const out: string[] = [];
  let buf = "";

  const flush = () => {
    const v = buf.trim();
    if (v) out.push(v);
    buf = "";
  };

  for (const p of paras) {
    if (!p) continue;

    if (!buf) {
      if (p.length <= maxLen) {
        buf = p;
      } else {
        // paragraph too long: hard split
        let i = 0;
        while (i < p.length && out.length < maxChunks) {
          out.push(p.slice(i, i + maxLen).trim());
          i += maxLen;
        }
        buf = "";
      }
      if (out.length >= maxChunks) break;
      continue;
    }

    const candidate = `${buf}\n\n${p}`.trim();
    if (candidate.length <= maxLen) {
      buf = candidate;
    } else {
      flush();
      if (p.length <= maxLen) {
        buf = p;
      } else {
        let i = 0;
        while (i < p.length && out.length < maxChunks) {
          out.push(p.slice(i, i + maxLen).trim());
          i += maxLen;
        }
        buf = "";
      }
    }

    if (out.length >= maxChunks) break;
  }

  if (out.length < maxChunks) flush();

  return out.slice(0, maxChunks);
}

export async function ensureOakSource() {
  // Aligned: CurriculumSource.slug is @unique in your schema
  if (DRY_RUN) {
    console.log("[oak] DRY_RUN=1 — skipping CurriculumSource upsert");
    const existing = await prisma.curriculumSource.findUnique({
      where: { slug: "oak" },
    });
    if (existing) return existing;
    return { id: "dry_run_oak", slug: "oak" } as any;
  }

  return prisma.curriculumSource.upsert({
    where: { slug: "oak" },
    update: {
      name: "Oak National Academy",
      url: "https://open-api.thenational.academy",
      license: "Open Government Licence (check per-asset attribution)",
      isActive: true,
    },
    create: {
      name: "Oak National Academy",
      slug: "oak",
      url: "https://open-api.thenational.academy",
      license: "Open Government Licence (check per-asset attribution)",
      isActive: true,
    },
  });
}

export async function syncOakForStems() {
  const t0 = now();
  const source = await ensureOakSource();

  console.log(
    `[oak] sync start sourceId=${source.id} logEvery=${LOG_EVERY} debug=${DEBUG} dryRun=${DRY_RUN} transcriptChunkChars=${TRANSCRIPT_CHUNK_CHARS} transcriptMaxChunks=${TRANSCRIPT_MAX_CHUNKS}`,
  );

  if (DB_LOG) {
    try {
      const dbRow = await prisma.$queryRaw<Array<{ db: string; usr: string }>>`
        select current_database() as db, current_user as usr
      `;
      console.log("[oak] db identity", dbRow?.[0] ?? dbRow);
    } catch (e: any) {
      console.warn("[oak] db identity log failed", e?.message ?? e);
    }
  }

  // Heartbeat every 15s so it never looks hung
  const hb = setInterval(() => {
    console.log(`[oak] heartbeat ${new Date().toISOString()}`);
  }, 15000);

  const stats = {
    subjects: 0,
    sequences: 0,
    units: 0,
    unitsWithSummary: 0,
    lessons: 0,
    chunks: 0,
    objectives: 0,
    errors: 0,
    skippedUnitsNotFound: 0,
    skippedLessonsNotFound: 0,
    skippedTranscriptUnavailable: 0,
    skippedWritesDryRun: 0,
    transcriptChunks: 0,
  };

  try {
    const tSubjects = now();
    const subjects = await oakGet<OakSubjectListItem[]>("/subjects");
    console.log(
      `[oak] subjects fetched count=${subjects.length} in ${ms(now() - tSubjects)}`,
    );

    const wanted = new Set(["maths", "science", "computing"]);
    const stemSubjects = subjects.filter((s) => wanted.has(s.subjectSlug));
    console.log(
      `[oak] STEM subjects=${stemSubjects.map((s) => s.subjectSlug).join(",")}`,
    );

    let lessonCounter = 0;

    for (const subj of stemSubjects) {
      stats.subjects++;
      console.log(
        `\n[oak] SUBJECT ${subj.subjectSlug} sequences=${subj.sequenceSlugs.length}`,
      );

      for (const seq of subj.sequenceSlugs) {
        stats.sequences++;
        const seqStart = now();
        console.log(`[oak]  SEQ ${seq.sequenceSlug} start`);

        // Units (normalize shapes)
        const tUnits = now();
        const unitsRaw = await oakGet<any>(
          `/sequences/${seq.sequenceSlug}/units`,
        );
        const unitsByGroup = normalizeUnitsResponse(unitsRaw);
        const unitCount = unitsByGroup.reduce(
          (acc, g) => acc + (Array.isArray(g.units) ? g.units.length : 0),
          0,
        );
        console.log(
          `[oak]  SEQ ${seq.sequenceSlug} units groups=${unitsByGroup.length} units=${unitCount} in ${ms(now() - tUnits)}`,
        );

        // Questions (can be big)
        const tQ = now();
        const seqQuestions = await oakGet<OakSequenceQuestions>(
          `/sequences/${seq.sequenceSlug}/questions`,
        );
        const questionsByLesson = new Map(
          seqQuestions.map((q) => [q.lessonSlug, q]),
        );
        console.log(
          `[oak]  SEQ ${seq.sequenceSlug} questions lessons=${questionsByLesson.size} in ${ms(now() - tQ)}`,
        );

        for (const group of unitsByGroup) {
          const units = Array.isArray(group.units) ? group.units : [];

          for (const rawUnit of units) {
            const u = normalizeSequenceUnitItem(rawUnit);
            if (!u.unitSlug) continue;

            stats.units++;

            // Unit summary
            const tUnitSummary = now();
            let unitSummary: OakUnitSummary | null = null;

            try {
              unitSummary = await oakGet<OakUnitSummary>(
                `/units/${u.unitSlug}/summary`,
              );
              stats.unitsWithSummary++;
            } catch (e: any) {
              if (isOakNotFound(e)) {
                stats.skippedUnitsNotFound++;
                console.warn(
                  `[oak]   UNIT not found (skipping) seq=${seq.sequenceSlug} unitSlug=${u.unitSlug}`,
                );
                continue;
              }
              stats.errors++;
              console.error(
                `[oak]   UNIT summary failed unitSlug=${u.unitSlug} err=${e?.message ?? e}`,
              );
              continue;
            }

            if (!unitSummary) continue;

            const yr = safeYearGroup((unitSummary as any).year);

            // Objectives (ROBUST)
            const subjectSlug = String(
              (unitSummary as any).subjectSlug ?? subj.subjectSlug ?? "",
            );
            const keyStageSlug = String(
              (unitSummary as any).keyStageSlug ?? "",
            );
            const subjectEnum = mapOakSubjectToEnum(subjectSlug);
            const keyStageEnum = mapOakKsToEnumKeyStage(keyStageSlug);
            const statements = extractNationalCurriculumStatements(unitSummary);

            if (DEBUG) {
              const lessonSlugsPreview = extractLessonSlugsFromUnitSummary(
                unitSummary,
              ).slice(0, 3);
              console.log(
                `[oak]   UNIT ${u.unitSlug} year=${yr ?? "null"} lessons=${extractLessonSlugsFromUnitSummary(unitSummary).length} lessonPreview=${lessonSlugsPreview.join(",") || "none"} ncStatements=${statements.length} in ${ms(now() - tUnitSummary)}`,
              );
            }

            for (const statement of statements) {
              const code = objectiveCode(
                subjectSlug,
                keyStageSlug,
                u.unitSlug,
                statement,
              );

              if (DRY_RUN) {
                stats.skippedWritesDryRun++;
              } else {
                await prisma.curriculumObjective.upsert({
                  where: { code },
                  update: {
                    subject: subjectEnum,
                    keyStage: keyStageEnum,
                    yearGroup: yr,
                    strand:
                      u.unitTitle ??
                      (unitSummary as any).unitTitle ??
                      "Oak Unit",
                    title: statement.slice(0, 160),
                    statement,
                    statutory: true,
                    keywords: ["oak", subjectSlug, keyStageSlug].filter(
                      Boolean,
                    ),
                    sourceId: source.id,
                  },
                  create: {
                    code,
                    subject: subjectEnum,
                    keyStage: keyStageEnum,
                    yearGroup: yr,
                    strand:
                      u.unitTitle ??
                      (unitSummary as any).unitTitle ??
                      "Oak Unit",
                    title: statement.slice(0, 160),
                    statement,
                    statutory: true,
                    keywords: ["oak", subjectSlug, keyStageSlug].filter(
                      Boolean,
                    ),
                    sourceId: source.id,
                  },
                });
              }

              stats.objectives++;
            }

            // Lessons (unitLessons / multiple shapes)
            const lessonSlugs = extractLessonSlugsFromUnitSummary(unitSummary);

            if (DEBUG && lessonSlugs.length === 0) {
              console.warn(
                `[oak]   WARNING: no lessons extracted for unitSlug=${u.unitSlug} (payload keys: ${Object.keys(
                  unitSummary as any,
                )
                  .slice(0, 25)
                  .join(",")})`,
              );
            }

            for (const lessonSlug of lessonSlugs) {
              stats.lessons++;
              lessonCounter++;

              const logThis = lessonCounter % LOG_EVERY === 0;
              const lessonStart = now();

              let lessonSummary: OakLessonSummary | null = null;
              let transcript: OakLessonTranscript | null = null;

              try {
                lessonSummary = await oakGet<OakLessonSummary>(
                  `/lessons/${lessonSlug}/summary`,
                );
              } catch (e: any) {
                if (isOakNotFound(e)) {
                  stats.skippedLessonsNotFound++;
                  console.warn(
                    `[oak]    LESSON not found (skipping) seq=${seq.sequenceSlug} lessonSlug=${lessonSlug}`,
                  );
                  continue;
                }
                stats.errors++;
                console.error(
                  `[oak]    LESSON summary failed lessonSlug=${lessonSlug} err=${e?.message ?? e}`,
                );
                continue;
              }

              if (!lessonSummary) continue;

              // Transcript (optional)
              if (!SKIP_TRANSCRIPT) {
                try {
                  transcript = await oakGet<OakLessonTranscript>(
                    `/lessons/${lessonSlug}/transcript`,
                  );
                } catch (e: any) {
                  if (isOakNotFound(e) || isOakTranscriptUnavailable(e)) {
                    stats.skippedTranscriptUnavailable++;
                    if (DEBUG)
                      console.warn(
                        `[oak]    transcript unavailable (skipping) lessonSlug=${lessonSlug}`,
                      );
                  } else {
                    stats.errors++;
                    console.warn(
                      `[oak]    transcript failed (continuing) lessonSlug=${lessonSlug} err=${e?.message ?? e}`,
                    );
                  }
                }
              }

              const lessonSubject = mapOakSubjectToEnum(
                String((lessonSummary as any).subjectSlug ?? subjectSlug),
              );
              const lessonKs = mapOakKsToEnumKeyStage(
                String((lessonSummary as any).keyStageSlug ?? keyStageSlug),
              );

              // Prisma-aligned upsert helper (tags + citations required arrays)
              const upsertChunk = async (
                type: ChunkType,
                difficulty: DifficultyBand,
                content: string,
                tags: string[],
                citations: string[],
                idSuffix?: string,
              ) => {
                const id = chunkId(lessonSlug, type, idSuffix);

                if (DRY_RUN) {
                  stats.skippedWritesDryRun++;
                  stats.chunks++;
                  return;
                }

                await prisma.contentChunk.upsert({
                  where: { id },
                  update: {
                    sourceId: source.id,
                    subject: lessonSubject,
                    keyStage: lessonKs,
                    yearGroup: yr,
                    strand:
                      (unitSummary as any).unitTitle ?? u.unitTitle ?? null,
                    type,
                    difficulty,
                    content,
                    citations: Array.isArray(citations) ? citations : [],
                    tags: Array.isArray(tags) ? tags : [],
                    isActive: true,
                  },
                  create: {
                    id,
                    sourceId: source.id,
                    subject: lessonSubject,
                    keyStage: lessonKs,
                    yearGroup: yr,
                    strand:
                      (unitSummary as any).unitTitle ?? u.unitTitle ?? null,
                    type,
                    difficulty,
                    content,
                    citations: Array.isArray(citations) ? citations : [],
                    tags: Array.isArray(tags) ? tags : [],
                    isActive: true,
                  },
                });

                stats.chunks++;
              };

              // Summary chunk
              await upsertChunk(
                "EXPLANATION",
                "MEDIUM",
                compactTextFromLessonSummary(lessonSummary),
                [
                  "oak",
                  "lesson",
                  "summary",
                  String((lessonSummary as any).subjectSlug ?? ""),
                  String((lessonSummary as any).keyStageSlug ?? ""),
                ].filter(Boolean),
                [`/lessons/${lessonSlug}/summary`],
                "summary",
              );

              // Transcript chunks (REAL chunking)
              if (transcript?.transcript?.trim()) {
                const parts = splitTranscript(
                  transcript.transcript,
                  TRANSCRIPT_CHUNK_CHARS,
                  TRANSCRIPT_MAX_CHUNKS,
                );
                for (let i = 0; i < parts.length; i++) {
                  const part = parts[i];
                  if (!part.trim()) continue;
                  const suffix = `transcript:${String(i).padStart(2, "0")}`;
                  await upsertChunk(
                    "EXPLANATION",
                    "MEDIUM",
                    part,
                    [
                      "oak",
                      "lesson",
                      "transcript",
                      "chunk",
                      String((lessonSummary as any).subjectSlug ?? ""),
                      String((lessonSummary as any).keyStageSlug ?? ""),
                    ].filter(Boolean),
                    [`/lessons/${lessonSlug}/transcript`],
                    suffix,
                  );
                  stats.transcriptChunks++;
                }
              }

              // Misconceptions chunk
              if ((lessonSummary as any).misconceptions?.length) {
                const text = (lessonSummary as any).misconceptions
                  .map((m: any) =>
                    [m.misconception, m.teacherResponse ?? m.pupilLessonOutcome]
                      .map((x) => String(x ?? "").trim())
                      .filter(Boolean)
                      .join(" — "),
                  )
                  .filter(Boolean)
                  .join("\n");

                if (text.trim()) {
                  await upsertChunk(
                    "MISCONCEPTION",
                    "MEDIUM",
                    text,
                    [
                      "oak",
                      "lesson",
                      "misconceptions",
                      String((lessonSummary as any).subjectSlug ?? ""),
                      String((lessonSummary as any).keyStageSlug ?? ""),
                    ].filter(Boolean),
                    [`/lessons/${lessonSlug}/summary`],
                    "misconceptions",
                  );
                }
              }

              // Quiz chunk (questions only)
              const q = questionsByLesson.get(lessonSlug);
              const hasQuiz =
                !!q &&
                ((q as any).starterQuiz?.length ?? 0) +
                  ((q as any).exitQuiz?.length ?? 0) >
                  0;

              if (hasQuiz) {
                const text = compactTextFromQuiz(q);
                if (text.trim()) {
                  await upsertChunk(
                    "PRACTICE",
                    "MEDIUM",
                    text,
                    [
                      "oak",
                      "lesson",
                      "quiz",
                      String((lessonSummary as any).subjectSlug ?? ""),
                      String((lessonSummary as any).keyStageSlug ?? ""),
                    ].filter(Boolean),
                    [`/sequences/${seq.sequenceSlug}/questions`],
                    "quiz",
                  );
                }
              }

              if (logThis) {
                console.log(
                  `[oak]    progress lessons=${lessonCounter} totalChunks=${stats.chunks} transcriptChunks=${stats.transcriptChunks} objectives=${stats.objectives} unitsWithSummary=${stats.unitsWithSummary}/${stats.units} skippedUnits404=${stats.skippedUnitsNotFound} skippedLessons404=${stats.skippedLessonsNotFound} transcriptUnavailable=${stats.skippedTranscriptUnavailable} dryWrites=${stats.skippedWritesDryRun} (last lesson ${lessonSlug} in ${ms(now() - lessonStart)})`,
                );
              }
            }
          }
        }

        console.log(
          `[oak]  SEQ ${seq.sequenceSlug} done in ${ms(now() - seqStart)}`,
        );
      }
    }

    console.log(
      `\n[oak] sync complete in ${ms(now() - t0)} stats=${JSON.stringify(stats)}`,
    );
    return stats;
  } finally {
    clearInterval(hb);
  }
}
