export type DifficultyBand = "EASY" | "MEDIUM" | "HARD";

export type AssessmentChoice = {
  key: string;
  label: string;
};

export type AssessmentResponseKind =
  | "single_choice"
  | "multi_select"
  | "short_answer"
  | "match"
  | "order";

export type AssessmentMatchPair = {
  left: string;
  right: string;
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
  answerContract?: string;
  responseKind?: AssessmentResponseKind;
  answerMode?: "numeric" | "fraction" | "multi_part" | "algebra" | string;
  calculatorAllowed?: boolean;
  allowCalculator?: boolean;
  inputHelp?: string;
  wrapperSource?: "llm" | "fallback";
  choices: AssessmentChoice[];
  correctChoiceKey: string;
  correctChoiceKeys?: string[];
  matchPairs?: AssessmentMatchPair[];
  orderedAnswers?: string[];
  contentJson?: Record<string, unknown> | null;
};

export type AssessmentStartResponse = {
  sessionId: string;
  subject: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
  entryYear: number;
  maxQuestions: number;
  extensionMaxQuestions: number;
  firstQuestion: AssessmentQuestion | null;
};

export type AssessmentNarrativeReport = {
  displayBandLabel: string;
  displayBandSummary: string;
  parentNarrative: string;
  tutorNarrative: string;
  whatThisMeans: string;
  strengths: string[];
  focusAreas: string[];
  nextSteps: string[];
  tutorActions: string[];
  confidenceNote: string;
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
  report?: AssessmentNarrativeReport | null;
};

export type StoredReportSummary = {
  id: string;
  title: string;
  filename: string;
  mimeType: string;
  sizeBytes: number;
  generatedAt: string;
  downloadUrl: string;
  parentViewUrl: string;
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
  subject?: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
  isComplete: boolean;
  currentQuestion?: AssessmentQuestion | null;
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

export type AuthLoginResponse = {
  token: string;
  user: {
    id: string;
    email: string;
    role: string;
    studentId: string | null;
  };
  student?: StudentOnboardingResponse;
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
      subject: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
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

export type LearnerJourneyResponse = {
  query: string | null;
  count: number;
  totals: {
    assessed: number;
    awaitingAssessment: number;
    assessmentInProgress: number;
  };
  assessed: LearnerJourneyItem[];
  awaitingAssessment: LearnerJourneyItem[];
  assessmentInProgress: LearnerJourneyItem[];
  items: LearnerJourneyItem[];
};

export type NdscreenDashboardResponse = {
  count: number;
  items: Array<{
    sessionId: string;
    screeningStatus: string;
    screeningKind: string;
    questionSet: {
      key: string;
      version: number;
    } | null;
    childDisplayName: string;
    firstName: string | null;
    lastName: string | null;
    age: number | null;
    schoolYear: number | null;
    guardianEmail: string | null;
    report: {
      status: string | null;
      readyAt: string | null;
      generatedAt: string | null;
      errorMessage: string | null;
    };
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
    isImportedToMylisa: boolean;
    student: {
      studentId: string;
      userId: string;
      userEmail: string;
      firstName: string | null;
      lastName: string | null;
      age: number;
      schoolYear: number | null;
      keyStage: string | null;
      guardianEmail: string | null;
    } | null;
    latestAssessment: {
      id: string;
      subject: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
      status: string;
      createdAt: string;
      updatedAt: string;
      submittedAt: string | null;
    } | null;
  }>;
};

export type LearnerJourneyItem = {
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
  journeyStatus: string;
  hasCompletedAssessment: boolean;
  hasAssessmentInProgress: boolean;
  completedAssessmentSubjects: Array<"MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH">;
  ndscreenSessionId: string | null;
  bookingId: string | null;
  bookingType: string | null;
  screeningUpdatedAt: string | null;
  latestAssessment: {
    id: string;
    subject: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
    status: string;
    createdAt: string;
    updatedAt: string;
    submittedAt: string | null;
  } | null;
  wrapperVectorCount: number;
  activeWrapperVectorCount: number;
  wrapperVectorPreview: Array<{
    id: string;
    title: string;
    scope: string;
    strand: string | null;
    isActive: boolean;
  }>;
  progressReport: {
    latestSession: {
      id: string;
      title: string;
      status: string;
      objectiveTitle: string;
      strand: string;
      activityAt: string;
      endedAt: string | null;
      questionsAnswered: number;
      questionsCorrect: number;
      accuracy: number | null;
    } | null;
    today: LearnerProgressWindow;
    week: LearnerProgressWindow;
    month: LearnerProgressWindow;
    activeLessons?: Array<{
      id: string;
      title: string;
      status: string;
      objectiveTitle: string;
      strand: string;
      activityAt: string;
      startedAt: string | null;
      questionsAnswered: number;
      questionsCorrect: number;
      accuracy: number | null;
    }>;
  };
};

export type LearnerProgressWindow = {
  lessonCount: number;
  completedLessonCount: number;
  questionsAnswered: number;
  questionsCorrect: number;
  accuracy: number | null;
};

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

export type StoredAssessmentState = {
  student: StudentOnboardingResponse | null;
  subject?: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
  sessionId: string;
  entryYear: number | null;
  currentQuestion: AssessmentQuestion | null;
  result: AssessmentResult | null;
  askedCount: number;
  ndscreenSessionId?: string;
  authToken?: string;
};

export type NewtonCentreTimetableGroupsResponse = {
  source: "REMOTE_API" | "REMOTE_API_CACHE" | "REMOTE_DB" | "UNCONFIGURED" | "UNAVAILABLE";
  groups: Array<{
    id: string;
    dayOfWeek: number;
    dayLabel: string;
    startTime: string;
    endTime: string;
    title: string;
    subject: string;
    keyStage: string | null;
    ageRange: string | null;
    slotType: string;
    room: string | null;
    capacity: number | null;
    tutor: { id: string; name: string } | null;
    mappedStudentCount: number;
    unmappedStudentCount: number;
    students: Array<{
      assignmentId: string;
      assignmentSource: string;
      remoteStudentId: string;
      firstName: string;
      lastName: string;
      displayName: string;
      yearGroup: string | null;
      workspaceEmail: string | null;
      signupApplicationId: string | null;
      parentEmails: string[];
      mylisaStudentId: string | null;
    }>;
  }>;
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
    subject: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
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
    report?: AssessmentNarrativeReport | null;
  } | null;
  storedReport: StoredReportSummary | null;
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
  wrapperVectors: WrapperVectorRecord[];
  availableAssessments: Array<{
    id: string;
    subject: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
    status: string;
    score: number | null;
    createdAt: string;
    updatedAt: string;
    submittedAt: string | null;
  }>;
  learningReport: {
    course: {
      coursePlanId: string | null;
      title: string;
      status: string;
      subject: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
      assessmentSessionId: string | null;
      ndscreenSessionId: string | null;
      createdAt: string | null;
      updatedAt: string | null;
      source: "SAVED_COURSE_PLAN" | "ASSESSMENT_RECOMMENDATION";
    };
    objectives: Array<{
      objectiveId: string;
      code: string;
      title: string;
      yearGroup: number | null;
      strand: string;
      sequence: number | null;
      priorityWeight: number;
      reason: string;
      source: string;
      status: string;
    }>;
    lessons: Array<{
      lessonSessionId: string;
      coursePlanId: string | null;
      title: string;
      status: string;
      objective: {
        id: string;
        code: string;
        title: string;
        yearGroup: number | null;
        strand: string;
      };
      startedAt: string | null;
      endedAt: string | null;
      updatedAt: string;
      currentBlockKey: string | null;
      questionsAnswered: number;
      questionsCorrect: number;
      accuracy: number | null;
      lastActiveAt: string | null;
      progressLabel: string;
      recentEvents: Array<{
        type: string;
        blockKey: string | null;
        createdAt: string;
      }>;
    }>;
    progressSummary: {
      plannedObjectiveCount: number;
      lessonCount: number;
      completedLessonCount: number;
      inProgressLessonCount: number;
      totalQuestionsAnswered: number;
      totalQuestionsCorrect: number;
      overallLessonAccuracy: number | null;
    };
  };
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
      evidenceLabel?: string;
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
        contentJson?: Record<string, unknown> | null;
        difficulty: DifficultyBand;
      }>;
    };
    lessonFlow: {
      sectionCount: number;
      totalMinutes: number;
      sections: Array<{
        key: string;
        title: string;
        purpose: string;
        durationMinutes: number;
        audience: "TUTOR_SCREEN" | "STUDENT_DEVICE";
        mode: string;
        chunkIds: string[];
        canonicalQuestionIds: string[];
      }>;
      sessionBlocks: Array<{
        key: string;
        title: string;
        purpose: string;
        durationMinutes: number;
        audience: "TUTOR_SCREEN" | "STUDENT_DEVICE";
        mode: string;
        chunkIds: string[];
        canonicalQuestionIds: string[];
        objectiveCodes: string[];
        vectorTitles: string[];
      }>;
      personalisedQuestionRounds: Array<{
        key: string;
        title: string;
        purpose: string;
        durationMinutes: number;
        questions: Array<{
          id: string;
          sequence: number;
          itemType: string;
          difficulty: DifficultyBand;
          promptText: string;
          answerText: string;
          contentJson?: Record<string, unknown> | null;
          objectiveId: string;
          objectiveCode: string;
          objectiveTitle: string;
          strand: string;
          yearGroup: number | null;
          rationale: string;
          vectorTitles: string[];
        }>;
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
      wrapperVectors: WrapperVectorRecord[];
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
      totalMinutes: number;
      sections: Array<{
        key: string;
        title: string;
        purpose: string;
        durationMinutes: number;
        audience: "TUTOR_SCREEN" | "STUDENT_DEVICE";
        mode: string;
        chunkIds: string[];
        canonicalQuestionIds: string[];
      }>;
      sessionBlocks: Array<{
        key: string;
        title: string;
        purpose: string;
        durationMinutes: number;
        audience: "TUTOR_SCREEN" | "STUDENT_DEVICE";
        mode: string;
        chunkIds: string[];
        canonicalQuestionIds: string[];
        objectiveCodes: string[];
        vectorTitles: string[];
      }>;
      personalisedQuestionRounds: Array<{
        key: string;
        title: string;
        purpose: string;
        durationMinutes: number;
        questions: Array<{
          id: string;
          sequence: number;
          itemType: string;
          difficulty: DifficultyBand;
          promptText: string;
          answerText: string;
          contentJson?: Record<string, unknown> | null;
          objectiveId: string;
          objectiveCode: string;
          objectiveTitle: string;
          strand: string;
          yearGroup: number | null;
          rationale: string;
          vectorTitles: string[];
        }>;
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
    learnerSupportFocus?: {
      summary: string;
      items: string[];
      evidenceTitles: string[];
    };
    wrapperVectors: Array<{
      id: string;
      title: string;
      content: string;
      scope: string;
      strand: string | null;
      objectiveCode: string | null;
    }>;
    canonicalCards: Array<{
      id: string;
      sequence: number;
      title: string;
      promptText: string;
      answerText: string;
      contentJson?: Record<string, unknown> | null;
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
        objectiveCode: string | null;
        objectiveTitle: string | null;
        strand: string | null;
        yearGroup: number | null;
        matchReason: string;
        excerpt: string[];
        citations: string[];
        tags: string[];
      }>;
    }>;
    supportSelection: {
      selectedChunkIds: string[];
      autoSelectedChunkIds: string[];
      isCustomSelection: boolean;
    };
    candidateSupportCards: Array<{
      id: string;
      type: string;
      difficulty: DifficultyBand;
      objectiveCode: string | null;
      objectiveTitle: string | null;
      strand: string | null;
      yearGroup: number | null;
      matchScore: number;
      matchReason: string;
      selected: boolean;
      excerpt: string[];
      citations: string[];
      tags: string[];
    }>;
    personalisedQuestionRounds: Array<{
      key: string;
      title: string;
      purpose: string;
      durationMinutes: number;
      questions: Array<{
        id: string;
        sequence: number;
        itemType: string;
        difficulty: DifficultyBand;
        promptText: string;
        answerText: string;
        contentJson?: Record<string, unknown> | null;
        objectiveId: string;
        objectiveCode: string;
        objectiveTitle: string;
        strand: string;
        yearGroup: number | null;
        rationale: string;
        vectorTitles: string[];
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

export type CurriculumObjectiveListResponse = {
  organisation: {
    id: string;
    slug: string;
    name: string;
  };
  filters: {
    subject: string | null;
    keyStage: string | null;
    yearGroup: number | null;
    domain: string | null;
    strand: string | null;
    search: string | null;
    hasContent: boolean | null;
    hasCanonical: boolean | null;
    limit: number;
  };
  count: number;
  items: Array<{
    id: string;
    code: string;
    subject: string;
    keyStage: string;
    yearGroup: number | null;
    strand: string;
    title: string;
    statement: string;
    keywords: string[];
    contentChunkCount: number;
    canonicalQuestionCount: number;
  }>;
};

export type CurriculumStrandSearchResponse = {
  count: number;
  items: Array<{
    subject: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
    keyStage: "KS1" | "KS2" | "KS3" | "KS4";
    yearGroup: number | null;
    strand: string;
    objectiveCount: number;
    contentChunkCount: number;
    canonicalQuestionCount: number;
    objectives: Array<{
      id: string;
      code: string;
      title: string;
      statement: string;
    }>;
  }>;
};

export type BespokeLessonBuildResponse = {
  source: "llm" | "fallback";
  fallbackReason?: string;
  retrieval: {
    topic: string;
    objectiveCount: number;
    chunkCount: number;
    questionCount: number;
    objectives: Array<{
      id: string;
      code: string;
      subject: string;
      keyStage: string;
      yearGroup: number | null;
      strand: string;
      title: string;
      statement: string;
      keywords: string[];
      score: number;
      matchReason: string;
      contentChunkCount: number;
      canonicalQuestionCount: number;
    }>;
    chunks: Array<{
      id: string;
      type: string;
      difficulty: string;
      content: string;
      excerpt: string;
      citations: string[];
      tags: string[];
      objectiveId: string | null;
      objectiveCode: string | null;
      objectiveTitle: string | null;
      strand: string | null;
      yearGroup: number | null;
    }>;
    questions: Array<{
      id: string;
      sequence: number;
      itemType: string;
      difficulty: string;
      promptText: string;
      answerText: string;
      objectiveId: string;
      objectiveCode: string;
      objectiveTitle: string;
      strand: string;
      yearGroup: number | null;
    }>;
  };
  guide: {
    title: string;
    topic: string;
    subject: string;
    keyStage: string | null;
    yearGroup: number | null;
    overview: string;
    learningObjectives: string[];
    keyVocabulary: Array<{ term: string; meaning: string }>;
    lessonSections: Array<{
      title: string;
      durationMinutes: number;
      teacherActions: string[];
      studentActions: string[];
      workedExample?: {
        problem: string;
        steps: string[];
        answer: string;
      };
    }>;
    practice: Array<{
      prompt: string;
      answer: string;
      sourceQuestionId?: string;
    }>;
    checksForUnderstanding: string[];
    misconceptions: Array<{
      misconception: string;
      repair: string;
    }>;
    stretch: string[];
    resources: string[];
  };
};

export type BespokeSectionContentResponse = {
  source: "llm" | "fallback";
  fallbackReason?: string;
  title: string;
  sectionTitle: string;
  durationMinutes: number;
  tutorScript: string[];
  boardContent: string[];
  workedExample?: {
    problem: string;
    steps: string[];
    answer: string;
  };
  guidedPractice: Array<{
    prompt: string;
    answer: string;
  }>;
  checksForUnderstanding: string[];
  supportPrompts: string[];
  stretchPrompt: string;
  exitTicket: {
    prompt: string;
    answer: string;
  };
};

export type LessonPlanResponse = {
  id: string;
  studentId: string | null;
  subject: string;
  keyStage: string | null;
  yearGroup: number | null;
  title: string;
  topic: string;
  status: string;
  source: string;
  assessmentAuthority: string;
  assessmentCadenceWeeks: number;
  objectives: Array<{
    id: string;
    objectiveId: string;
    sequence: number;
    role: string;
    strand: string;
    yearGroup: number | null;
    alignmentConfidence: number;
    alignmentRationale: string;
    assessmentEligible: boolean;
    objective: {
      id: string;
      code: string;
      title: string;
      statement: string;
      strand: string;
      subject: string;
      keyStage: string;
      yearGroup: number | null;
    };
  }>;
  sections: Array<{
    id: string;
    sequence: number;
    phase: string;
    title: string;
    durationMinutes: number;
    source: string;
    teacherActions: string[];
    studentActions: string[];
    workedExampleJson?: unknown;
    boardSpecJson?: unknown;
    practiceSpecJson?: unknown;
    assessmentLinksJson?: unknown;
  }>;
  assessmentBlueprints: Array<{
    id: string;
    cadenceWeeks: number;
    status: string;
    authorityJson: unknown;
    objectiveMixJson: unknown;
    generatedQuestionPolicyJson: unknown;
    quizDraftJson?: unknown;
    reportingJson?: unknown;
  }>;
};


export type LiveLessonFlowBlock = {
  key: string;
  title: string;
  purpose: string;
  durationMinutes: number;
  audience: "TUTOR_SCREEN" | "STUDENT_DEVICE";
  mode: string;
  chunkIds: string[];
  canonicalQuestionIds: string[];
  objectiveCodes?: string[];
  vectorTitles?: string[];
};

export type NeuroTeachingCard = {
  id: string;
  blockKey: string;
  audience: "TUTOR" | "STUDENT";
  title: string;
  source: "llm" | "fallback";
  fallbackReason?: string;
  chunkIds: string[];
  canonicalQuestionIds: string[];
  teachingScript: string[];
  studentFacingSummary: string;
  keyVocabulary: Array<{
    term: string;
    childDefinition: string;
  }>;
  workedExample: {
    title: string;
    steps: string[];
    answerCheck: string;
  };
  guidedPracticePrompts: string[];
  independentPrompt: string;
  microSteps: string[];
  visualModelSuggestion: string;
  visualModel?: {
    source: "oak" | "generated";
    kind: "image" | "svg";
    url?: string;
    svg?: string;
    alt: string;
    caption: string;
    prompt?: string;
  };
  checkForUnderstanding: string;
  likelyMisconception: string;
  repairPrompt: string;
  stretchPrompt: string;
  calmResetPrompt: string;
  tutorNotes: string[];
  sensoryLoad: "LOW" | "MEDIUM";
  neurodiverseSupports: string[];
};

export type LiveLessonMoodCheckIn = {
  moodKey: "ready" | "steady" | "wobbly" | "stretched";
  moodLabel: string;
  pacingHint: string;
  actionLevel?: "NONE" | "LOW_PRESSURE" | "MONITOR" | "INTERVENE";
  studentAction?: "CONTINUE" | "EASY_START" | "CONTINUE_WITH_SUPPORT" | "PAUSE";
  tutorVisibility?: "NONE" | "PRIVATE_NOTE" | "PRIVATE_FLAG" | "PRIVATE_ALERT";
  tutorMessage?: string;
  checkedInAt: string;
};

export type LiveLessonSessionResponse = {
  id: string;
  title: string;
  status: string;
  currentBlockKey: string | null;
  blockStartedAt: string | null;
  startedAt: string | null;
  endedAt: string | null;
  flowJson: {
    totalMinutes: number;
    sessionBlocks: LiveLessonFlowBlock[];
  };
  tutorRuntimeJson: {
    objective?: {
      code: string;
      title: string;
      strand: string;
      yearGroup: number | null;
    };
    objectives?: Array<{
      id: string;
      code: string;
      title: string;
      strand: string;
      yearGroup: number | null;
      role: "ANCHOR" | "WORKED_EXAMPLE" | string;
    }>;
    supportCards?: Array<{
      type: string;
      items: Array<{
        id: string;
        excerpt: string[];
        matchReason: string;
      }>;
    }>;
    neuroTeachingCards?: NeuroTeachingCard[];
  } | null;
  objective: {
    id: string;
    code: string;
    title: string;
    strand: string;
    yearGroup: number | null;
    subject: string;
    keyStage: string;
  };
  participants: Array<{
    id: string;
    status: string;
    currentBlockKey: string | null;
    currentQuestionId: string | null;
    questionsAnswered: number;
    questionsCorrect: number;
    lastActiveAt: string | null;
    runtimeJson: LessonRuntimeResponse["screenPayload"] & {
      neuroTeachingCards?: NeuroTeachingCard[];
    };
    progressJson: Record<string, unknown> | null;
    student: {
      id: string;
      firstName: string | null;
      lastName: string | null;
      age: number;
      schoolYear: number | null;
      user: { email: string };
    };
  }>;
  events: Array<{
    id: string;
    type: string;
    blockKey: string | null;
    payload: Record<string, unknown> | null;
    createdAt: string;
  }>;
};

export type StudentLiveLessonResponse = {
  id: string;
  status: string;
  currentBlockKey: string | null;
  currentQuestionId: string | null;
  questionsAnswered: number;
  questionsCorrect: number;
  runtimeJson: LessonRuntimeResponse["screenPayload"] & {
    neuroTeachingCards?: NeuroTeachingCard[];
  };
  progressJson: Record<string, unknown> | null;
  lessonSession: {
    id: string;
    title: string;
    status: string;
    currentBlockKey: string | null;
    objective: LiveLessonSessionResponse["objective"];
  };
  student: LiveLessonSessionResponse["participants"][number]["student"];
};
