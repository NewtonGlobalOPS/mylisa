import type { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

export type WrapperVectorRecord = {
  id: string;
  studentId: string;
  objectiveId: string | null;
  title: string;
  content: string;
  scope: string;
  source: string;
  strand: string | null;
  sortOrder: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  objective: {
    id: string;
    code: string;
    title: string;
    strand: string;
  } | null;
};

type WrapperVectorRow = Prisma.WrapperVectorGetPayload<{
  include: {
    objective: {
      select: {
        id: true;
        code: true;
        title: true;
        strand: true;
      };
    };
  };
}>;

function toRecord(vector: WrapperVectorRow): WrapperVectorRecord {
  return {
    id: vector.id,
    studentId: vector.studentId,
    objectiveId: vector.objectiveId,
    title: vector.title,
    content: vector.content,
    scope: vector.scope,
    source: vector.source,
    strand: vector.strand,
    sortOrder: vector.sortOrder,
    isActive: vector.isActive,
    createdAt: vector.createdAt.toISOString(),
    updatedAt: vector.updatedAt.toISOString(),
    objective: vector.objective
      ? {
          id: vector.objective.id,
          code: vector.objective.code,
          title: vector.objective.title,
          strand: vector.objective.strand,
        }
      : null,
  };
}

async function assertStudentExists(studentId: string) {
  const student = await prisma.student.findUnique({
    where: { id: studentId },
    select: {
      id: true,
      organisationId: true,
    },
  });

  if (!student) {
    throw new Error("Student not found");
  }

  return student;
}

export async function listWrapperVectors(studentId: string) {
  await assertStudentExists(studentId);

  const vectors = await prisma.wrapperVector.findMany({
    where: { studentId },
    orderBy: [{ isActive: "desc" }, { sortOrder: "asc" }, { updatedAt: "desc" }],
    include: {
      objective: {
        select: {
          id: true,
          code: true,
          title: true,
          strand: true,
        },
      },
    },
  });

  return {
    studentId,
    count: vectors.length,
    items: vectors.map(toRecord),
  };
}

export async function listActiveWrapperVectors(studentId: string) {
  const vectors = await prisma.wrapperVector.findMany({
    where: {
      studentId,
      isActive: true,
    },
    orderBy: [{ sortOrder: "asc" }, { updatedAt: "desc" }],
    include: {
      objective: {
        select: {
          id: true,
          code: true,
          title: true,
          strand: true,
        },
      },
    },
  });

  return vectors.map(toRecord);
}

export async function createWrapperVector(input: {
  studentId: string;
  objectiveId?: string;
  title: string;
  content: string;
  scope?: string;
  source?: string;
  strand?: string;
  sortOrder?: number;
  isActive?: boolean;
}) {
  const student = await assertStudentExists(input.studentId);

  const created = await prisma.wrapperVector.create({
    data: {
      organisationId: student.organisationId,
      studentId: student.id,
      objectiveId: input.objectiveId?.trim() || undefined,
      title: input.title.trim(),
      content: input.content.trim(),
      scope: input.scope?.trim() || "GENERAL",
      source: input.source?.trim() || "MANUAL",
      strand: input.strand?.trim() || undefined,
      sortOrder: input.sortOrder ?? 0,
      isActive: input.isActive ?? true,
    },
    include: {
      objective: {
        select: {
          id: true,
          code: true,
          title: true,
          strand: true,
        },
      },
    },
  });

  return toRecord(created);
}

export async function updateWrapperVector(input: {
  vectorId: string;
  title?: string;
  content?: string;
  scope?: string;
  source?: string;
  strand?: string | null;
  objectiveId?: string | null;
  sortOrder?: number;
  isActive?: boolean;
}) {
  const updated = await prisma.wrapperVector.update({
    where: { id: input.vectorId },
    data: {
      ...(typeof input.title === "string" ? { title: input.title.trim() } : {}),
      ...(typeof input.content === "string" ? { content: input.content.trim() } : {}),
      ...(typeof input.scope === "string" ? { scope: input.scope.trim() || "GENERAL" } : {}),
      ...(typeof input.source === "string" ? { source: input.source.trim() || "MANUAL" } : {}),
      ...(input.strand !== undefined
        ? { strand: input.strand?.trim() || null }
        : {}),
      ...(input.objectiveId !== undefined
        ? { objectiveId: input.objectiveId?.trim() || null }
        : {}),
      ...(typeof input.sortOrder === "number" ? { sortOrder: input.sortOrder } : {}),
      ...(typeof input.isActive === "boolean" ? { isActive: input.isActive } : {}),
    },
    include: {
      objective: {
        select: {
          id: true,
          code: true,
          title: true,
          strand: true,
        },
      },
    },
  });

  return toRecord(updated);
}

export async function deleteWrapperVector(vectorId: string) {
  const deleted = await prisma.wrapperVector.delete({
    where: { id: vectorId },
    include: {
      objective: {
        select: {
          id: true,
          code: true,
          title: true,
          strand: true,
        },
      },
    },
  });

  return toRecord(deleted);
}

function normalizeInterestToken(value: string) {
  return value
    .trim()
    .replace(/\s+/g, "_")
    .replace(/[^A-Za-z0-9_]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_+|_+$/g, "")
    .toUpperCase();
}

function buildInterestVectorContent(input: {
  category: string;
  factor: string;
  notes?: string;
}) {
  const categoryLabel = input.category.trim();
  const factorLabel = input.factor.trim();
  const notes = input.notes?.trim();

  const base = `Use familiar examples connected to ${factorLabel} within ${categoryLabel.toLowerCase()} when it helps the learner stay engaged.`;
  return notes ? `${base} Additional context: ${notes}` : base;
}

export async function createInterestFactorVectors(input: {
  studentId: string;
  category: string;
  primaryFactor: string;
  secondaryFactor: string;
  notes?: string;
}) {
  const category = normalizeInterestToken(input.category);
  const primaryFactor = normalizeInterestToken(input.primaryFactor);
  const secondaryFactor = normalizeInterestToken(input.secondaryFactor);

  if (!category || !primaryFactor || !secondaryFactor) {
    throw new Error("Category and both interest factors are required.");
  }

  const [primary, secondary] = await Promise.all([
    createWrapperVector({
      studentId: input.studentId,
      title: `${category}:${primaryFactor}`,
      content: buildInterestVectorContent({
        category: input.category,
        factor: input.primaryFactor,
        notes: input.notes,
      }),
      scope: "INTEREST",
      source: "INTEREST_FACTOR",
      isActive: true,
    }),
    createWrapperVector({
      studentId: input.studentId,
      title: `${category}:${secondaryFactor}`,
      content: buildInterestVectorContent({
        category: input.category,
        factor: input.secondaryFactor,
        notes: input.notes,
      }),
      scope: "INTEREST",
      source: "INTEREST_FACTOR",
      isActive: true,
    }),
  ]);

  return {
    studentId: input.studentId,
    category,
    vectors: [primary, secondary],
  };
}
