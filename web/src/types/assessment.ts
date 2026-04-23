export type DifficultyBand = "EASY" | "MEDIUM" | "HARD";

export type AssessmentChoice = {
  key: "A" | "B" | "C" | "D";
  label: string;
};

export type AssessmentQuestion = {
  id: string;
  objectiveId: string;
  code: string;
  title: string;
  statement: string;
  yearGroup: number | null;
  strand: string;
  promptText: string;
  canonicalPromptText?: string;
  displayPromptText?: string;
  answerText: string;
  difficulty: DifficultyBand;
  answerMode?: "numeric" | "fraction" | "multi_part" | "algebra" | string;
  calculatorAllowed?: boolean;
  allowCalculator?: boolean;
  inputHelp?: string;
  wrapperSource?: "llm" | "fallback";
  choices: AssessmentChoice[];
  correctChoiceKey: "A" | "B" | "C" | "D";
  contentJson?: Record<string, unknown> | null;
};

export type AssessmentStartResponse = {
  sessionId: string;
  entryYear: number;
  maxQuestions: number;
  extensionMaxQuestions: number;
  firstQuestion: AssessmentQuestion | null;
};

export type AssessmentResult = {
  overallWorkingBand: string;
  overallConfidence: number;
  questionCount: number;
  completionReason: string;
  strands: Array<{
    strand: string;
    secureYear: number | null;
    emergingYear: number | null;
    confidence: number;
    asked: number;
    correct: number;
    accuracy: number;
  }>;
  summary: string;
};

export type AssessmentAnswerResponse = {
  isCorrect: boolean;
  correctAnswer: string;
  isComplete: boolean;
  nextQuestion: AssessmentQuestion | null;
  result?: AssessmentResult;
  askedCount: number;
  overallConfidence: number;
  overallWorkingBand: string;
};

export type AssessmentSessionSummary = {
  sessionId: string;
  isComplete: boolean;
  askedCount: number;
  entryYear: number;
  overallConfidence: number;
  overallWorkingBand: string;
  strands: Record<
    string,
    {
      strand: string;
      asked: number;
      correct: number;
      currentTargetYear: number | null;
      secureYear: number | null;
      emergingYear: number | null;
      confidence: number;
    }
  >;
};

export type StudentOnboardingResponse = {
  message: string;
  userId: string;
  studentId: string;
  email: string;
  temporaryPassword?: string;
  student: {
    id: string;
    firstName?: string;
    lastName?: string;
    age: number;
    schoolYear: number;
    keyStage?: string;
    subjects: string[];
    guardianEmail?: string;
  };
};

export type DashboardLearnerLookupResponse = {
  query: string | null;
  count: number;
  items: Array<{
    studentId: string;
    userId: string;
    userEmail: string;
    firstName: string | null;
    lastName: string | null;
    displayName: string;
    guardianEmail: string | null;
    age: number;
    schoolYear: number | null;
    keyStage: string | null;
    subjects: string[];
    bookingIds: string[];
    ndscreenSessionId: string | null;
    latestAssessment: {
      id: string;
      status: string;
      isSubmitted: boolean;
      score: number | null;
      createdAt: string;
      updatedAt: string;
      submittedAt: string | null;
    } | null;
    assessmentCount: number;
    totalAttemptCount: number;
  }>;
};

export type StoredAssessmentState = {
  student: StudentOnboardingResponse | null;
  sessionId: string;
  entryYear: number | null;
  currentQuestion: AssessmentQuestion | null;
  result: AssessmentResult | null;
  askedCount: number;
  ndscreenSessionId?: string;
  authToken?: string;
};

export type CombinedChildProfileResponse = {
  child: {
    id: string;
    firstName?: string | null;
    lastName?: string | null;
    displayName: string;
    age: number;
    schoolYear: number | null;
    keyStage?: string | null;
    subjects: string[];
    guardianEmail?: string | null;
  };
  assessment: {
    sessionId: string;
    status: string;
    score: number | null;
    createdAt: string;
    updatedAt: string;
    submittedAt: string | null;
    entryYear: number | null;
    overallWorkingBand: string | null;
    overallConfidence: number | null;
    questionCount: number;
    strands: Array<{
      strand: string;
      asked: number;
      correct: number;
      accuracy: number;
      confidence: number;
      secureYear: number | null;
      emergingYear: number | null;
      currentTargetYear: number | null;
    }>;
  } | null;
  screening: {
    configured: boolean;
    sessionId: string | null;
    ok: boolean;
    status: string | null;
    screeningKind: string | null;
    questionSet: { key: string | null; version: number | null } | null;
    subject: {
      label: string | null;
      displayName: string | null;
      ageYears: number | null;
      schoolYear: string | null;
      locale: string | null;
      dob: string | null;
    } | null;
    intake: {
      id: string;
      schoolName: string | null;
      primaryGuardian: {
        relationship: string | null;
        firstName: string | null;
        lastName: string | null;
        email: string | null;
        phone: string | null;
      } | null;
    } | null;
    participants: Array<{
      informant: string;
      label: string;
      required: boolean;
      state: string;
      startedAt: string | null;
      completedAt: string | null;
    }>;
    report: {
      status: string | null;
      readyAt: string | null;
      generatedAt: string | null;
      errorMessage: string | null;
    } | null;
    latestResult: {
      validity: string | null;
      confidence: number | null;
      confidenceBand: string | null;
      overall: number | null;
      overallAdjusted: number | null;
      profileType: string | null;
      recommendation: string | null;
    } | null;
    learningProfile: {
      summaryText: string | null;
      profiles: string[];
      primaryProfile: string | null;
      confidence: number | null;
      confidenceBand: string | null;
      summary: string | null;
      recommendation: string | null;
    } | null;
    error: string | null;
  } | null;
  recommendations: {
    course: {
      label: string;
      targetYear: number | null;
      intensity: string;
      rationale: string;
      yearBlend?: Array<{
        year: number;
        weight: number;
        reason: string;
      }>;
      interventions?: Array<{
        label: string;
        severity: string;
        reason: string;
        strand: string | null;
        targetYear: number | null;
      }>;
      matchedCourse?: {
        slug: string;
        title: string;
        level: string | null;
        versionNumber: number;
        source: string;
      } | null;
      weightedModules?: Array<{
        moduleId: string;
        title: string;
        sortOrder: number;
        objectiveCode: string | null;
        yearGroup: number | null;
        strand: string | null;
        weight: number;
        reason: string;
      }>;
    };
    deliveryProfile: {
      pace: string;
      scaffolding: string;
      confidencePriority: string;
      rationale: string;
    };
    strands: Array<{
      strand: string;
      priority: number;
      asked: number;
      correct: number;
      accuracy: number;
      confidence: number;
      secureYear: number | null;
      emergingYear: number | null;
      currentTargetYear: number | null;
      reason: string;
    }>;
    objectives: Array<{
      objectiveId: string;
      code: string;
      title: string;
      yearGroup: number | null;
      strand: string;
      reason: string;
      source: string;
      priorityWeight?: number;
      gapSeverity?: number;
      occurrenceCount?: number;
    }>;
  };
};

export type LessonRuntimeResponse = {
  delivery: {
    child: {
      id: string;
      displayName: string;
      age: number;
      schoolYear: number | null;
      keyStage: string | null;
      interests: string[];
    };
    curriculum: {
      objective: {
        id: string;
        code: string;
        subject: string;
        keyStage: string;
        yearGroup: number | null;
        strand: string;
        title: string;
        statement: string;
        keywords: string[];
      };
      source: {
        slug: string;
        name: string;
        url: string | null;
      };
    };
    canonical: {
      sourceOfTruth: boolean;
      questionCount: number;
      questions: Array<{
        id: string;
        sequence: number;
        itemType: string;
        operator: string | null;
        lhsA: number | null;
        lhsB: number | null;
        rhs: number | null;
        equation: string | null;
        promptText: string;
        answerText: string;
        difficulty: DifficultyBand;
      }>;
    };
    lessonFlow: {
      sectionCount: number;
      sections: Array<{
        key: string;
        title: string;
        purpose: string;
        chunkIds: string[];
        canonicalQuestionIds: string[];
      }>;
    };
    personalization: {
      presentationControls: {
        tutoringMode: string;
        verbosity: string;
        stepSize: string;
        lowStimulus: boolean;
        avoidMetaphors: boolean;
        useBullets: boolean;
        moreExamples: boolean;
        frequentCheckIns: boolean;
        readingLevel: number | null;
        attentionSpanMins: number | null;
        scaffolding: string;
        confidencePriority: string;
        rationale: string;
      };
    };
    llmContract: {
      invariant: string;
      wrapper: string;
      guardrails: string[];
    };
  };
  screenPayload: {
    child: {
      displayName: string;
      age: number;
      schoolYear: number | null;
      keyStage: string | null;
      interests: string[];
    };
    objective: {
      code: string;
      subject: string;
      keyStage: string;
      yearGroup: number | null;
      strand: string;
      title: string;
      statement: string;
      keywords: string[];
    };
    lessonFlow: {
      sectionCount: number;
      sections: Array<{
        key: string;
        title: string;
        purpose: string;
        chunkIds: string[];
        canonicalQuestionIds: string[];
      }>;
    };
    presentation: {
      tutoringMode: string;
      verbosity: string;
      stepSize: string;
      lowStimulus: boolean;
      scaffolding: string;
      confidencePriority: string;
    };
    canonicalCards: Array<{
      id: string;
      sequence: number;
      title: string;
      promptText: string;
      answerText: string;
      itemType: string;
      difficulty: DifficultyBand;
      equation: string | null;
      structure: {
        operator: string | null;
        lhsA: number | null;
        lhsB: number | null;
        rhs: number | null;
      };
    }>;
    supportCards: Array<{
      type: string;
      items: Array<{
        id: string;
        difficulty: DifficultyBand;
        excerpt: string[];
        citations: string[];
        tags: string[];
      }>;
    }>;
  };
  promptPayload: {
    modelIntent: string;
    systemPrompt: string;
    outputContract: {
      rules: string[];
      expectedSections: string[];
    };
  };
};
