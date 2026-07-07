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
  CurriculumObjective,
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
const DEFAULT_OAK_SUBJECTS = ["maths", "science", "computing", "english"];

type OakSubjectDetail = OakSubjectListItem | {
  subjectTitle: string;
  subjectSlug: string;
  sequenceSlugs: Array<{
    sequenceSlug: string;
    years?: Array<number>;
    keyStages?: Array<{ keyStageSlug: string; keyStageTitle: string }>;
    phaseSlug?: string;
    phaseTitle?: string;
  }>;
  years?: Array<number>;
  keyStages?: Array<{ keyStageSlug: string; keyStageTitle: string }>;
};

type SyncedObjective = Pick<
  CurriculumObjective,
  "id" | "code" | "strandId" | "strand" | "title" | "statement"
>;

type OakLessonQuiz = {
  lessonTitle?: string;
  lessonSlug?: string;
  starterQuiz?: any[];
  exitQuiz?: any[];
};

type OakLessonAssets = {
  oakUrl?: string;
  attribution?: string[];
  assets?: Array<{
    type?: string;
    label?: string;
    url?: string;
  }>;
};

function now() {
  return Date.now();
}
function ms(n: number) {
  return `${Math.round(n)}ms`;
}
function sha1(input: string) {
  return crypto.createHash("sha1").update(input).digest("hex");
}
function sha256(input: string) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function normalizeOakSubjectSlug(value: string): string {
  return String(value ?? "")
    .trim()
    .toLowerCase();
}

function resolveWantedOakSubjects(input?: string[]): string[] {
  const raw = input?.length
    ? input
    : String(process.env.OAK_SUBJECTS ?? "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean);

  const normalized = raw
    .map(normalizeOakSubjectSlug)
    .filter((value) => DEFAULT_OAK_SUBJECTS.includes(value));

  return normalized.length ? [...new Set(normalized)] : DEFAULT_OAK_SUBJECTS;
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
  if (
    s === "science" ||
    s === "combined-science" ||
    s === "combined_science" ||
    s === "biology" ||
    s === "chemistry" ||
    s === "physics"
  ) {
    return "SCIENCE";
  }
  if (s === "computing") return "COMPUTING";
  if (s === "english") return "ENGLISH";
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

async function fetchOakSubjectDetails(
  wantedSubjects: string[],
): Promise<OakSubjectDetail[]> {
  const rawSubjects = await oakGet<Array<string | OakSubjectListItem>>("/subjects");
  const subjectSlugs = rawSubjects
    .map((subject) =>
      typeof subject === "string" ? subject : String(subject.subjectSlug ?? ""),
    )
    .map(normalizeOakSubjectSlug)
    .filter((slug) => wantedSubjects.includes(slug));

  const details: OakSubjectDetail[] = [];
  for (const slug of subjectSlugs) {
    const existing = rawSubjects.find(
      (subject) =>
        typeof subject !== "string" &&
        normalizeOakSubjectSlug(subject.subjectSlug) === slug &&
        Array.isArray(subject.sequenceSlugs),
    );
    if (existing && typeof existing !== "string") {
      details.push(existing);
      continue;
    }

    const detail = await oakGet<OakSubjectDetail>(`/subjects/${slug}`);
    details.push(detail);
  }

  return details;
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
  const out: Array<{ units: any[]; year?: any; title?: any }> = [];

  const pushGroup = (units: any[], meta?: { year?: any; title?: any }) => {
    if (!Array.isArray(units) || !units.length) return;
    out.push({
      units,
      year: meta?.year,
      title: meta?.title,
    });
  };

  const walk = (value: any, meta?: { year?: any; title?: any }) => {
    if (!value) return;

    if (Array.isArray(value)) {
      if (value.length === 0) return;

      // Shape A: [{ year, units: [...] }]
      if (value.every((x) => x && Array.isArray(x.units))) {
        for (const item of value) {
          walk(item, meta);
        }
        return;
      }

      // Shape B: [unit, unit, ...]
      if (
        value.every(
          (x) => x && typeof x === "object" && ("unitSlug" in x || "slug" in x),
        )
      ) {
        pushGroup(value as any[], meta);
        return;
      }

      for (const item of value) {
        walk(item, meta);
      }
      return;
    }

    if (typeof value !== "object") return;

    if (Array.isArray(value.units)) {
      pushGroup(value.units, {
        year: value.year ?? meta?.year,
        title: value.title ?? value.examBoardTitle ?? meta?.title,
      });
    }

    // KS4 maths often nests unit groups under tiers -> units.
    if (Array.isArray(value.tiers)) {
      for (const tier of value.tiers) {
        walk(tier, {
          year: value.year ?? meta?.year,
          title:
            tier?.title ??
            tier?.tier ??
            value.title ??
            value.examBoardTitle ??
            meta?.title,
        });
      }
    }

    // KS4 science often nests under examSubjects -> tiers -> units.
    if (Array.isArray(value.examSubjects)) {
      for (const examSubject of value.examSubjects) {
        walk(examSubject, {
          year: value.year ?? meta?.year,
          title:
            examSubject?.title ??
            examSubject?.subject ??
            value.title ??
            value.examBoardTitle ??
            meta?.title,
        });
      }
    }

    if (Array.isArray(value.years)) {
      for (const year of value.years) {
        walk(year, {
          year: year?.year ?? value.year ?? meta?.year,
          title: year?.title ?? value.title ?? meta?.title,
        });
      }
    }
  };

  walk(raw);

  if (out.length) {
    return out;
  }

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
  const raw = s as any;
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

  const keyLearningPoints = Array.isArray(raw.keyLearningPoints)
    ? raw.keyLearningPoints
    : [];
  if (keyLearningPoints.length) {
    lines.push("Key learning points:");
    for (const point of keyLearningPoints) {
      const body = String(point?.keyLearningPoint ?? point?.text ?? point ?? "").trim();
      if (body) lines.push(`- ${body}`);
    }
  }

  if (raw.pupilLessonOutcome) {
    lines.push(`Outcome: ${String(raw.pupilLessonOutcome).trim()}`);
  }

  const misconceptionItems = Array.isArray(s.misconceptions)
    ? s.misconceptions
    : Array.isArray(raw.misconceptionsAndCommonMistakes)
      ? raw.misconceptionsAndCommonMistakes
      : [];
  if (misconceptionItems.length) {
    lines.push("Misconceptions:");
    for (const m of misconceptionItems) {
      const a = (m.misconception ?? "").trim();
      const b = (m.teacherResponse ?? m.response ?? m.pupilLessonOutcome ?? "").trim();
      const joined = [a, b].filter(Boolean).join(" — ");
      if (joined) lines.push(`- ${joined}`);
    }
  }

  return lines.join("\n");
}

function textTokens(value: string): Set<string> {
  const stop = new Set([
    "and",
    "the",
    "with",
    "from",
    "that",
    "this",
    "into",
    "including",
    "appropriate",
    "using",
    "through",
    "their",
    "where",
    "which",
    "will",
    "data",
  ]);
  return new Set(
    value
      .toLowerCase()
      .split(/[^a-z0-9]+/g)
      .filter((token) => token.length >= 4 && !stop.has(token)),
  );
}

function lessonMatchText(
  lessonSummary: OakLessonSummary,
  transcript: OakLessonTranscript | null,
) {
  const raw = lessonSummary as any;
  return [
    lessonSummary.lessonTitle,
    raw.pupilLessonOutcome,
    ...(raw.lessonKeywords ?? []).flatMap((item: any) => [
      item?.keyword,
      item?.description,
    ]),
    ...(raw.keyLearningPoints ?? []).map((item: any) => item?.keyLearningPoint ?? item?.text),
    ...(raw.misconceptionsAndCommonMistakes ?? []).flatMap((item: any) => [
      item?.misconception,
      item?.response,
    ]),
    transcript?.transcript?.slice(0, 4000),
  ]
    .filter(Boolean)
    .map(String)
    .join("\n");
}

function chooseObjectiveForLesson(input: {
  objectives: SyncedObjective[];
  lessonSummary: OakLessonSummary;
  transcript: OakLessonTranscript | null;
}): SyncedObjective | null {
  if (!input.objectives.length) return null;
  if (input.objectives.length === 1) return input.objectives[0];

  const lessonText = lessonMatchText(input.lessonSummary, input.transcript);
  const lessonTokens = textTokens(lessonText);
  const lowerLessonText = lessonText.toLowerCase();

  let best: { objective: SyncedObjective; score: number } | null = null;
  for (const objective of input.objectives) {
    const objectiveText = [objective.title, objective.statement].join("\n");
    const objectiveTokens = textTokens(objectiveText);
    let score = 0;
    for (const token of objectiveTokens) {
      if (lessonTokens.has(token)) score += 2;
    }

    const lowerObjectiveText = objectiveText.toLowerCase();
    for (const phrase of [
      "scatter graph",
      "bivariate",
      "correlation",
      "frequency table",
      "bar chart",
      "pie chart",
      "pictogram",
      "vertical line",
      "grouped numerical",
      "mean",
      "median",
      "mode",
      "range",
      "central tendency",
      "distribution",
    ]) {
      if (lowerLessonText.includes(phrase) && lowerObjectiveText.includes(phrase)) {
        score += 12;
      }
    }

    if (!best || score > best.score) best = { objective, score };
  }

  return best?.objective ?? input.objectives[0];
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

function quizQuestionCount(q: any) {
  return (
    (Array.isArray(q?.starterQuiz) ? q.starterQuiz.length : 0) +
    (Array.isArray(q?.exitQuiz) ? q.exitQuiz.length : 0)
  );
}

async function fetchLessonQuizFallback(
  lessonSlug: string,
  lessonTitle?: string,
): Promise<OakLessonQuiz | null> {
  try {
    const quiz = await oakGet<OakLessonQuiz>(`/lessons/${lessonSlug}/quiz`);
    if (quizQuestionCount(quiz) === 0) return null;
    return {
      ...quiz,
      lessonSlug,
      lessonTitle: quiz.lessonTitle ?? lessonTitle ?? lessonSlug,
    };
  } catch (e: any) {
    if (DEBUG) {
      console.warn(
        `[oak]    quiz unavailable lessonSlug=${lessonSlug} err=${e?.message ?? e}`,
      );
    }
    return null;
  }
}

async function fetchLessonAssets(
  lessonSlug: string,
): Promise<OakLessonAssets | null> {
  try {
    const assets = await oakGet<OakLessonAssets>(`/lessons/${lessonSlug}/assets`);
    if (!Array.isArray(assets.assets) || assets.assets.length === 0) return null;
    return assets;
  } catch (e: any) {
    if (DEBUG) {
      console.warn(
        `[oak]    assets unavailable lessonSlug=${lessonSlug} err=${e?.message ?? e}`,
      );
    }
    return null;
  }
}

function compactTextFromAssets(lessonSlug: string, assets: OakLessonAssets) {
  const lines: string[] = [];
  lines.push(`Oak lesson assets for ${lessonSlug}`);
  if (assets.oakUrl) lines.push(`Oak URL: ${assets.oakUrl}`);
  if (Array.isArray(assets.attribution) && assets.attribution.length) {
    lines.push("Attribution:");
    for (const item of assets.attribution) {
      const text = String(item ?? "").trim();
      if (text) lines.push(`- ${text}`);
    }
  }
  lines.push("Available downloads:");
  for (const asset of assets.assets ?? []) {
    const type = String(asset.type ?? "").trim();
    const label = String(asset.label ?? "").trim();
    const url = String(asset.url ?? "").trim();
    if (type || label || url) {
      lines.push(`- ${label || type}${type ? ` (${type})` : ""}${url ? `: ${url}` : ""}`);
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
  const preferredSlug = (process.env.OAK_ORGANISATION_SLUG ?? "default").trim();
  const organisation =
    (await prisma.organisation.findFirst({
      where: preferredSlug
        ? {
            OR: [{ slug: preferredSlug }, { isActive: true }],
          }
        : { isActive: true },
      orderBy: [{ slug: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        isActive: true,
      },
    })) ??
    null;

  if (!organisation) {
    throw new Error("No organisation found for Oak sync");
  }

  // Aligned: CurriculumSource.slug is @unique in your schema
  if (DRY_RUN) {
    console.log("[oak] DRY_RUN=1 — skipping CurriculumSource upsert");
    const existing = await prisma.curriculumSource.findUnique({
      where: {
        organisationId_slug: {
          organisationId: organisation.id,
          slug: "oak",
        },
      },
    });
    if (existing) return existing;
    return {
      id: "dry_run_oak",
      slug: "oak",
      organisationId: organisation.id,
      organisation,
    } as any;
  }

  return prisma.curriculumSource.upsert({
    where: {
      organisationId_slug: {
        organisationId: organisation.id,
        slug: "oak",
      },
    },
    update: {
      name: "Oak National Academy",
      url: "https://open-api.thenational.academy",
      license: "Open Government Licence (check per-asset attribution)",
      isActive: true,
    },
    create: {
      organisationId: organisation.id,
      name: "Oak National Academy",
      slug: "oak",
      url: "https://open-api.thenational.academy",
      license: "Open Government Licence (check per-asset attribution)",
      isActive: true,
    },
  });
}

export async function syncOakCurriculum(options?: { subjectSlugs?: string[] }) {
  const t0 = now();
  const source = await ensureOakSource();
  const wantedSubjects = resolveWantedOakSubjects(options?.subjectSlugs);

  console.log(
    `[oak] sync start sourceId=${source.id} subjects=${wantedSubjects.join(",")} logEvery=${LOG_EVERY} debug=${DEBUG} dryRun=${DRY_RUN} transcriptChunkChars=${TRANSCRIPT_CHUNK_CHARS} transcriptMaxChunks=${TRANSCRIPT_MAX_CHUNKS}`,
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
    const subjects = await fetchOakSubjectDetails(wantedSubjects);
    console.log(
      `[oak] subjects fetched count=${subjects.length} in ${ms(now() - tSubjects)}`,
    );

    const wanted = new Set(wantedSubjects);
    const curriculumSubjects = subjects.filter((s) =>
      wanted.has(s.subjectSlug),
    );
    console.log(
      `[oak] subjects selected=${curriculumSubjects.map((s) => s.subjectSlug).join(",")}`,
    );

    let lessonCounter = 0;

    for (const subj of curriculumSubjects) {
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

            const unitObjectives: SyncedObjective[] = [];
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
                const objective = await prisma.curriculumObjective.upsert({
                  where: {
                    organisationId_code: {
                      organisationId: source.organisationId,
                      code,
                    },
                  },
                  update: {
                    organisationId: source.organisationId,
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
                    organisationId: source.organisationId,
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
                unitObjectives.push({
                  id: objective.id,
                  code: objective.code,
                  strandId: objective.strandId,
                  strand: objective.strand,
                  title: objective.title,
                  statement: objective.statement,
                });
              }

              stats.objectives++;
            }

            if (!unitObjectives.length && !DRY_RUN) {
              const codes = statements.map((statement) =>
                objectiveCode(subjectSlug, keyStageSlug, String(u.unitSlug), statement),
              );
              unitObjectives.push(
                ...(await prisma.curriculumObjective.findMany({
                  where: {
                    organisationId: source.organisationId,
                    code: { in: codes },
                  },
                  select: {
                    id: true,
                    code: true,
                    strandId: true,
                    strand: true,
                    title: true,
                    statement: true,
                  },
                })),
              );
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
              let lessonAssets: OakLessonAssets | null = null;
              let lessonQuiz: OakLessonQuiz | null =
                questionsByLesson.get(lessonSlug) ?? null;

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

              if (!lessonQuiz || quizQuestionCount(lessonQuiz) === 0) {
                lessonQuiz = await fetchLessonQuizFallback(
                  lessonSlug,
                  lessonSummary.lessonTitle,
                );
              }

              if ((lessonSummary as any).downloadsAvailable || (lessonSummary as any).downloadsavailable) {
                lessonAssets = await fetchLessonAssets(lessonSlug);
              }

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
              const matchedObjective = chooseObjectiveForLesson({
                objectives: unitObjectives,
                lessonSummary,
                transcript,
              });

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
                const contentHash = sha256(
                  JSON.stringify({
                    organisationId: source.organisationId,
                    sourceId: source.id,
                    lessonSlug,
                    type,
                    idSuffix: idSuffix ?? null,
                    content,
                  }),
                );

                if (DRY_RUN) {
                  stats.skippedWritesDryRun++;
                  stats.chunks++;
                  return;
                }

                await prisma.contentChunk.upsert({
                  where: { id },
                  update: {
                    organisationId: source.organisationId,
                    sourceId: source.id,
                    subject: lessonSubject,
                    keyStage: lessonKs,
                    yearGroup: yr,
                    objectiveId: matchedObjective?.id ?? null,
                    strandId: matchedObjective?.strandId ?? null,
                    strand:
                      matchedObjective?.strand ??
                      (unitSummary as any).unitTitle ??
                      u.unitTitle ??
                      null,
                    type,
                    difficulty,
                    content,
                    contentSha256: contentHash,
                    citations: Array.isArray(citations) ? citations : [],
                    tags: Array.isArray(tags) ? tags : [],
                    isActive: true,
                  },
                  create: {
                    id,
                    organisationId: source.organisationId,
                    sourceId: source.id,
                    subject: lessonSubject,
                    keyStage: lessonKs,
                    yearGroup: yr,
                    objectiveId: matchedObjective?.id ?? null,
                    strandId: matchedObjective?.strandId ?? null,
                    strand:
                      matchedObjective?.strand ??
                      (unitSummary as any).unitTitle ??
                      u.unitTitle ??
                      null,
                    type,
                    difficulty,
                    content,
                    contentSha256: contentHash,
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
              const q = lessonQuiz;
              const hasQuiz =
                !!q &&
                quizQuestionCount(q) > 0;

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
                    [
                      `/sequences/${seq.sequenceSlug}/questions`,
                      `/lessons/${lessonSlug}/quiz`,
                    ],
                    "quiz",
                  );
                }
              }

              if (lessonAssets) {
                const text = compactTextFromAssets(lessonSlug, lessonAssets);
                if (text.trim()) {
                  await upsertChunk(
                    "EXPLANATION",
                    "MEDIUM",
                    text,
                    [
                      "oak",
                      "lesson",
                      "assets",
                      "downloads",
                      String((lessonSummary as any).subjectSlug ?? ""),
                      String((lessonSummary as any).keyStageSlug ?? ""),
                      ...(lessonAssets.assets ?? [])
                        .map((asset) => String(asset.type ?? "").trim())
                        .filter(Boolean),
                    ].filter(Boolean),
                    [
                      `/lessons/${lessonSlug}/assets`,
                      ...(lessonAssets.assets ?? [])
                        .map((asset) => String(asset.url ?? "").trim())
                        .filter(Boolean),
                    ],
                    "assets",
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

export const syncOakForStems = syncOakCurriculum;
