import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { prisma } from "../src/lib/prisma.js";

type ImageMeta = {
  url: string;
  width?: number;
  height?: number;
  alt: string;
};

const OUT_DIR = path.resolve(process.cwd(), "web/public/oak-stimuli/science");
const PUBLIC_PREFIX = "/oak-stimuli/science";

function isVisualDependentPrompt(promptText: string): boolean {
  return /\b(this|the|following|below)\s+(graph|diagram|image|picture|chart|table|map|photo|photograph|model|drawing|illustration|food chains?)\b|\b(graph|diagram|image|picture|chart|table|map|photo|photograph|model|drawing|illustration|food chains?)\s+(below|above)\b|\blook at (this|the)\s+(graph|diagram|image|picture|chart|table|map|photo|photograph|model|drawing|illustration|food chains?)\b|\bcompare\s+(these|the)\s+food chains?\b/i.test(
    promptText,
  );
}

function hasBackfilledStimulus(contentJson: any): boolean {
  const oak = contentJson?.oak ?? {};
  const choices = Array.isArray(oak.choices) ? oak.choices : [];
  const rawAnswers = Array.isArray(oak.rawAnswers) ? oak.rawAnswers : [];

  return Boolean(
    oak.questionImage?.url ||
      contentJson?.questionImage?.url ||
      (Array.isArray(oak.stimulusImages) && oak.stimulusImages.length > 0) ||
      choices.some((choice: any) => choice?.image?.url) ||
      rawAnswers.some((answer: any) => answer?.image?.url),
  );
}

function programmeSlug(keyStage: string | null | undefined) {
  const ks = String(keyStage ?? "").toLowerCase();
  return ks === "ks3" || ks === "ks4"
    ? `science-secondary-${ks}`
    : `science-primary-${ks || "ks2"}`;
}

function lessonUrl(keyStage: string, unitSlug: string, lessonSlug: string) {
  return `https://www.thenational.academy/teachers/programmes/${programmeSlug(
    keyStage,
  )}/units/${unitSlug}/lessons/${lessonSlug}`;
}

function decodeHtml(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&nbsp;/g, " ")
    .replace(/<!-- -->/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function stripTags(value: string) {
  return decodeHtml(value.replace(/<[^>]*>/g, " "));
}

function attr(tag: string, name: string) {
  const match = tag.match(new RegExp(`${name}=["']([^"']+)["']`, "i"));
  return match ? decodeHtml(match[1] ?? "") : "";
}

function sourceUrlFromImageTag(tag: string): string | null {
  const candidates = [attr(tag, "srcSet"), attr(tag, "src")].filter(Boolean);

  for (const raw of candidates) {
    const parts = raw.split(",").map((part) => part.trim().split(/\s+/)[0]).filter(Boolean);
    for (const part of parts.reverse()) {
      const decoded = decodeHtml(part ?? "");
      const url = decoded.startsWith("http")
        ? decoded
        : decoded.startsWith("/_next/image")
          ? `https://www.thenational.academy${decoded}`
          : "";
      if (!url) continue;

      const parsed = new URL(url);
      const nested = parsed.searchParams.get("url");
      return nested ? decodeURIComponent(nested) : url;
    }
  }

  return null;
}

function isContentImage(url: string) {
  return (
    url.includes("oaknationalacademy-res.cloudinary.com/image/upload/") &&
    !url.includes("/icons/") &&
    !url.endsWith(".svg")
  );
}

function findPromptIndex(html: string, promptText: string) {
  const plain = promptText.trim();
  const candidates = [
    plain,
    plain.replace(/'/g, "&#x27;"),
    plain.replace(/’/g, "&#x27;"),
    plain.replace(/½/g, "1½"),
  ];

  for (const candidate of candidates) {
    const index = html.indexOf(candidate);
    if (index >= 0) return index;
  }

  const compactPrompt = stripTags(plain).toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
  const roughIndex = html.toLowerCase().indexOf(compactPrompt.slice(0, 48));
  return roughIndex >= 0 ? roughIndex : -1;
}

function extractQuestionSegment(html: string, promptText: string) {
  const index = findPromptIndex(html, promptText);
  if (index < 0) return "";

  const rest = html.slice(index + promptText.length);
  const nextQuestion = rest.search(/<span[^>]*>\s*Q\d+\.\s*<\/span>/i);
  const end = nextQuestion > 250 ? index + promptText.length + nextQuestion : index + 9000;
  return html.slice(index, end);
}

function extractImages(segment: string): ImageMeta[] {
  const out: ImageMeta[] = [];
  const seen = new Set<string>();

  for (const match of segment.matchAll(/<img\b[^>]*>/gi)) {
    const tag = match[0];
    const url = sourceUrlFromImageTag(tag);
    if (!url || !isContentImage(url) || seen.has(url)) continue;
    seen.add(url);

    const width = Number(attr(tag, "width"));
    const height = Number(attr(tag, "height"));
    const alt = attr(tag, "alt") || "Science question image";
    out.push({
      url,
      width: Number.isFinite(width) ? width : undefined,
      height: Number.isFinite(height) ? height : undefined,
      alt,
    });
  }

  return out;
}

function extensionFromResponse(url: string, contentType: string | null) {
  const ext = path.extname(new URL(url).pathname).toLowerCase();
  if ([".png", ".jpg", ".jpeg", ".webp"].includes(ext)) return ext;
  if (contentType?.includes("webp")) return ".webp";
  if (contentType?.includes("jpeg")) return ".jpg";
  return ".png";
}

async function downloadImage(questionId: string, index: number, image: ImageMeta): Promise<ImageMeta> {
  const response = await fetch(image.url);
  if (!response.ok) {
    throw new Error(`Image download failed ${response.status}: ${image.url}`);
  }

  const buffer = Buffer.from(await response.arrayBuffer());
  const ext = extensionFromResponse(image.url, response.headers.get("content-type"));
  const filename = `${questionId}-${index + 1}${ext}`;
  await writeFile(path.join(OUT_DIR, filename), buffer);

  return {
    ...image,
    url: `${PUBLIC_PREFIX}/${filename}`,
  };
}

function attachImages(contentJson: any, images: ImageMeta[]) {
  const content = contentJson && typeof contentJson === "object" ? { ...contentJson } : {};
  const oak = content.oak && typeof content.oak === "object" ? { ...content.oak } : {};
  const choices = Array.isArray(oak.choices) ? oak.choices.map((choice: any) => ({ ...choice })) : [];
  const rawAnswers = Array.isArray(oak.rawAnswers)
    ? oak.rawAnswers.map((answer: any) => ({ ...answer }))
    : [];

  if (images.length === 1) {
    oak.questionImage = images[0];
  } else if (images.length > 1 && choices.length === images.length) {
    oak.choices = choices.map((choice: any, index: number) => ({
      ...choice,
      image: images[index],
    }));
    oak.rawAnswers = rawAnswers.map((answer: any, index: number) => ({
      ...answer,
      image: images[index],
    }));
  } else if (images.length > 1) {
    oak.stimulusImages = images;
  }

  content.oak = oak;
  return content;
}

async function main() {
  await mkdir(OUT_DIR, { recursive: true });

  const rows = await prisma.canonicalQuestion.findMany({
    where: {
      status: "ACTIVE",
      objective: { subject: "SCIENCE" },
    },
    select: {
      id: true,
      promptText: true,
      contentJson: true,
      objective: {
        select: {
          keyStage: true,
        },
      },
    },
  });

  const targets = rows.filter(
    (row) => isVisualDependentPrompt(row.promptText) && !hasBackfilledStimulus(row.contentJson),
  );

  const htmlByLesson = new Map<string, string>();
  const results = {
    targets: targets.length,
    updated: 0,
    notFound: [] as Array<{ id: string; promptText: string }>,
    noImages: [] as Array<{ id: string; promptText: string }>,
  };

  for (const row of targets) {
    const oak = (row.contentJson as any)?.oak ?? {};
    const unitSlug = String(oak.unitSlug ?? "");
    const lessonSlug = String(oak.lessonSlug ?? "");
    const keyStage = String(row.objective.keyStage ?? "");
    if (!unitSlug || !lessonSlug || !keyStage) {
      results.notFound.push({ id: row.id, promptText: row.promptText });
      continue;
    }

    const url = lessonUrl(keyStage, unitSlug, lessonSlug);
    if (!htmlByLesson.has(url)) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Failed to fetch ${url}: ${response.status}`);
      htmlByLesson.set(url, await response.text());
    }

    const segment = extractQuestionSegment(htmlByLesson.get(url)!, row.promptText);
    if (!segment) {
      results.notFound.push({ id: row.id, promptText: row.promptText });
      continue;
    }

    const remoteImages = extractImages(segment);
    if (!remoteImages.length) {
      results.noImages.push({ id: row.id, promptText: row.promptText });
      continue;
    }

    const localImages: ImageMeta[] = [];
    for (let index = 0; index < remoteImages.length; index += 1) {
      localImages.push(await downloadImage(row.id, index, remoteImages[index]!));
    }

    await prisma.canonicalQuestion.update({
      where: { id: row.id },
      data: {
        contentJson: attachImages(row.contentJson, localImages),
      },
    });
    results.updated += 1;
  }

  console.log(JSON.stringify(results, null, 2));
  await prisma.$disconnect();
}

void main().catch(async (error) => {
  console.error(error);
  await prisma.$disconnect();
  process.exit(1);
});
