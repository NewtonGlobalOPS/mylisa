import { createHash, randomBytes } from "node:crypto";
import { createWriteStream } from "node:fs";
import { mkdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import PDFDocument from "pdfkit";
import { StorageProvider, Subject } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { buildCombinedChildProfile } from "./childProfile.service.js";

type CombinedChildProfile = Awaited<ReturnType<typeof buildCombinedChildProfile>>;
type LearningReportLesson = CombinedChildProfile["learningReport"]["lessons"][number];

type ReportNarrative = NonNullable<NonNullable<CombinedChildProfile["assessment"]>["report"]>;

const REPORT_ROOT = path.resolve(process.cwd(), "exports");

function cleanFilenamePart(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function formatDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${Math.round(value * 100)}%`;
}

function completedReportLessons(lessons: LearningReportLesson[]) {
  return lessons.filter((lesson) => lesson.endedAt || lesson.status === "COMPLETED");
}

function summariseReportLessons(lessons: LearningReportLesson[]) {
  const questionsAnswered = lessons.reduce((sum, lesson) => sum + lesson.questionsAnswered, 0);
  const questionsCorrect = lessons.reduce((sum, lesson) => sum + lesson.questionsCorrect, 0);
  return {
    lessonCount: lessons.length,
    completedLessonCount: lessons.length,
    questionsAnswered,
    questionsCorrect,
    accuracy: questionsAnswered ? Number((questionsCorrect / questionsAnswered).toFixed(3)) : null,
  };
}

function fallbackBandLabel(profile: CombinedChildProfile) {
  const entryYear = profile.assessment?.entryYear ?? profile.child.schoolYear ?? 1;

  switch (profile.assessment?.overallWorkingBand) {
    case "BELOW_ENTRY":
      return `Developing towards Year ${entryYear}`;
    case "ENTRY_SECURE":
      return `Secure in Year ${entryYear}`;
    case "ENTRY_SECURE_NEXT_EMERGING":
      return `Secure in Year ${entryYear} and beginning Year ${entryYear + 1}`;
    case "NEXT_DEVELOPING":
      return `Developing into Year ${entryYear + 1}`;
    case "NEXT_SECURE":
      return `Secure in Year ${entryYear + 1}`;
    default:
      return `Building Year ${entryYear} security`;
  }
}

function fallbackNarrative(profile: CombinedChildProfile): ReportNarrative {
  const strands = profile.assessment?.strands ?? [];
  const strongest = [...strands].sort((a, b) => b.accuracy - a.accuracy).slice(0, 2);
  const focus = [...strands].sort((a, b) => a.accuracy - b.accuracy).slice(0, 2);
  const subjectLabel = profile.assessment?.subject === Subject.SCIENCE ? "science" : "maths";

  return {
    displayBandLabel: fallbackBandLabel(profile),
    displayBandSummary: `The assessment provides a working picture of ${profile.child.displayName}'s current ${subjectLabel} profile.`,
    parentNarrative:
      "This report summarises the assessment evidence and highlights where teaching should begin next.",
    tutorNarrative:
      "Planning should start from the least secure strands while maintaining confidence in the strongest areas.",
    whatThisMeans:
      "This outcome is a teaching starting point. It combines accuracy, consistency, and strand coverage.",
    strengths: strongest.length
      ? strongest.map((strand) => `${strand.strand} was a relative strength with ${formatPercent(strand.accuracy)} accuracy.`)
      : ["The assessment captured enough evidence to shape a focused learning plan."],
    focusAreas: focus.length
      ? focus.map((strand) => `${strand.strand} should be prioritised next, with ${formatPercent(strand.accuracy)} accuracy so far.`)
      : ["Continue consolidating the current year-group foundations."],
    nextSteps: [
      "Teach from the current working level and secure consistency before accelerating.",
      "Use short, frequent checks on the least secure strands.",
      "Balance consolidation with confidence-building practice in the strongest strands.",
    ],
    tutorActions: [
      "Plan the next lesson sequence around the least secure strands first.",
      "Review common errors explicitly and ask the learner to explain the method back.",
      "Recheck secure understanding before moving fully into extension material.",
    ],
    confidenceNote: `Confidence in this assessment picture is ${formatPercent(profile.assessment?.overallConfidence)}.`,
  };
}

function pageLeft(doc: PDFKit.PDFDocument) {
  return doc.page.margins.left;
}

function pageRight(doc: PDFKit.PDFDocument) {
  return doc.page.width - doc.page.margins.right;
}

function pageBottom(doc: PDFKit.PDFDocument) {
  return doc.page.height - doc.page.margins.bottom - 18;
}

function contentWidth(doc: PDFKit.PDFDocument) {
  return pageRight(doc) - pageLeft(doc);
}

function resetFlow(doc: PDFKit.PDFDocument) {
  doc.x = pageLeft(doc);
}

function ensureRoom(doc: PDFKit.PDFDocument, neededHeight: number) {
  if (doc.y + neededHeight > pageBottom(doc)) {
    doc.addPage();
    resetFlow(doc);
  } else {
    resetFlow(doc);
  }
}

function sectionHeading(doc: PDFKit.PDFDocument, text: string) {
  ensureRoom(doc, 34);
  doc.y += 10;
  doc
    .font("Helvetica-Bold")
    .fontSize(10)
    .fillColor("#214f7a")
    .text(text.toUpperCase(), pageLeft(doc), doc.y, {
      width: contentWidth(doc),
      lineGap: 0,
    });
  doc
    .moveTo(pageLeft(doc), doc.y + 4)
    .lineTo(pageRight(doc), doc.y + 4)
    .strokeColor("#dbe4ee")
    .lineWidth(1)
    .stroke();
  doc.y += 12;
}

function paragraph(doc: PDFKit.PDFDocument, text: string | null | undefined) {
  const value = (text ?? "").trim();
  if (!value) return;
  doc.font("Helvetica").fontSize(10);
  const height = doc.heightOfString(value, {
    width: contentWidth(doc),
    lineGap: 2,
  });
  ensureRoom(doc, height + 8);
  doc.fillColor("#17293c").text(value, pageLeft(doc), doc.y, {
    width: contentWidth(doc),
    lineGap: 2,
  });
  doc.y += 6;
}

function cardHeight(
  doc: PDFKit.PDFDocument,
  card: { eyebrow?: string; title?: string; body: string[]; code?: string }
) {
  const width = contentWidth(doc) - 24;
  let height = 18;
  if (card.eyebrow) {
    doc.font("Helvetica-Bold").fontSize(8);
    height += doc.heightOfString(card.eyebrow, { width }) + 5;
  }
  if (card.title) {
    doc.font("Helvetica-Bold").fontSize(10);
    height += doc.heightOfString(card.title, { width, lineGap: 1 }) + 6;
  }
  doc.font("Helvetica").fontSize(9.5);
  for (const item of card.body.filter(Boolean)) {
    height += doc.heightOfString(item, { width, lineGap: 2 }) + 5;
  }
  if (card.code) {
    doc.font("Helvetica").fontSize(7.5);
    height += doc.heightOfString(card.code, { width }) + 4;
  }
  return Math.max(48, height);
}

function reportCard(
  doc: PDFKit.PDFDocument,
  card: { eyebrow?: string; title?: string; body: string[]; code?: string }
) {
  const height = cardHeight(doc, card);
  ensureRoom(doc, height + 8);

  const x = pageLeft(doc);
  const y = doc.y;
  const width = contentWidth(doc);
  doc.roundedRect(x, y, width, height, 4).fillAndStroke("#ffffff", "#dbe4ee");
  doc.rect(x, y, 4, height).fill("#2f6ca4");

  let cursorY = y + 10;
  const textX = x + 12;
  const textWidth = width - 24;

  if (card.eyebrow) {
    doc
      .font("Helvetica-Bold")
      .fontSize(8)
      .fillColor("#214f7a")
      .text(card.eyebrow.toUpperCase(), textX, cursorY, { width: textWidth });
    cursorY = doc.y + 4;
  }

  if (card.title) {
    doc
      .font("Helvetica-Bold")
      .fontSize(10)
      .fillColor("#17293c")
      .text(card.title, textX, cursorY, { width: textWidth, lineGap: 1 });
    cursorY = doc.y + 5;
  }

  for (const item of card.body.filter(Boolean)) {
    doc
      .font("Helvetica")
      .fontSize(9.5)
      .fillColor("#17293c")
      .text(item, textX, cursorY, { width: textWidth, lineGap: 2 });
    cursorY = doc.y + 5;
  }

  if (card.code) {
    doc
      .font("Helvetica")
      .fontSize(7.5)
      .fillColor("#6d7f92")
      .text(card.code, textX, cursorY, { width: textWidth });
  }

  doc.y = y + height + 8;
}

function cardList(doc: PDFKit.PDFDocument, items: string[]) {
  for (const item of items.filter(Boolean)) {
    reportCard(doc, { body: [item] });
  }
}

function metaLine(
  doc: PDFKit.PDFDocument,
  x: number,
  y: number,
  width: number,
  label: string,
  value: string
) {
  doc.font("Helvetica-Bold").fontSize(9).fillColor("#40536a").text(`${label}:`, x, y, {
    continued: true,
    width,
  });
  doc.font("Helvetica").fontSize(9).fillColor("#40536a").text(` ${value}`, {
    width,
  });
}

function strandComment(strand: NonNullable<CombinedChildProfile["assessment"]>["strands"][number]) {
  if (strand.secureYear != null) {
    return `Secure at Year ${strand.secureYear} with ${formatPercent(strand.accuracy)} accuracy.`;
  }
  if (strand.emergingYear != null) {
    return `Emerging at Year ${strand.emergingYear} with ${formatPercent(strand.accuracy)} accuracy.`;
  }
  return `Still consolidating with ${formatPercent(strand.accuracy)} accuracy so far.`;
}

function shortObjectiveCode(code: string) {
  const parts = code.split(":").filter(Boolean);
  if (parts.length >= 4) {
    const subject = parts[1]?.toUpperCase();
    const keyStage = parts[2]?.toUpperCase();
    const slug = parts[3]
      ?.split("-")
      .filter(Boolean)
      .slice(0, 3)
      .join(" ");
    return [subject, keyStage, slug].filter(Boolean).join(" / ");
  }

  return code.length > 42 ? `${code.slice(0, 39)}...` : code;
}

function renderPdf(doc: PDFKit.PDFDocument, profile: CombinedChildProfile, generatedAt: Date) {
  const subjectTitle = profile.assessment?.subject === Subject.SCIENCE ? "Science" : "Maths";
  const subjectLabel = profile.assessment?.subject === Subject.SCIENCE ? "science" : "maths";
  const report = profile.assessment?.report ?? fallbackNarrative(profile);
  const assessment = profile.assessment;
  const name = profile.child.displayName || "Student";
  const recommendedObjectives = profile.recommendations.objectives.slice(0, 3);
  const reportObjectives = profile.learningReport.objectives.slice(0, 8);
  const lessonProgress = completedReportLessons(profile.learningReport.lessons);
  const progress = summariseReportLessons(lessonProgress);
  const interventions = (profile.recommendations.course.interventions ?? []).slice(0, 3);

  doc
    .font("Helvetica-Bold")
    .fontSize(22)
    .fillColor("#102235")
    .text(`${subjectTitle} assessment report`, pageLeft(doc), doc.y, {
      width: contentWidth(doc),
    });
  doc.y += 4;
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#607086")
    .text("The Newton Centre / MyLisa", pageLeft(doc), doc.y, {
      width: contentWidth(doc),
    });
  doc.y += 14;

  const metaTop = doc.y;
  const metaLeft = doc.page.margins.left;
  const metaWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;
  doc.roundedRect(metaLeft, metaTop, metaWidth, 86, 4).strokeColor("#dbe4ee").lineWidth(1).stroke();
  const columnWidth = metaWidth / 2 - 18;
  metaLine(doc, metaLeft + 12, metaTop + 10, columnWidth, "Student", name);
  metaLine(doc, metaLeft + 12, metaTop + 28, columnWidth, "Age", String(profile.child.age ?? "-"));
  metaLine(
    doc,
    metaLeft + 12,
    metaTop + 46,
    columnWidth,
    "School year",
    profile.child.schoolYear != null ? `Year ${profile.child.schoolYear}` : "-"
  );
  metaLine(doc, metaLeft + 12, metaTop + 64, columnWidth, "Generated", formatDate(generatedAt.toISOString()));
  metaLine(doc, metaLeft + metaWidth / 2, metaTop + 10, columnWidth, "Subject", subjectTitle);
  metaLine(
    doc,
    metaLeft + metaWidth / 2,
    metaTop + 28,
    columnWidth,
    "Assessment session",
    assessment?.sessionId ?? "-"
  );
  metaLine(
    doc,
    metaLeft + metaWidth / 2,
    metaTop + 46,
    columnWidth,
    "Questions answered",
    String(assessment?.questionCount ?? 0)
  );
  metaLine(
    doc,
    metaLeft + metaWidth / 2,
    metaTop + 64,
    columnWidth,
    "Confidence",
    formatPercent(assessment?.overallConfidence)
  );
  doc.y = metaTop + 100;
  resetFlow(doc);

  sectionHeading(doc, "Overall outcome");
  paragraph(
    doc,
    `The assessment places ${name} at ${report.displayBandLabel} with an overall confidence level of ${formatPercent(assessment?.overallConfidence)}.`
  );
  paragraph(doc, report.displayBandSummary);
  paragraph(doc, report.parentNarrative);
  paragraph(doc, report.confidenceNote);

  sectionHeading(doc, "What this means");
  paragraph(doc, report.whatThisMeans.replace("maths strands", `${subjectLabel} strands`));
  paragraph(doc, report.tutorNarrative);

  sectionHeading(doc, "Strand overview");
  for (const strand of assessment?.strands ?? []) {
    reportCard(doc, {
      title: strand.strand,
      body: [strandComment(strand)],
    });
  }

  sectionHeading(doc, "Strengths to build on");
  cardList(doc, report.strengths);

  sectionHeading(doc, "Priority focus areas");
  cardList(doc, report.focusAreas);

  sectionHeading(doc, "Recommended next steps");
  cardList(doc, report.nextSteps);
  for (const objective of recommendedObjectives) {
    reportCard(doc, {
      title: objective.title,
      body: [
        `${objective.yearGroup != null ? `Year ${objective.yearGroup}. ` : ""}${objective.reason}`,
      ],
    });
  }

  sectionHeading(doc, "Course and objectives set");
  paragraph(
    doc,
    `${profile.learningReport.course.title} (${profile.learningReport.course.status.toLowerCase().replaceAll("_", " ")}).`
  );
  for (const objective of reportObjectives) {
    reportCard(doc, {
      eyebrow: `${objective.sequence ? `${objective.sequence}. ` : ""}${shortObjectiveCode(objective.code)}`,
      title: objective.title,
      body: [
        `${objective.yearGroup != null ? `Year ${objective.yearGroup}. ` : ""}${objective.strand ? `${objective.strand}. ` : ""}`.trim(),
        objective.reason,
      ],
      code: objective.code,
    });
  }

  sectionHeading(doc, "Lesson progress");
  paragraph(
    doc,
    `${progress.lessonCount} completed lessons recorded. ${
      progress.questionsAnswered
        ? `${progress.questionsCorrect}/${progress.questionsAnswered} lesson questions correct overall.`
        : "No lesson question responses have been recorded yet."
    }`
  );
  if (lessonProgress.length) {
    for (const lesson of lessonProgress) {
      reportCard(doc, {
        title: lesson.title,
        body: [
          `${lesson.objective.code}: ${lesson.objective.title}`,
          lesson.progressLabel,
        ],
      });
    }
  } else {
    reportCard(doc, {
      body: [
        "No completed lessons have been recorded yet. Progress will be added here once lesson sessions are completed.",
      ],
    });
  }

  sectionHeading(doc, "Tutor planning notes");
  cardList(doc, report.tutorActions);
  for (const item of interventions) {
    reportCard(doc, {
      title: item.label,
      body: [item.reason],
    });
  }

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const footerY = doc.page.height - doc.page.margins.bottom - 10;
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#6d7f92")
      .text(
        `Generated ${formatDate(generatedAt.toISOString())} | Page ${index + 1} of ${range.count}`,
        doc.page.margins.left,
        footerY,
        {
          align: "center",
          lineBreak: false,
          width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
        }
      );
  }
}

async function writeReportPdf(profile: CombinedChildProfile, outputPath: string, generatedAt: Date) {
  await mkdir(path.dirname(outputPath), { recursive: true });

  const doc = new PDFDocument({
    size: "A4",
    margin: 48,
    bufferPages: true,
    info: {
      Title: `${profile.assessment?.subject ?? Subject.MATHS} assessment report`,
      Author: "MyLisa",
      Subject: "Learner assessment report",
      CreationDate: generatedAt,
    },
  });
  const stream = createWriteStream(outputPath);
  doc.pipe(stream);
  renderPdf(doc, profile, generatedAt);
  doc.end();

  await new Promise<void>((resolve, reject) => {
    stream.on("finish", resolve);
    stream.on("error", reject);
  });
}

export async function createStoredReport(params: {
  studentId: string;
  subject?: Subject;
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
}) {
  const profile = await buildCombinedChildProfile(params);
  if (!profile.assessment) {
    throw new Error("A completed assessment profile is required before a report can be generated.");
  }

  const student = await prisma.student.findUnique({
    where: { id: profile.child.id },
    select: { organisationId: true },
  });
  if (!student) throw new Error("Student not found.");

  const generatedAt = new Date();
  const subject = profile.assessment.subject;
  const subjectPart = cleanFilenamePart(subject.toLowerCase());
  const namePart = cleanFilenamePart(profile.child.displayName || "student");
  const datePart = generatedAt.toISOString().slice(0, 10);
  const filename = `${namePart}-${subjectPart}-report-${datePart}.pdf`;
  const storageKey = `reports/${profile.child.id}/${profile.assessment.sessionId}-${generatedAt.getTime()}.pdf`;
  const outputPath = path.join(REPORT_ROOT, storageKey);

  await writeReportPdf(profile, outputPath, generatedAt);

  const [fileStat, fileBuffer] = await Promise.all([stat(outputPath), readFile(outputPath)]);
  const checksumSha256 = createHash("sha256").update(fileBuffer).digest("hex");
  const publicToken = randomBytes(32).toString("base64url");
  const title = `${subject === Subject.SCIENCE ? "Science" : "Maths"} assessment report`;

  const report = await prisma.storedReport.create({
    data: {
      organisationId: student.organisationId,
      studentId: profile.child.id,
      attemptId: profile.assessment.sessionId,
      subject,
      title,
      storage: StorageProvider.LOCAL,
      storageKey,
      filename,
      mimeType: "application/pdf",
      sizeBytes: BigInt(fileStat.size),
      checksumSha256,
      publicToken,
      generatedAt,
    },
  });

  return {
    id: report.id,
    title: report.title,
    filename: report.filename,
    mimeType: report.mimeType,
    sizeBytes: Number(report.sizeBytes),
    generatedAt: report.generatedAt.toISOString(),
    downloadUrl: `/api/reports/${report.id}/pdf`,
    parentViewUrl: `/public/reports/${report.publicToken}/pdf`,
  };
}

export async function createAssessmentReportPdf(params: {
  studentId: string;
  subject?: Subject;
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
}) {
  const profile = await buildCombinedChildProfile(params);
  if (!profile.assessment) {
    throw new Error("A completed assessment profile is required before a report can be generated.");
  }

  const generatedAt = new Date();
  const subject = profile.assessment.subject;
  const subjectPart = cleanFilenamePart(subject.toLowerCase());
  const namePart = cleanFilenamePart(profile.child.displayName || "student");
  const datePart = generatedAt.toISOString().slice(0, 10);
  const filename = `${namePart}-${subjectPart}-assessment-report-${datePart}.pdf`;

  const doc = new PDFDocument({
    size: "A4",
    margin: 48,
    bufferPages: true,
    info: {
      Title: `${subject} assessment report`,
      Author: "MyLisa",
      Subject: "Learner assessment report",
      CreationDate: generatedAt,
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  renderPdf(doc, profile, generatedAt);
  doc.end();

  await new Promise<void>((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  return {
    filename,
    mimeType: "application/pdf",
    buffer: Buffer.concat(chunks),
  };
}

export async function listStoredReports(params: {
  studentId: string;
  subject?: Subject;
}) {
  const reports = await prisma.storedReport.findMany({
    where: {
      studentId: params.studentId,
      ...(params.subject ? { subject: params.subject } : {}),
    },
    orderBy: { generatedAt: "desc" },
    take: 25,
  });

  return reports.map((report) => ({
    id: report.id,
    title: report.title,
    filename: report.filename,
    mimeType: report.mimeType,
    sizeBytes: Number(report.sizeBytes),
    generatedAt: report.generatedAt.toISOString(),
    downloadUrl: `/api/reports/${report.id}/pdf`,
    parentViewUrl: `/public/reports/${report.publicToken}/pdf`,
  }));
}

export async function getStoredReportFileById(reportId: string) {
  const report = await prisma.storedReport.findUnique({
    where: { id: reportId },
  });
  if (!report) return null;

  return {
    report,
    filePath: path.join(REPORT_ROOT, report.storageKey),
  };
}

export async function getStoredReportFileByPublicToken(publicToken: string) {
  const report = await prisma.storedReport.findUnique({
    where: { publicToken },
  });
  if (!report) return null;

  return {
    report,
    filePath: path.join(REPORT_ROOT, report.storageKey),
  };
}

function formatDateTime(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function progressWindowSummary(window: {
  lessonCount: number;
  completedLessonCount: number;
  questionsAnswered: number;
  questionsCorrect: number;
  accuracy: number | null;
}) {
  return [
    `${window.lessonCount} lesson${window.lessonCount === 1 ? "" : "s"}`,
    `${window.completedLessonCount} completed`,
    window.questionsAnswered
      ? `${window.questionsCorrect}/${window.questionsAnswered} questions correct (${formatPercent(window.accuracy)})`
      : "No questions answered",
  ].join(". ");
}

function progressNarrative(
  profile: CombinedChildProfile,
  lessons: LearningReportLesson[],
  progress: ReturnType<typeof summariseReportLessons>,
) {
  const latest = lessons[0] ?? null;
  if (!latest) {
    return `${profile.child.displayName} does not yet have completed lesson progress in MyLisa.`;
  }

  return [
    `${profile.child.displayName}'s latest completed lesson is "${latest.title}".`,
    latest.progressLabel,
    progress.questionsAnswered
      ? `Across completed lesson sessions, ${profile.child.displayName} has answered ${progress.questionsAnswered} questions with ${progress.questionsCorrect} correct (${formatPercent(progress.accuracy)}).`
      : "No lesson question responses have been recorded yet.",
  ].join(" ");
}

function renderProgressPdf(doc: PDFKit.PDFDocument, profile: CombinedChildProfile, generatedAt: Date) {
  const name = profile.child.displayName || "Student";
  const subjectTitle = profile.assessment?.subject === Subject.SCIENCE ? "Science" : "Maths";
  const lessons = completedReportLessons(profile.learningReport.lessons);
  const progress = summariseReportLessons(lessons);
  const latest = lessons[0] ?? null;
  const today = lessons.filter((lesson) => {
    const activity = new Date(lesson.endedAt ?? lesson.lastActiveAt ?? lesson.updatedAt);
    const start = new Date(Date.UTC(generatedAt.getUTCFullYear(), generatedAt.getUTCMonth(), generatedAt.getUTCDate()));
    return activity >= start;
  });
  const weekStart = new Date(generatedAt.getTime() - 7 * 24 * 60 * 60 * 1000);
  const monthStart = new Date(generatedAt.getTime() - 30 * 24 * 60 * 60 * 1000);
  const week = lessons.filter((lesson) => new Date(lesson.endedAt ?? lesson.lastActiveAt ?? lesson.updatedAt) >= weekStart);
  const month = lessons.filter((lesson) => new Date(lesson.endedAt ?? lesson.lastActiveAt ?? lesson.updatedAt) >= monthStart);

  doc
    .font("Helvetica-Bold")
    .fontSize(22)
    .fillColor("#102235")
    .text("Lesson progress report", pageLeft(doc), doc.y, { width: contentWidth(doc) });
  doc.y += 4;
  doc
    .font("Helvetica")
    .fontSize(10)
    .fillColor("#607086")
    .text("The Newton Centre / MyLisa", pageLeft(doc), doc.y, { width: contentWidth(doc) });
  doc.y += 14;

  const metaTop = doc.y;
  const metaLeft = pageLeft(doc);
  const metaWidth = contentWidth(doc);
  doc.roundedRect(metaLeft, metaTop, metaWidth, 86, 4).strokeColor("#dbe4ee").lineWidth(1).stroke();
  const columnWidth = metaWidth / 2 - 18;
  metaLine(doc, metaLeft + 12, metaTop + 10, columnWidth, "Student", name);
  metaLine(doc, metaLeft + 12, metaTop + 28, columnWidth, "Age", String(profile.child.age ?? "-"));
  metaLine(
    doc,
    metaLeft + 12,
    metaTop + 46,
    columnWidth,
    "School year",
    profile.child.schoolYear != null ? `Year ${profile.child.schoolYear}` : "-"
  );
  metaLine(doc, metaLeft + 12, metaTop + 64, columnWidth, "Generated", formatDateTime(generatedAt.toISOString()));
  metaLine(doc, metaLeft + metaWidth / 2, metaTop + 10, columnWidth, "Subject", subjectTitle);
  metaLine(doc, metaLeft + metaWidth / 2, metaTop + 28, columnWidth, "Completed lessons", String(progress.lessonCount));
  metaLine(doc, metaLeft + metaWidth / 2, metaTop + 46, columnWidth, "Completed", String(progress.completedLessonCount));
  metaLine(doc, metaLeft + metaWidth / 2, metaTop + 64, columnWidth, "Overall accuracy", formatPercent(progress.accuracy));
  doc.y = metaTop + 100;
  resetFlow(doc);

  sectionHeading(doc, "Parent summary");
  paragraph(doc, progressNarrative(profile, lessons, progress));

  sectionHeading(doc, "Latest lesson");
  if (latest) {
    reportCard(doc, {
      eyebrow: latest.status,
      title: latest.title,
      body: [
        latest.objective.title,
        latest.progressLabel,
        `Last activity: ${formatDateTime(latest.lastActiveAt ?? latest.endedAt ?? latest.updatedAt)}.`,
      ],
      code: latest.objective.code,
    });
  } else {
    reportCard(doc, { body: ["No completed lesson sessions are currently visible for this learner."] });
  }

  sectionHeading(doc, "Progress windows");
  reportCard(doc, { title: "Today", body: [progressWindowSummary(summariseReportLessons(today))] });
  reportCard(doc, { title: "Last 7 days", body: [progressWindowSummary(summariseReportLessons(week))] });
  reportCard(doc, { title: "Last 30 days", body: [progressWindowSummary(summariseReportLessons(month))] });

  sectionHeading(doc, "Lesson detail");
  if (lessons.length) {
    for (const lesson of lessons) {
      reportCard(doc, {
        eyebrow: `${lesson.status} / ${formatDateTime(lesson.lastActiveAt ?? lesson.endedAt ?? lesson.updatedAt)}`,
        title: lesson.title,
        body: [
          `Objective: ${lesson.objective.title}`,
          lesson.progressLabel,
          lesson.accuracy != null ? `Lesson accuracy: ${formatPercent(lesson.accuracy)}.` : "Lesson accuracy is not available yet.",
        ],
        code: lesson.objective.code,
      });
    }
  } else {
    reportCard(doc, { body: ["Lesson detail will appear once sessions are completed."] });
  }

  sectionHeading(doc, "Current learning focus");
  for (const objective of profile.learningReport.objectives.slice(0, 6)) {
    reportCard(doc, {
      eyebrow: objective.status,
      title: objective.title,
      body: [
        `${objective.yearGroup != null ? `Year ${objective.yearGroup}. ` : ""}${objective.strand}.`,
        objective.reason,
      ],
      code: objective.code,
    });
  }

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index += 1) {
    doc.switchToPage(index);
    const footerY = doc.page.height - doc.page.margins.bottom - 10;
    doc
      .font("Helvetica")
      .fontSize(8)
      .fillColor("#6d7f92")
      .text(`Generated ${formatDate(generatedAt.toISOString())} | Page ${index + 1} of ${range.count}`, doc.page.margins.left, footerY, {
        align: "center",
        lineBreak: false,
        width: doc.page.width - doc.page.margins.left - doc.page.margins.right,
      });
  }
}

export async function createProgressReportPdf(params: {
  studentId: string;
  subject?: Subject;
}) {
  const profile = await buildCombinedChildProfile(params);
  const generatedAt = new Date();
  const namePart = cleanFilenamePart(profile.child.displayName || "student");
  const datePart = generatedAt.toISOString().slice(0, 10);
  const filename = `${namePart}-progress-report-${datePart}.pdf`;

  const doc = new PDFDocument({
    size: "A4",
    margin: 48,
    bufferPages: true,
    info: {
      Title: `${profile.child.displayName} progress report`,
      Author: "MyLisa",
      Subject: "Learner progress report",
      CreationDate: generatedAt,
    },
  });

  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
  renderProgressPdf(doc, profile, generatedAt);
  doc.end();

  await new Promise<void>((resolve, reject) => {
    doc.on("end", resolve);
    doc.on("error", reject);
  });

  return {
    filename,
    mimeType: "application/pdf",
    buffer: Buffer.concat(chunks),
  };
}
