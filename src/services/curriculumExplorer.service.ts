import type { KeyStage, Subject } from "@prisma/client";
import { prisma } from "../lib/prisma.js";

type ExplorerFilterInput = {
  organisationSlug?: string;
  subject?: Subject;
  keyStage?: KeyStage;
  yearGroup?: number;
  strand?: string;
  search?: string;
  hasContent?: boolean;
  hasCanonical?: boolean;
  limit?: number;
};

type ObjectiveWhereInput = {
  organisationId: string;
  subject?: Subject;
  keyStage?: KeyStage;
  yearGroup?: number;
  strand?: string;
  search?: string;
  hasContent?: boolean;
  hasCanonical?: boolean;
};

function normalizeSearch(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

function normalizeOptionalText(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

async function resolveOrganisation(organisationSlug?: string) {
  if (organisationSlug?.trim()) {
    const organisation = await prisma.organisation.findUnique({
      where: { slug: organisationSlug.trim() },
      select: { id: true, slug: true, name: true },
    });

    if (!organisation) {
      throw new Error(`Organisation not found for slug: ${organisationSlug}`);
    }

    return organisation;
  }

  const organisation = await prisma.organisation.findFirst({
    orderBy: { createdAt: "asc" },
    select: { id: true, slug: true, name: true },
  });

  if (!organisation) {
    throw new Error("No organisation found.");
  }

  return organisation;
}

function buildObjectiveWhere(input: ObjectiveWhereInput) {
  const search = normalizeSearch(input.search);
  const strand = normalizeOptionalText(input.strand);

  return {
    organisationId: input.organisationId,
    isActive: true,
    source: {
      slug: "oak",
      isActive: true,
    },
    ...(input.subject ? { subject: input.subject } : {}),
    ...(input.keyStage ? { keyStage: input.keyStage } : {}),
    ...(typeof input.yearGroup === "number" ? { yearGroup: input.yearGroup } : {}),
    ...(strand
      ? {
          strand: {
            contains: strand,
            mode: "insensitive" as const,
          },
        }
      : {}),
    ...(input.hasContent
      ? {
          chunks: {
            some: {
              isActive: true,
            },
          },
        }
      : {}),
    ...(input.hasCanonical
      ? {
          canonicalQuestions: {
            some: {
              status: "ACTIVE" as const,
            },
          },
        }
      : {}),
    ...(search
      ? {
          OR: [
            { code: { contains: search, mode: "insensitive" as const } },
            { title: { contains: search, mode: "insensitive" as const } },
            { statement: { contains: search, mode: "insensitive" as const } },
            { strand: { contains: search, mode: "insensitive" as const } },
            { keywords: { hasSome: [search] } },
          ],
        }
      : {}),
  };
}

export async function listOakCurriculumObjectives(input: ExplorerFilterInput) {
  const organisation = await resolveOrganisation(input.organisationSlug);
  const limit = Math.min(Math.max(input.limit ?? 100, 1), 250);
  const where = buildObjectiveWhere({
    organisationId: organisation.id,
    subject: input.subject,
    keyStage: input.keyStage,
    yearGroup: input.yearGroup,
    strand: input.strand,
    search: input.search,
    hasContent: input.hasContent,
    hasCanonical: input.hasCanonical,
  });

  const objectives = await prisma.curriculumObjective.findMany({
    where,
    take: limit,
    orderBy: [
      { subject: "asc" },
      { keyStage: "asc" },
      { yearGroup: "asc" },
      { strand: "asc" },
      { title: "asc" },
      { code: "asc" },
    ],
    select: {
      id: true,
      code: true,
      subject: true,
      keyStage: true,
      yearGroup: true,
      strand: true,
      title: true,
      statement: true,
      keywords: true,
      _count: {
        select: {
          chunks: true,
          canonicalQuestions: true,
        },
      },
      chunks: {
        where: {
          isActive: true,
        },
        orderBy: [{ type: "asc" }, { createdAt: "asc" }],
        take: 3,
        select: {
          id: true,
          type: true,
          content: true,
          citations: true,
          tags: true,
        },
      },
      canonicalQuestions: {
        where: {
          status: "ACTIVE",
        },
        orderBy: [{ sequence: "asc" }],
        take: 3,
        select: {
          id: true,
          sequence: true,
          itemType: true,
          promptText: true,
          answerText: true,
          difficulty: true,
        },
      },
    },
  });

  return {
    organisation,
    filters: {
      subject: input.subject ?? null,
      keyStage: input.keyStage ?? null,
      yearGroup: input.yearGroup ?? null,
      strand: normalizeOptionalText(input.strand) ?? null,
      search: normalizeSearch(input.search) ?? null,
      hasContent: input.hasContent ?? null,
      hasCanonical: input.hasCanonical ?? null,
      limit,
    },
    count: objectives.length,
    items: objectives.map((objective) => ({
      id: objective.id,
      code: objective.code,
      subject: objective.subject,
      keyStage: objective.keyStage,
      yearGroup: objective.yearGroup,
      strand: objective.strand,
      title: objective.title,
      statement: objective.statement,
      keywords: objective.keywords,
      contentChunkCount: objective._count.chunks,
      canonicalQuestionCount: objective._count.canonicalQuestions,
      lessonChunkPreview: objective.chunks.map((chunk) => ({
        id: chunk.id,
        type: chunk.type,
        excerpt: chunk.content.slice(0, 220),
        citations: chunk.citations,
        tags: chunk.tags,
      })),
      canonicalQuestionPreview: objective.canonicalQuestions.map((question) => ({
        id: question.id,
        sequence: question.sequence,
        itemType: question.itemType,
        difficulty: question.difficulty,
        promptText: question.promptText,
        answerText: question.answerText,
      })),
    })),
  };
}

export async function getOakCurriculumObjectiveDetail(input: {
  objectiveId: string;
  organisationSlug?: string;
}) {
  const organisation = await resolveOrganisation(input.organisationSlug);

  const objective = await prisma.curriculumObjective.findFirst({
    where: {
      id: input.objectiveId,
      organisationId: organisation.id,
      isActive: true,
      source: {
        slug: "oak",
        isActive: true,
      },
    },
    select: {
      id: true,
      code: true,
      subject: true,
      keyStage: true,
      yearGroup: true,
      strand: true,
      title: true,
      statement: true,
      keywords: true,
      source: {
        select: {
          id: true,
          slug: true,
          name: true,
          url: true,
        },
      },
      chunks: {
        where: {
          isActive: true,
        },
        orderBy: [{ type: "asc" }, { createdAt: "asc" }],
        select: {
          id: true,
          type: true,
          difficulty: true,
          content: true,
          citations: true,
          tags: true,
          createdAt: true,
          updatedAt: true,
        },
      },
      canonicalQuestions: {
        where: {
          status: "ACTIVE",
        },
        orderBy: [{ sequence: "asc" }],
        select: {
          id: true,
          sequence: true,
          itemType: true,
          operator: true,
          lhsA: true,
          lhsB: true,
          rhs: true,
          equation: true,
          promptText: true,
          answerText: true,
          difficulty: true,
          generatorVersion: true,
          generatorMeta: true,
          contentJson: true,
          createdAt: true,
          updatedAt: true,
        },
      },
    },
  });

  if (!objective) {
    throw new Error(`Oak objective not found: ${input.objectiveId}`);
  }

  const chunkTypeCounts = objective.chunks.reduce<Record<string, number>>(
    (acc, chunk) => {
      acc[chunk.type] = (acc[chunk.type] ?? 0) + 1;
      return acc;
    },
    {},
  );

  return {
    organisation,
    objective: {
      id: objective.id,
      code: objective.code,
      subject: objective.subject,
      keyStage: objective.keyStage,
      yearGroup: objective.yearGroup,
      strand: objective.strand,
      title: objective.title,
      statement: objective.statement,
      keywords: objective.keywords,
      source: objective.source,
      contentChunkCount: objective.chunks.length,
      canonicalQuestionCount: objective.canonicalQuestions.length,
      chunkTypeCounts,
      chunks: objective.chunks,
      canonicalQuestions: objective.canonicalQuestions,
    },
  };
}

type ResolveOakObjectiveInput = {
  organisationSlug?: string;
  subject?: Subject;
  keyStage?: KeyStage;
  yearGroup?: number;
  strand?: string;
  objectiveCode?: string;
  search?: string;
  requireCanonical?: boolean;
  requireContent?: boolean;
};

function scoreResolvedObjective(
  objective: {
    code: string;
    title: string;
    statement: string;
    strand: string;
    _count: { chunks: number; canonicalQuestions: number };
  },
  input: ResolveOakObjectiveInput,
): number {
  const strand = normalizeOptionalText(input.strand)?.toLowerCase() ?? "";
  const objectiveCode = normalizeOptionalText(input.objectiveCode)?.toLowerCase() ?? "";
  const search = normalizeSearch(input.search)?.toLowerCase() ?? "";
  const code = objective.code.toLowerCase();
  const title = objective.title.toLowerCase();
  const statement = objective.statement.toLowerCase();
  const objectiveStrand = objective.strand.toLowerCase();

  let score = 0;

  if (objective._count.canonicalQuestions > 0) score += 40;
  if (objective._count.chunks > 0) score += 25;

  if (objectiveCode) {
    if (code === objectiveCode) score += 500;
    else if (code.includes(objectiveCode)) score += 180;
  }

  if (strand) {
    if (objectiveStrand === strand) score += 220;
    else if (objectiveStrand.includes(strand)) score += 120;
  }

  if (search) {
    if (title.includes(search)) score += 90;
    if (statement.includes(search)) score += 70;
    if (objectiveStrand.includes(search)) score += 50;
    if (code.includes(search)) score += 110;
  }

  return score;
}

export async function resolveOakCurriculumObjective(input: ResolveOakObjectiveInput) {
  const organisation = await resolveOrganisation(input.organisationSlug);
  const objectiveCode = normalizeOptionalText(input.objectiveCode);
  const where = {
    ...buildObjectiveWhere({
      organisationId: organisation.id,
      subject: input.subject,
      keyStage: input.keyStage,
      yearGroup: input.yearGroup,
      strand: input.strand,
      search: input.search,
      hasContent: input.requireContent,
      hasCanonical: input.requireCanonical,
    }),
    ...(objectiveCode
      ? {
          code: {
            contains: objectiveCode,
            mode: "insensitive" as const,
          },
        }
      : {}),
  };

  const candidates = await prisma.curriculumObjective.findMany({
    where,
    take: 25,
    orderBy: [
      { yearGroup: "asc" },
      { strand: "asc" },
      { title: "asc" },
      { code: "asc" },
    ],
    select: {
      id: true,
      code: true,
      subject: true,
      keyStage: true,
      yearGroup: true,
      strand: true,
      title: true,
      statement: true,
      _count: {
        select: {
          chunks: true,
          canonicalQuestions: true,
        },
      },
    },
  });

  if (candidates.length === 0) {
    throw new Error("No Oak objective matched the requested curriculum selection.");
  }

  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreResolvedObjective(candidate, input),
    }))
    .sort((a, b) => b.score - a.score || a.code.localeCompare(b.code));

  const selected = ranked[0];

  return {
    organisation,
    selection: {
      subject: input.subject ?? null,
      keyStage: input.keyStage ?? null,
      yearGroup: input.yearGroup ?? null,
      strand: normalizeOptionalText(input.strand) ?? null,
      objectiveCode: objectiveCode ?? null,
      search: normalizeSearch(input.search) ?? null,
      requireCanonical: input.requireCanonical ?? null,
      requireContent: input.requireContent ?? null,
    },
    selectedObjective: {
      id: selected.id,
      code: selected.code,
      subject: selected.subject,
      keyStage: selected.keyStage,
      yearGroup: selected.yearGroup,
      strand: selected.strand,
      title: selected.title,
      statement: selected.statement,
      contentChunkCount: selected._count.chunks,
      canonicalQuestionCount: selected._count.canonicalQuestions,
      score: selected.score,
    },
    candidateObjectives: ranked.slice(0, 5).map((candidate) => ({
      id: candidate.id,
      code: candidate.code,
      subject: candidate.subject,
      keyStage: candidate.keyStage,
      yearGroup: candidate.yearGroup,
      strand: candidate.strand,
      title: candidate.title,
      statement: candidate.statement,
      contentChunkCount: candidate._count.chunks,
      canonicalQuestionCount: candidate._count.canonicalQuestions,
      score: candidate.score,
    })),
  };
}
