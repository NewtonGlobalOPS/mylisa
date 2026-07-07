# Oak Bulk Import Runbook

This runbook records the production-safe Oak import flow used for MyLisa. It is written for maths first, but the same pattern should be used for science, English, and computing.

## Storage Model

No Prisma migration is required for the current Oak import.

- `CurriculumSource` stores Oak as the source.
- `CurriculumObjective` stores National Curriculum statements from Oak units.
- `ContentChunk` stores lesson summaries, transcripts, misconceptions, practice prompts, and asset/download metadata.
- `CanonicalQuestion.contentJson` stores Oak quiz payloads, including `questionImage`, raw answer payloads, answer images, answer contracts, and the immutable Oak answer truth.
- `CanonicalQuestion.generatorMeta` stores lesson/unit/quiz provenance.

Only add a Prisma model later if we need local file mirroring, expiry tracking for signed downloads, or a first-class asset browser. For now, storing Oak asset URLs, attribution, and metadata in `ContentChunk.citations/tags/content` is enough and avoids unnecessary schema risk.

## Source Of Truth

Use Oak bulk download as the baseline catalogue, then use lesson APIs for data that the current maths bulk JSON does not include.

Bulk download includes:

- subject/phase sequence
- units
- National Curriculum statements
- prior knowledge
- lesson summaries
- key learning points
- misconceptions
- teacher tips
- transcripts and VTT
- downloadable-resource availability

Lesson APIs still required:

- `GET /lessons/{lesson}/quiz` for starter/exit quiz questions and image-bearing quiz data
- `GET /lessons/{lesson}/assets` for worksheets, slide decks, videos, quiz PDFs, attribution, and download endpoints
- `GET /lessons/{lesson}/summary` as a refresh/fallback where bulk data is stale

Oak docs:

- Bulk download: `https://open-api.thenational.academy/bulk-download`
- Lesson data: `https://open-api.thenational.academy/docs/api-endpoints/lesson-data`
- Quiz questions: `https://open-api.thenational.academy/docs/api-endpoints/quiz-questions`

## Maths Clean Run

Run from the repo root.

```bash
cd /mnt/data/projects/mylisa
```

Confirm there are no existing Oak jobs:

```bash
ps -ef | rg "oakSync|oakCanonical|oakMathsBulk"
```

Create the bulk audit CSVs:

```bash
npx tsx src/scripts/oakMathsBulkAudit.ts
```

Expected output files:

- `reports/oak_maths_bulk_summary.csv`
- `reports/oak_maths_bulk_lessons.csv`

Run the bulk-first chunk/objective import. This is safe to rerun because it deactivates the previous active bulk chunk set for the selected subject, then upserts the current bulk set with deterministic IDs.

```bash
npx tsx src/scripts/oakBulkImport.ts --subjects=maths
```

Notes:

- Bulk import uses `sequenceSlug + bulk lesson row index + unitSlug + lessonSlug` as the chunk identity. This is necessary because Oak lesson slugs are not globally unique, and maths-secondary repeats some `unitSlug + lessonSlug` pairs.
- Previous bulk chunks are marked inactive, not deleted.
- Endpoint sync via `src/scripts/oakSync.ts` should now be treated as a refresh/gap-fill tool, not the baseline catalogue import.
- Do not use any seed script for this process.

Rebuild Oak canonicals without deleting existing data:

```bash
npx tsx src/scripts/oakCanonicalRebuild.ts --subjects=maths --apply
```

Do not add `--replace` unless there is a deliberate, backed-up decision to remove and rebuild all Oak canonicals for the selected subject.

## Verification

Check core DB counts:

```bash
npx tsx -e '
import "dotenv/config";
import { prisma } from "./src/lib/prisma.ts";
async function main() {
  const source = await prisma.curriculumSource.findFirst({ where: { slug: "oak" }, select: { id: true } });
  if (!source) throw new Error("No Oak source");
  const result = {
    objectives: await prisma.curriculumObjective.count({ where: { sourceId: source.id, subject: "MATHS", isActive: true } }),
    chunks: await prisma.contentChunk.count({ where: { sourceId: source.id, subject: "MATHS", isActive: true } }),
    assetChunks: await prisma.contentChunk.count({ where: { sourceId: source.id, subject: "MATHS", isActive: true, tags: { has: "assets" } } }),
    quizChunks: await prisma.contentChunk.count({ where: { sourceId: source.id, subject: "MATHS", isActive: true, tags: { has: "quiz" } } }),
    transcriptChunks: await prisma.contentChunk.count({ where: { sourceId: source.id, subject: "MATHS", isActive: true, tags: { has: "transcript" } } }),
    canonicals: await prisma.canonicalQuestion.count({ where: { objective: { sourceId: source.id, subject: "MATHS" }, status: "ACTIVE" } }),
    imageCanonicals: await prisma.canonicalQuestion.count({
      where: {
        objective: { sourceId: source.id, subject: "MATHS" },
        status: "ACTIVE",
        contentJson: { path: ["oak", "questionImage", "url"], not: null },
      },
    }),
  };
  console.log(JSON.stringify(result, null, 2));
}
main().finally(() => prisma.$disconnect());
'
```

Current maths bulk baseline discovered on 2026-06-09:

- `maths-primary`: 125 units, 1,072 lessons, 1,072 transcripts, 1,072 downloadable lessons
- `maths-secondary`: 98 units, 1,236 lessons, 1,236 transcripts, 1,236 downloadable lessons
- Total maths: 223 units, 2,308 lessons

## Replicating For Science, English, Computing

The same architecture should be used for each subject:

1. Download bulk JSON for `{subject}-primary` and `{subject}-secondary` where available.
2. Audit unit count, lesson count, key stage coverage, transcript count, and downloadable-resource count.
3. Upsert objectives from unit `nationalCurriculumContent`.
4. Upsert summary, misconception, teacher-tip, transcript, and asset chunks.
5. Rebuild canonicals from `GET /lessons/{lesson}/quiz`, not sequence questions alone.
6. Verify image-bearing canonicals by checking `contentJson.oak.questionImage.url` and raw answer image payloads.

Subject slugs to use:

- `maths`
- `science`
- `english`
- `computing`

Bulk subject/phase slugs:

- `maths-primary`, `maths-secondary`
- `science-primary`, `science-secondary`
- `english-primary`, `english-secondary`
- `computing-primary`, `computing-secondary`

The existing `oakSync.ts` and `oakCanonicalRebuild.ts` scripts accept `--subjects=...`. A generic bulk audit/import script should be created before running this at scale for science, English, and computing so that all four subjects follow the same reporting and verification contract.

## Guardrails

- Do not seed.
- Do not truncate or reset curriculum tables.
- Do not use `--replace` unless a DB backup exists and the rebuild decision is explicit.
- Prefer additive upserts and `createMany(..., skipDuplicates: true)`.
- Keep Oak attribution and asset URLs in citations.
- Treat Oak signed/download URLs as externally owned; do not assume permanent local ownership unless a future asset-mirroring model is added.
