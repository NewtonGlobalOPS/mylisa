import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { exportObjectives } from "../src/services/objective-export.service";

function getArg(name: string): string | undefined {
  const arg = process.argv.find((a) => a.startsWith(`--${name}=`));
  return arg ? arg.split("=")[1] : undefined;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set");

  const adapter = new PrismaPg({ connectionString });
  const prisma = new PrismaClient({ adapter });

  try {
    const format = (getArg("format") ?? "both") as "xlsx" | "docx" | "both";
    const organisationSlug = getArg("organisationSlug");
    const activeOnly = process.argv.includes("--activeOnly");

    const result = await exportObjectives(prisma, {
      format,
      organisationSlug,
      activeOnly,
      outputDir: "exports/objectives",
    });

    console.log(result);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});