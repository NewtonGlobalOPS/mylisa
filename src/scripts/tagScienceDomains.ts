// src/scripts/tagScienceDomains.ts
//
// Tag Oak/UK science lesson chunks with:
// - tags[] = ["domain:physics" | "domain:chemistry" | "domain:biology" | "domain:general-science"]
// - scienceDomain (enum)
// - scienceDomainConfidence (float)
// - scienceDomainModel (string)
// - scienceDomainTaggedAt (datetime)
//
// Usage:
//   TAG_SCI_DRY_RUN=1 npx tsx src/scripts/tagScienceDomains.ts
//   TAG_SCI_DRY_RUN=0 npx tsx src/scripts/tagScienceDomains.ts
//
// Optional:
//   TAG_SCI_BATCH=100
//   TAG_SCI_MODEL="gpt-4.1-mini"   (or whatever your llmJson uses internally)

import "dotenv/config";
import { prisma } from "../lib/prisma.ts";
import { llmJson } from "../lib/llmJson.ts";

type Domain = "biology" | "chemistry" | "physics" | "general-science";
type ScienceDomainEnum =
  | "BIOLOGY"
  | "CHEMISTRY"
  | "PHYSICS"
  | "GENERAL_SCIENCE";

const DRY_RUN = process.env.TAG_SCI_DRY_RUN === "1";
const BATCH_SIZE = Number(process.env.TAG_SCI_BATCH ?? 100);
const MODEL_NAME = process.env.TAG_SCI_MODEL ?? "unknown";

function extractLessonSlug(citations: unknown): string | null {
  const arr = Array.isArray(citations) ? citations : [];
  for (const c of arr) {
    const s = String(c ?? "");
    const m = s.match(/\/lessons\/([^/]+)\//i);
    if (m?.[1]) return m[1];
  }
  return null;
}

function hasDomainTag(tags: string[]): boolean {
  return tags.some((t) => t.startsWith("domain:"));
}

function applyDomainTag(tags: string[], domain: Domain): string[] {
  const cleaned = (tags ?? []).filter((t) => !t.startsWith("domain:"));
  cleaned.push(`domain:${domain}`);
  return Array.from(new Set(cleaned));
}

function clip(text: string, max = 1800) {
  if (!text) return "";
  return text.length <= max ? text : text.slice(0, max);
}

function chunkArray<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

function domainToEnum(domain: Domain): ScienceDomainEnum {
  switch (domain) {
    case "biology":
      return "BIOLOGY";
    case "chemistry":
      return "CHEMISTRY";
    case "physics":
      return "PHYSICS";
    case "general-science":
      return "GENERAL_SCIENCE";
  }
}

async function classify(
  text: string,
): Promise<{ domain: Domain; confidence: number }> {
  const prompt = `
Classify the domain of this UK science lesson.

Return strict JSON:
{
  "domain": "biology" | "chemistry" | "physics" | "general-science",
  "confidence": number between 0 and 1
}

Lesson content:
${text}
`;

  const raw = await llmJson(prompt);

  let parsed: any;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error(`Invalid JSON from model: ${raw}`);
  }

  const allowed = new Set<Domain>([
    "biology",
    "chemistry",
    "physics",
    "general-science",
  ]);

  if (!allowed.has(parsed.domain)) {
    throw new Error(`Invalid domain: ${parsed.domain}`);
  }

  const conf = Number(parsed.confidence ?? 0);
  return {
    domain: parsed.domain,
    confidence: Number.isFinite(conf) ? Math.max(0, Math.min(1, conf)) : 0,
  };
}

async function run() {
  console.log("Starting science domain tagging...");
  console.log(
    `DRY_RUN=${DRY_RUN ? "1" : "0"} BATCH_SIZE=${BATCH_SIZE} MODEL=${MODEL_NAME}`,
  );

  const chunks = await prisma.contentChunk.findMany({
    where: {
      subject: "SCIENCE",
      isActive: true,
      // only tag ones not already tagged in schema fields
      OR: [{ scienceDomain: null }, { scienceDomainTaggedAt: null }],
    },
    select: {
      id: true,
      tags: true,
      citations: true,
      content: true,
      scienceDomain: true,
      scienceDomainTaggedAt: true,
    },
  });

  console.log(`Loaded ${chunks.length} science chunks (eligible)`);

  // Fast lookup for tags by chunkId
  const tagsById = new Map<string, string[]>();
  for (const c of chunks) tagsById.set(c.id, c.tags ?? []);

  // Group chunks by lessonSlug; classify once per lesson; apply to all chunkIds
  const lessonMap = new Map<
    string,
    { representative: string; chunkIds: string[] }
  >();

  for (const c of chunks) {
    const tags = c.tags ?? [];
    // If tags already contain domain:* AND scienceDomain is set, skip
    // (If you want to force overwrite, remove these checks)
    if (hasDomainTag(tags) && c.scienceDomain && c.scienceDomainTaggedAt)
      continue;

    const lessonSlug = extractLessonSlug(c.citations);
    if (!lessonSlug) continue;

    if (!lessonMap.has(lessonSlug)) {
      lessonMap.set(lessonSlug, {
        representative: c.content,
        chunkIds: [c.id],
      });
    } else {
      lessonMap.get(lessonSlug)!.chunkIds.push(c.id);
    }
  }

  console.log(`Found ${lessonMap.size} lessons needing tagging`);

  let processed = 0;
  let updatedChunks = 0;
  let skippedLessons = 0;
  let failedLessons = 0;

  for (const [lessonSlug, data] of lessonMap) {
    processed++;

    try {
      const rep = clip(data.representative);
      if (!rep.trim()) {
        console.log(
          `[${processed}/${lessonMap.size}] ${lessonSlug} → skipped (empty representative)`,
        );
        skippedLessons++;
        continue;
      }

      const result = await classify(rep);
      const enumVal = domainToEnum(result.domain);
      const now = new Date();

      console.log(
        `[${processed}/${lessonMap.size}] ${lessonSlug} → ${result.domain} (${result.confidence})`,
      );

      if (DRY_RUN) continue;

      // Build update operations for all chunks in this lesson
      const ops = data.chunkIds.map((chunkId) => {
        const existingTags = tagsById.get(chunkId) ?? [];
        const newTags = applyDomainTag(existingTags, result.domain);

        // keep local cache in sync
        tagsById.set(chunkId, newTags);

        return prisma.contentChunk.update({
          where: { id: chunkId },
          data: {
            tags: newTags,
            scienceDomain: enumVal,
            scienceDomainConfidence: result.confidence,
            scienceDomainModel: MODEL_NAME,
            scienceDomainTaggedAt: now,
          },
          select: { id: true },
        });
      });

      // Execute in batches to avoid huge tx
      for (const batch of chunkArray(ops, BATCH_SIZE)) {
        const res = await prisma.$transaction(batch);
        updatedChunks += res.length;
      }
    } catch (err: any) {
      failedLessons++;
      console.error(`Failed on ${lessonSlug}: ${err?.message ?? String(err)}`);
    }
  }

  console.log("Tagging complete.");
  console.log(
    `Lessons processed=${processed} skipped=${skippedLessons} failed=${failedLessons} chunksUpdated=${DRY_RUN ? 0 : updatedChunks}`,
  );

  if (!DRY_RUN) {
    // quick verification count
    const counts = await prisma.contentChunk.groupBy({
      by: ["scienceDomain"],
      where: {
        subject: "SCIENCE",
        isActive: true,
        scienceDomain: { not: null },
      },
      _count: { _all: true },
    });

    console.log("Counts by scienceDomain:");
    for (const row of counts) {
      console.log(`  ${row.scienceDomain}: ${row._count._all}`);
    }
  }
}

run()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect().catch(() => {});
  });
