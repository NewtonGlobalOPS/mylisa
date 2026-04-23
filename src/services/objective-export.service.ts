import fs from "node:fs/promises";
import path from "node:path";
import ExcelJS from "exceljs";
import {
  AlignmentType,
  Document,
  HeadingLevel,
  Packer,
  Paragraph,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from "docx";
import type { PrismaClient, KeyStage, Subject } from "@prisma/client";

type ExportFormat = "xlsx" | "docx" | "both";

type ExportOptions = {
  format: ExportFormat;
  organisationSlug?: string;
  activeOnly?: boolean;
  outputDir?: string;
};

type ObjectiveRow = {
  subject: Subject;
  keyStage: KeyStage;
  yearGroup: number | null;
  strand: string;
  code: string;
  title: string;
  statement: string;
  statutory: boolean;
  keywords: string[];
};

const SUBJECT_ORDER: Subject[] = ["MATHS", "SCIENCE", "COMPUTING", "ENGLISH"];
const KEY_STAGE_ORDER: KeyStage[] = ["KS1", "KS2", "KS3", "KS4"];

function compareNullableNumber(a: number | null, b: number | null): number {
  if (a === null && b === null) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

function compareString(a: string, b: string): number {
  return a.localeCompare(b, undefined, { sensitivity: "base" });
}

function sortObjectives(rows: ObjectiveRow[]): ObjectiveRow[] {
  return [...rows].sort((a, b) => {
    const subjectCmp =
      SUBJECT_ORDER.indexOf(a.subject) - SUBJECT_ORDER.indexOf(b.subject);
    if (subjectCmp !== 0) return subjectCmp;

    const ksCmp =
      KEY_STAGE_ORDER.indexOf(a.keyStage) - KEY_STAGE_ORDER.indexOf(b.keyStage);
    if (ksCmp !== 0) return ksCmp;

    const yearCmp = compareNullableNumber(a.yearGroup, b.yearGroup);
    if (yearCmp !== 0) return yearCmp;

    const strandCmp = compareString(a.strand || "", b.strand || "");
    if (strandCmp !== 0) return strandCmp;

    const titleCmp = compareString(a.title || "", b.title || "");
    if (titleCmp !== 0) return titleCmp;

    return compareString(a.code || "", b.code || "");
  });
}

function yearLabel(yearGroup: number | null): string {
  return yearGroup === null ? "No Year Group" : `Year ${yearGroup}`;
}

async function writeXlsx(rows: ObjectiveRow[], outputPath: string): Promise<void> {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "OpenAI";
  workbook.created = new Date();

  const allSheet = workbook.addWorksheet("All Objectives");
  const headers = [
    "Subject",
    "Key Stage",
    "Year Group",
    "Strand",
    "Code",
    "Title",
    "Statement",
    "Statutory",
    "Keywords",
  ];

  allSheet.addRow(headers);

  for (const row of rows) {
    allSheet.addRow([
      row.subject,
      row.keyStage,
      row.yearGroup ?? "",
      row.strand,
      row.code,
      row.title,
      row.statement,
      row.statutory ? "Yes" : "No",
      row.keywords.join(", "),
    ]);
  }

  for (const subject of SUBJECT_ORDER) {
    const subjectRows = rows.filter((r) => r.subject === subject);
    const sheet = workbook.addWorksheet(subject);

    sheet.addRow(headers);

    for (const row of subjectRows) {
      sheet.addRow([
        row.subject,
        row.keyStage,
        row.yearGroup ?? "",
        row.strand,
        row.code,
        row.title,
        row.statement,
        row.statutory ? "Yes" : "No",
        row.keywords.join(", "),
      ]);
    }

    sheet.columns = [
      { width: 14 },
      { width: 12 },
      { width: 12 },
      { width: 24 },
      { width: 28 },
      { width: 28 },
      { width: 60 },
      { width: 12 },
      { width: 30 },
    ];
  }

  allSheet.columns = [
    { width: 14 },
    { width: 12 },
    { width: 12 },
    { width: 24 },
    { width: 28 },
    { width: 28 },
    { width: 60 },
    { width: 12 },
    { width: 30 },
  ];

  await workbook.xlsx.writeFile(outputPath);
}

async function writeDocx(rows: ObjectiveRow[], outputPath: string): Promise<void> {
  const children: Paragraph[] | any[] = [];

  children.push(
    new Paragraph({
      text: "Curriculum Objectives",
      heading: HeadingLevel.TITLE,
    })
  );

  for (const subject of SUBJECT_ORDER) {
    const subjectRows = rows.filter((r) => r.subject === subject);
    if (subjectRows.length === 0) continue;

    children.push(
      new Paragraph({
        text: subject,
        heading: HeadingLevel.HEADING_1,
      })
    );

    for (const ks of KEY_STAGE_ORDER) {
      const ksRows = subjectRows.filter((r) => r.keyStage === ks);
      if (ksRows.length === 0) continue;

      children.push(
        new Paragraph({
          text: ks,
          heading: HeadingLevel.HEADING_2,
        })
      );

      const yearGroups = [...new Set(ksRows.map((r) => r.yearGroup))].sort((a, b) =>
        compareNullableNumber(a, b)
      );

      for (const yg of yearGroups) {
        const groupRows = ksRows.filter((r) => r.yearGroup === yg);

        children.push(
          new Paragraph({
            text: yearLabel(yg),
            heading: HeadingLevel.HEADING_3,
          })
        );

        const table = new Table({
          width: { size: 100, type: WidthType.PERCENTAGE },
          rows: [
            new TableRow({
              children: ["Strand", "Code", "Title", "Statement"].map(
                (text) =>
                  new TableCell({
                    children: [
                      new Paragraph({
                        children: [new TextRun({ text, bold: true })],
                        alignment: AlignmentType.LEFT,
                      }),
                    ],
                  })
              ),
            }),
            ...groupRows.map(
              (row) =>
                new TableRow({
                  children: [
                    row.strand,
                    row.code,
                    row.title,
                    row.statement,
                  ].map(
                    (text) =>
                      new TableCell({
                        children: [new Paragraph(String(text ?? ""))],
                      })
                  ),
                })
            ),
          ],
        });

        children.push(table);
      }
    }
  }

  const doc = new Document({
    sections: [{ children }],
  });

  const buffer = await Packer.toBuffer(doc);
  await fs.writeFile(outputPath, buffer);
}

export async function exportObjectives(
  prisma: PrismaClient,
  opts: ExportOptions
): Promise<{ xlsxPath?: string; docxPath?: string; count: number }> {
  const outputDir = opts.outputDir ?? "exports/objectives";
  await fs.mkdir(outputDir, { recursive: true });

  const where: any = {};
  if (opts.activeOnly) where.isActive = true;

  if (opts.organisationSlug) {
    where.organisation = { slug: opts.organisationSlug };
  }

  const objectives = await prisma.curriculumObjective.findMany({
    where,
    select: {
      subject: true,
      keyStage: true,
      yearGroup: true,
      strand: true,
      code: true,
      title: true,
      statement: true,
      statutory: true,
      keywords: true,
    },
  });

  const rows = sortObjectives(
    objectives.map((o) => ({
      subject: o.subject,
      keyStage: o.keyStage,
      yearGroup: o.yearGroup,
      strand: o.strand,
      code: o.code,
      title: o.title,
      statement: o.statement,
      statutory: o.statutory,
      keywords: o.keywords,
    }))
  );

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const baseName = `curriculum-objectives-${stamp}`;

  let xlsxPath: string | undefined;
  let docxPath: string | undefined;

  if (opts.format === "xlsx" || opts.format === "both") {
    xlsxPath = path.join(outputDir, `${baseName}.xlsx`);
    await writeXlsx(rows, xlsxPath);
  }

  if (opts.format === "docx" || opts.format === "both") {
    docxPath = path.join(outputDir, `${baseName}.docx`);
    await writeDocx(rows, docxPath);
  }

  return {
    xlsxPath,
    docxPath,
    count: rows.length,
  };
}
