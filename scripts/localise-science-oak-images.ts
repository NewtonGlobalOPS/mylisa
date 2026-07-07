import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/prisma.js";

const OUT_DIR = path.resolve(process.cwd(), "web/public/oak-stimuli/science");
const PUBLIC_PREFIX = "/oak-stimuli/science";

function isRemoteUrl(value: unknown): value is string {
  return typeof value === "string" && /^https?:\/\//i.test(value);
}

function extensionFromResponse(url: string, contentType: string | null) {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return ext;
  if (contentType?.includes("webp")) return ".webp";
  if (contentType?.includes("jpeg")) return ".jpg";
  return ".png";
}

async function download(url: string, filenameBase: string) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`Failed ${response.status}: ${url}`);
  const ext = extensionFromResponse(url, response.headers.get("content-type"));
  const filename = `${filenameBase}${ext}`;
  await writeFile(path.join(OUT_DIR, filename), Buffer.from(await response.arrayBuffer()));
  return `${PUBLIC_PREFIX}/${filename}`;
}

async function localiseImageObject(
  image: any,
  filenameBase: string,
  cache: Map<string, string>,
): Promise<boolean> {
  if (!image || typeof image !== "object" || !isRemoteUrl(image.url)) return false;
  const local = cache.get(image.url) ?? await download(image.url, filenameBase);
  cache.set(image.url, local);
  image.url = local;
  return true;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });
  const cache = new Map<string, string>();

  const rows = await prisma.canonicalQuestion.findMany({
    where: { status: "ACTIVE", objective: { subject: "SCIENCE" } },
    select: { id: true, contentJson: true },
    orderBy: { id: "asc" },
  });

  let rowsUpdated = 0;
  let imagesUpdated = 0;

  for (const row of rows) {
    const content = row.contentJson && typeof row.contentJson === "object"
      ? JSON.parse(JSON.stringify(row.contentJson))
      : null;
    const oak = content?.oak;
    if (!oak || typeof oak !== "object") continue;

    let touched = false;
    let imageIndex = 1;
    const nextBase = () => `${row.id}-local-${imageIndex++}`;

    if (await localiseImageObject(oak.questionImage, nextBase(), cache)) {
      touched = true;
      imagesUpdated += 1;
    }

    if (Array.isArray(oak.stimulusImages)) {
      for (const image of oak.stimulusImages) {
        if (await localiseImageObject(image, nextBase(), cache)) {
          touched = true;
          imagesUpdated += 1;
        }
      }
    }

    for (const collectionName of ["choices", "rawAnswers"] as const) {
      const collection = oak[collectionName];
      if (!Array.isArray(collection)) continue;
      for (const item of collection) {
        if (await localiseImageObject(item?.image, nextBase(), cache)) {
          touched = true;
          imagesUpdated += 1;
        }
        if (item?.content && typeof item.content === "object") {
          if (await localiseImageObject(item.content, nextBase(), cache)) {
            touched = true;
            imagesUpdated += 1;
          }
        }
      }
    }

    if (touched) {
      await prisma.canonicalQuestion.update({
        where: { id: row.id },
        data: { contentJson: content },
      });
      rowsUpdated += 1;
    }
  }

  console.log(JSON.stringify({ rowsUpdated, imagesUpdated, uniqueDownloads: cache.size }, null, 2));
  await prisma.$disconnect();
}

void main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
