import "dotenv/config";
import { prisma } from "../src/lib/prisma.js";

async function main() {
  const subjectCounts = await Promise.all(
    (["MATHS", "SCIENCE", "COMPUTING", "ENGLISH"] as const).map(
      async (subject) => ({
        subject,
        objectives: await prisma.curriculumObjective.count({
          where: { subject, source: { slug: "oak" } },
        }),
        chunks: await prisma.contentChunk.count({
          where: { subject, source: { slug: "oak" } },
        }),
      }),
    ),
  );

  const duplicateObjectives = await prisma.$queryRawUnsafe<
    Array<{ subject: string; duplicate_groups: number; extra_rows: number }>
  >(
    `
      select
        subject::text as subject,
        count(*)::int as duplicate_groups,
        coalesce(sum(c - 1), 0)::int as extra_rows
      from (
        select subject, "organisationId", code, count(*) as c
        from "CurriculumObjective"
        where "sourceId" in (
          select id from "CurriculumSource" where slug = 'oak'
        )
        group by subject, "organisationId", code
        having count(*) > 1
      ) d
      group by subject
      order by subject
    `,
  );

  const duplicateChunks = await prisma.$queryRawUnsafe<
    Array<{ subject: string; duplicate_groups: number; extra_rows: number }>
  >(
    `
      select
        subject::text as subject,
        count(*)::int as duplicate_groups,
        coalesce(sum(c - 1), 0)::int as extra_rows
      from (
        select subject, "contentSha256", count(*) as c
        from "ContentChunk"
        where "sourceId" in (
          select id from "CurriculumSource" where slug = 'oak'
        )
        group by subject, "contentSha256"
        having count(*) > 1
      ) d
      group by subject
      order by subject
    `,
  );

  console.log(
    JSON.stringify(
      {
        subjectCounts,
        duplicateObjectives,
        duplicateChunks,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
