// src/services/oak.types.ts
// Minimal types we actually use (kept intentionally loose - Oak may expand fields).

export type OakSubjectListItem = {
  subjectTitle: string;
  subjectSlug: string;
  sequenceSlugs: Array<{
    sequenceSlug: string;
    years: Array<number>;
    keyStages: Array<{ keyStageSlug: string; keyStageTitle: string }>;
    phaseSlug: string;
    phaseTitle: string;
    ks4Options: null | unknown;
  }>;
  years?: Array<number>;
  keyStages?: Array<{ keyStageSlug: string; keyStageTitle: string }>;
};

export type OakSequenceUnitsResponse = Array<{
  year: number | string;
  title?: string;
  units: Array<{
    unitTitle: string;
    unitOrder: number;
    unitSlug: string;
    categories?: Array<{ categoryTitle?: string; categorySlug?: string }>;
    threads?: Array<{
      threadTitle?: string;
      threadSlug?: string;
      order?: number;
    }>;
  }>;
}>;

export type OakUnitSummary = {
  unitSlug: string;
  unitTitle: string;
  year: number | string;
  phaseSlug: string;
  subjectSlug: string;
  keyStageSlug: string;
  description?: string | null;
  priorKnowledgeRequirements?: string[];
  nationalCurriculumContent?: string[];
  whyThisWhyNow?: string | null;
  lessons?: Array<{ lessonSlug: string; lessonTitle: string }>;
  lessonTitles?: Array<string>;
};

export type OakLessonSummary = {
  lessonTitle: string;
  lessonSlug?: string;
  unitSlug: string;
  unitTitle: string;
  subjectSlug: string;
  subjectTitle?: string;
  keyStageSlug: string;
  keyStageTitle?: string;
  misconceptions?: Array<{
    misconception?: string;
    pupilLessonOutcome?: string;
    teacherResponse?: string;
  }>;
  teacherTips?: Array<{ title?: string; body?: string; content?: string }>;
  lessonKeywords?: Array<{ keyword?: string; description?: string }>;
};

export type OakLessonTranscript = { transcript: string; vtt: string };

export type OakSequenceQuestions = Array<{
  lessonTitle: string;
  lessonSlug: string;
  starterQuiz?: any[];
  exitQuiz?: any[];
}>;
