import { createHash } from "node:crypto";
import type { PrismaClient, CanonicalItemStatus } from "@prisma/client";
import type {
  CanonicalQuestionInsert,
  GeneratedCanonicalQuestion,
} from "./types";

/**
 * =========================================================
 * TYPES
 * =========================================================
 */

export type SaveCanonicalQuestionsOptions = {
  organisationId: string;
  strandId?: string | null;
  strandLabel?: string | null;
  deleteExisting?: boolean;
  prismaClient: PrismaClient;
};

export type SaveCanonicalQuestionsResult = {
  objectiveId: string;
  createdCount: number;
  deletedCount: number;
};

type CanonicalQuestionCreateInputLike = {
  organisationId: string;
  objectiveId: string;
  strandId?: string | null;
  strandLabel?: string | null;
  itemType: GeneratedCanonicalQuestion["itemType"];
  operator?: GeneratedCanonicalQuestion["operator"];
  lhsA?: number;
  lhsB?: number;
  rhs?: number;
  equation?: string | null;
  promptText: string;
  answerText: string;
  contentJson?: Record<string, unknown>;
  sequence: number;
  difficulty: GeneratedCanonicalQuestion["difficulty"];
  isGenerated: boolean;
  generatorVersion?: string | null;
  generatorMeta?: Record<string, unknown>;
  contentSha256: string;
  status?: CanonicalItemStatus;
};

/**
 * =========================================================
 * INTERNAL HELPERS
 * =========================================================
 */

function sha256(input: string): string {
  return createHash("sha256").update(input).digest("hex");
}

function buildContentSha256(row: {
  organisationId: string;
  objectiveId: string;
  itemType: string;
  operator?: string;
  lhsA?: number;
  lhsB?: number;
  rhs?: number;
  equation?: string | null;
  promptText: string;
  answerText: string;
  contentJson?: Record<string, unknown>;
}): string {
  return sha256(
    JSON.stringify({
      organisationId: row.organisationId,
      objectiveId: row.objectiveId,
      itemType: row.itemType,
      operator: row.operator ?? null,
      lhsA: row.lhsA ?? null,
      lhsB: row.lhsB ?? null,
      rhs: row.rhs ?? null,
      equation: row.equation ?? null,
      promptText: row.promptText,
      answerText: row.answerText,
      contentJson: row.contentJson ?? null,
    })
  );
}

function toSequenceQuestions(
  objectiveId: string,
  questions: GeneratedCanonicalQuestion[]
): CanonicalQuestionInsert[] {
  return questions.map((question, index) => ({
    objectiveId,
    itemType: question.itemType,
    operator: question.operator,
    lhsA: question.lhsA,
    lhsB: question.lhsB,
    rhs: question.rhs,
    equation: question.equation,
    promptText: question.promptText,
    answerText: question.answerText,
    contentJson: question.contentJson,
    sequence: index + 1,
    difficulty: question.difficulty,
    isGenerated: true,
    generatorVersion: question.generatorVersion,
    generatorMeta: question.generatorMeta,
  }));
}

function sortBySequence<T extends { sequence: number }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => a.sequence - b.sequence);
}

function uniqueBySequence(
  rows: CanonicalQuestionInsert[]
): CanonicalQuestionInsert[] {
  const seen = new Set<number>();
  const out: CanonicalQuestionInsert[] = [];

  for (const row of sortBySequence(rows)) {
    if (seen.has(row.sequence)) {
      throw new Error(
        `Duplicate sequence detected while saving canonical questions: ${row.sequence}`
      );
    }
    seen.add(row.sequence);
    out.push(row);
  }

  return out;
}

function assertSameObjectiveId(
  rows: CanonicalQuestionInsert[],
  objectiveId: string
): void {
  for (const row of rows) {
    if (row.objectiveId !== objectiveId) {
      throw new Error(
        `Mismatched objectiveId in save payload. Expected ${objectiveId}, got ${row.objectiveId}.`
      );
    }
  }
}

function coerceRows(
  objectiveId: string,
  questions: GeneratedCanonicalQuestion[] | CanonicalQuestionInsert[]
): CanonicalQuestionInsert[] {
  if (questions.length === 0) return [];

  const first = questions[0] as GeneratedCanonicalQuestion | CanonicalQuestionInsert;

  if ("sequence" in first && "objectiveId" in first) {
    const rows = questions as CanonicalQuestionInsert[];
    assertSameObjectiveId(rows, objectiveId);
    return uniqueBySequence(rows);
  }

  return uniqueBySequence(
    toSequenceQuestions(objectiveId, questions as GeneratedCanonicalQuestion[])
  );
}

function normalizeCreateInput(
  organisationId: string,
  strandId: string | null | undefined,
  strandLabel: string | null | undefined,
  row: CanonicalQuestionInsert
): CanonicalQuestionCreateInputLike {
  const normalized: CanonicalQuestionCreateInputLike = {
    organisationId,
    objectiveId: row.objectiveId,
    strandId: strandId ?? null,
    strandLabel: strandLabel ?? null,
    itemType: row.itemType,
    operator: row.operator,
    lhsA: row.lhsA,
    lhsB: row.lhsB,
    rhs: row.rhs,
    equation: row.equation ?? null,
    promptText: row.promptText,
    answerText: row.answerText,
    contentJson: row.contentJson,
    sequence: row.sequence,
    difficulty: row.difficulty,
    isGenerated: row.isGenerated,
    generatorVersion: row.generatorVersion ?? null,
    generatorMeta: row.generatorMeta,
    contentSha256: "",
  };

  normalized.contentSha256 = buildContentSha256(normalized);
  return normalized;
}

/**
 * =========================================================
 * PUBLIC API
 * =========================================================
 */

export async function saveCanonicalQuestions(
  objectiveId: string,
  questions: GeneratedCanonicalQuestion[] | CanonicalQuestionInsert[],
  options: SaveCanonicalQuestionsOptions
): Promise<SaveCanonicalQuestionsResult> {
  const client = options.prismaClient;
  const deleteExisting = options.deleteExisting ?? true;
  const organisationId = options.organisationId?.trim();

  if (!client) {
    throw new Error("prismaClient is required when saving canonical questions.");
  }

  if (!organisationId) {
    throw new Error("organisationId is required when saving canonical questions.");
  }

  if (!objectiveId?.trim()) {
    throw new Error("objectiveId is required when saving canonical questions.");
  }

  const rows = coerceRows(objectiveId, questions);

  return client.$transaction(async (tx) => {
    let deletedCount = 0;

    if (deleteExisting) {
      const deleted = await tx.canonicalQuestion.deleteMany({
        where: { objectiveId },
      });
      deletedCount = deleted.count;
    }

    if (rows.length === 0) {
      return {
        objectiveId,
        createdCount: 0,
        deletedCount,
      };
    }

    const createData = rows.map((row) =>
      normalizeCreateInput(
        organisationId,
        options.strandId,
        options.strandLabel,
        row
      )
    );

    await tx.canonicalQuestion.createMany({
      data: createData,
    });

    return {
      objectiveId,
      createdCount: createData.length,
      deletedCount,
    };
  });
}

export async function replaceCanonicalQuestions(
  objectiveId: string,
  questions: GeneratedCanonicalQuestion[] | CanonicalQuestionInsert[],
  options: SaveCanonicalQuestionsOptions
): Promise<SaveCanonicalQuestionsResult> {
  return saveCanonicalQuestions(objectiveId, questions, {
    ...options,
    deleteExisting: true,
  });
}

export async function appendCanonicalQuestions(
  objectiveId: string,
  questions: GeneratedCanonicalQuestion[] | CanonicalQuestionInsert[],
  options: SaveCanonicalQuestionsOptions
): Promise<SaveCanonicalQuestionsResult> {
  const client = options.prismaClient;

  if (!client) {
    throw new Error("prismaClient is required when appending canonical questions.");
  }

  const existing = await client.canonicalQuestion.findMany({
    where: { objectiveId },
    select: { sequence: true },
    orderBy: { sequence: "asc" },
  });

  const maxSequence =
    existing.length > 0 ? Math.max(...existing.map((row) => row.sequence)) : 0;

  const incoming = coerceRows(objectiveId, questions).map((row, index) => ({
    ...row,
    sequence: maxSequence + index + 1,
  }));

  return saveCanonicalQuestions(objectiveId, incoming, {
    ...options,
    deleteExisting: false,
  });
}