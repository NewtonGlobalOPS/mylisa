import type {
  AssessmentAnswerResponse,
  AssessmentSessionSummary,
  AssessmentStartResponse,
  AuthLoginResponse,
  CombinedChildProfileResponse,
  CurriculumObjectiveListResponse,
  CurriculumStrandSearchResponse,
  BespokeLessonBuildResponse,
  BespokeSectionContentResponse,
  DashboardLearnerLookupResponse,
  LearnerJourneyResponse,
  NdscreenDashboardResponse,
  LessonPlanResponse,
  LessonRuntimeResponse,
  LiveLessonMoodCheckIn,
  StoredReportSummary,
  StudentOnboardingResponse,
  WrapperVectorRecord,
  LiveLessonSessionResponse,
  NewtonCentreTimetableGroupsResponse,
  StudentLiveLessonResponse,
} from "../types/assessment";
import { clearAuthToken, getAuthToken } from "../utils/storage";

export class ApiError extends Error {
  status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function defaultApiBase(): string {
  if (typeof window === "undefined") {
    return "http://localhost:4010";
  }

  const { protocol, hostname } = window.location;
  return `${protocol}//${hostname}:4010`;
}

const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ?? defaultApiBase();
const API_KEY = import.meta.env.VITE_API_KEY?.trim() ?? "";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(API_KEY ? { "x-api-key": API_KEY } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    const issueSummary = Array.isArray(data?.issues)
      ? data.issues
          .slice(0, 3)
          .map((issue: { path?: unknown[]; message?: string }) => {
            const path = Array.isArray(issue.path) && issue.path.length
              ? issue.path.join(".")
              : "request";
            return `${path}: ${issue.message ?? "Invalid value"}`;
          })
          .join("; ")
      : "";
    const message = issueSummary
      ? `${data?.error ?? `Request failed: ${res.status}`} - ${issueSummary}`
      : data?.error ?? `Request failed: ${res.status}`;
    if (res.status === 401 && (message === "Invalid token" || message === "Missing token")) {
      clearAuthToken();
    }
    throw new ApiError(message, res.status);
  }

  return data as T;
}

async function apiBlob(path: string, init?: RequestInit): Promise<Blob> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      ...(API_KEY ? { "x-api-key": API_KEY } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  if (!res.ok) {
    const data = await res.json().catch(() => null);
    throw new ApiError(data?.error ?? `Request failed: ${res.status}`, res.status);
  }

  return res.blob();
}

export async function createStudent(input: {
  email: string;
  password?: string;
  firstName?: string;
  lastName?: string;
  age: number;
  schoolYear: number;
  subjects: Array<"MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH">;
  guardianEmail?: string;
}): Promise<StudentOnboardingResponse> {
  return apiFetch<StudentOnboardingResponse>("/api/onboarding/student", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function importStudentFromNdscreen(sessionId: string): Promise<StudentOnboardingResponse> {
  return apiFetch<StudentOnboardingResponse>("/api/onboarding/from-ndscreen", {
    method: "POST",
    body: JSON.stringify({ sessionId }),
  });
}

export async function startAssessment(input: {
  studentId: string;
  childCurrentYear: number;
  subject?: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
}): Promise<AssessmentStartResponse> {
  return apiFetch<AssessmentStartResponse>("/api/assessment/start", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function submitAssessmentAnswer(input: {
  sessionId: string;
  questionId: string;
  selectedChoiceKey?: string;
  selectedChoiceKeys?: string[];
  rawAnswer?: string;
  matchPairs?: Array<{ left: string; right: string }>;
  orderedAnswers?: string[];
}): Promise<AssessmentAnswerResponse> {
  return apiFetch<AssessmentAnswerResponse>("/api/assessment/answer", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function skipAssessmentQuestion(input: {
  sessionId: string;
  questionId: string;
}): Promise<AssessmentAnswerResponse> {
  return apiFetch<AssessmentAnswerResponse>("/api/assessment/skip", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getAssessmentSession(
  sessionId: string
): Promise<AssessmentSessionSummary> {
  return apiFetch<AssessmentSessionSummary>(`/api/assessment/${sessionId}`);
}

export async function getCombinedChildProfile(input: {
  studentId: string;
  subject?: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
}): Promise<CombinedChildProfileResponse> {
  const params = new URLSearchParams({
    studentId: input.studentId,
  });

  if (input.assessmentSessionId) {
    params.set("assessmentSessionId", input.assessmentSessionId);
  }

  if (input.subject) {
    params.set("subject", input.subject);
  }

  if (input.ndscreenSessionId) {
    params.set("ndscreenSessionId", input.ndscreenSessionId);
  }

  return apiFetch<CombinedChildProfileResponse>(
    `/api/profile/child-summary?${params.toString()}`
  );
}

export function apiUrl(path: string): string {
  return `${API_BASE}${path.startsWith("/") ? path : `/${path}`}`;
}

export async function createStoredReport(input: {
  studentId: string;
  subject?: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
}): Promise<{ report: StoredReportSummary }> {
  return apiFetch<{ report: StoredReportSummary }>("/api/reports", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function listStoredReports(input: {
  studentId: string;
  subject?: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
}): Promise<{ reports: StoredReportSummary[] }> {
  const params = new URLSearchParams({
    studentId: input.studentId,
  });

  if (input.subject) params.set("subject", input.subject);

  return apiFetch<{ reports: StoredReportSummary[] }>(
    `/api/reports?${params.toString()}`
  );
}

export async function downloadProgressReport(input: {
  studentId: string;
  subject?: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
}): Promise<Blob> {
  const params = new URLSearchParams({ studentId: input.studentId });
  if (input.subject) params.set("subject", input.subject);
  return apiBlob(`/api/reports/progress/pdf?${params.toString()}`);
}

export async function getLessonRuntimeByObjective(input: {
  objectiveId: string;
  studentId: string;
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
  selectedChunkIds?: string[];
}): Promise<LessonRuntimeResponse> {
  const params = new URLSearchParams({
    studentId: input.studentId,
  });

  if (input.assessmentSessionId) {
    params.set("assessmentSessionId", input.assessmentSessionId);
  }

  if (input.ndscreenSessionId) {
    params.set("ndscreenSessionId", input.ndscreenSessionId);
  }

  if (input.selectedChunkIds?.length) {
    params.set("selectedChunkIds", input.selectedChunkIds.join(","));
  }

  return apiFetch<LessonRuntimeResponse>(
    `/api/curriculum/objectives/${encodeURIComponent(input.objectiveId)}/runtime?${params.toString()}`
  );
}

export async function listCurriculumObjectives(input?: {
  subject?: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
  keyStage?: "KS1" | "KS2" | "KS3" | "KS4";
  yearGroup?: number;
  domain?: "NUMBER" | "ALGEBRA" | "GEOMETRY" | "DATA" | "RATIO" | "PROBABILITY";
  strand?: string;
  search?: string;
  hasContent?: boolean;
  hasCanonical?: boolean;
  limit?: number;
}): Promise<CurriculumObjectiveListResponse> {
  const params = new URLSearchParams();

  if (input?.subject) params.set("subject", input.subject);
  if (input?.keyStage) params.set("keyStage", input.keyStage);
  if (typeof input?.yearGroup === "number") params.set("yearGroup", String(input.yearGroup));
  if (input?.domain) params.set("domain", input.domain);
  if (input?.strand?.trim()) params.set("strand", input.strand.trim());
  if (input?.search?.trim()) params.set("search", input.search.trim());
  if (typeof input?.hasContent === "boolean") params.set("hasContent", String(input.hasContent));
  if (typeof input?.hasCanonical === "boolean") params.set("hasCanonical", String(input.hasCanonical));
  if (typeof input?.limit === "number") params.set("limit", String(input.limit));

  return apiFetch<CurriculumObjectiveListResponse>(
    `/api/curriculum/objectives?${params.toString()}`
  );
}

export async function searchCurriculumStrands(input?: {
  subject?: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
  keyStage?: "KS1" | "KS2" | "KS3" | "KS4";
  yearGroup?: number;
  domain?: "NUMBER" | "ALGEBRA" | "GEOMETRY" | "DATA" | "RATIO" | "PROBABILITY";
  strand?: string;
  search?: string;
  hasContent?: boolean;
  hasCanonical?: boolean;
  limit?: number;
}): Promise<CurriculumStrandSearchResponse> {
  const params = new URLSearchParams();

  if (input?.subject) params.set("subject", input.subject);
  if (input?.keyStage) params.set("keyStage", input.keyStage);
  if (typeof input?.yearGroup === "number") params.set("yearGroup", String(input.yearGroup));
  if (input?.domain) params.set("domain", input.domain);
  if (input?.strand?.trim()) params.set("strand", input.strand.trim());
  if (input?.search?.trim()) params.set("search", input.search.trim());
  if (typeof input?.hasContent === "boolean") params.set("hasContent", String(input.hasContent));
  if (typeof input?.hasCanonical === "boolean") params.set("hasCanonical", String(input.hasCanonical));
  if (typeof input?.limit === "number") params.set("limit", String(input.limit));

  return apiFetch<CurriculumStrandSearchResponse>(
    `/api/curriculum/strands?${params.toString()}`
  );
}

export async function buildBespokeLesson(input: {
  topic: string;
  subject?: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
  keyStage?: "KS1" | "KS2" | "KS3" | "KS4";
  yearGroup?: number;
  domain?: "NUMBER" | "ALGEBRA" | "GEOMETRY" | "DATA" | "RATIO" | "PROBABILITY";
  maxObjectives?: number;
}): Promise<BespokeLessonBuildResponse> {
  return apiFetch<BespokeLessonBuildResponse>("/api/curriculum/bespoke-lesson", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function generateBespokeSectionContent(input: {
  topic: string;
  subject?: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
  keyStage?: "KS1" | "KS2" | "KS3" | "KS4" | null;
  yearGroup?: number | null;
  guideTitle?: string;
  section: BespokeLessonBuildResponse["guide"]["lessonSections"][number];
  objectives?: Array<{
    code: string;
    title: string;
    statement: string;
    strand: string;
    keyStage: "KS1" | "KS2" | "KS3" | "KS4";
    yearGroup: number | null;
  }>;
  questions?: Array<{
    id: string;
    promptText: string;
    answerText: string;
    difficulty: string;
    objectiveCode: string;
  }>;
}): Promise<BespokeSectionContentResponse> {
  return apiFetch<BespokeSectionContentResponse>(
    "/api/curriculum/bespoke-lesson/section-content",
    {
      method: "POST",
      body: JSON.stringify(input),
    },
  );
}

export async function searchDashboardLearners(input?: {
  query?: string;
  limit?: number;
}): Promise<DashboardLearnerLookupResponse> {
  const params = new URLSearchParams();

  if (input?.query?.trim()) {
    params.set("query", input.query.trim());
  }

  if (typeof input?.limit === "number") {
    params.set("limit", String(input.limit));
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<DashboardLearnerLookupResponse>(`/api/dashboard/learners${suffix}`);
}

export async function getLearnerJourney(input?: {
  query?: string;
  limit?: number;
}): Promise<LearnerJourneyResponse> {
  const params = new URLSearchParams();

  if (input?.query?.trim()) {
    params.set("query", input.query.trim());
  }

  if (typeof input?.limit === "number") {
    params.set("limit", String(input.limit));
  }

  const suffix = params.toString() ? `?${params.toString()}` : "";
  return apiFetch<LearnerJourneyResponse>(`/api/dashboard/journey${suffix}`);
}

export async function getNdscreenChildrenDashboard(): Promise<NdscreenDashboardResponse> {
  return apiFetch<NdscreenDashboardResponse>("/api/dashboard/ndscreen-children");
}

export async function getNewtonCentreTimetableGroups(): Promise<NewtonCentreTimetableGroupsResponse> {
  const params = new URLSearchParams({ refresh: String(Date.now()) });
  return apiFetch<NewtonCentreTimetableGroupsResponse>(
    `/api/integrations/newtoncentre/timetable/groups?${params.toString()}`,
    { cache: "no-store" }
  );
}

export async function getWrapperVectors(studentId: string): Promise<{
  studentId: string;
  count: number;
  items: WrapperVectorRecord[];
}> {
  const params = new URLSearchParams({ studentId });
  return apiFetch<{
    studentId: string;
    count: number;
    items: WrapperVectorRecord[];
  }>(`/api/profile/wrapper-vectors?${params.toString()}`);
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
}): Promise<WrapperVectorRecord> {
  return apiFetch<WrapperVectorRecord>("/api/profile/wrapper-vectors", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createInterestFactors(input: {
  studentId: string;
  category: string;
  primaryFactor: string;
  secondaryFactor: string;
  notes?: string;
}): Promise<{
  studentId: string;
  category: string;
  vectors: WrapperVectorRecord[];
}> {
  return apiFetch("/api/profile/interest-factors", {
    method: "POST",
    body: JSON.stringify(input),
  });
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
}): Promise<WrapperVectorRecord> {
  return apiFetch<WrapperVectorRecord>(
    `/api/profile/wrapper-vectors/${encodeURIComponent(input.vectorId)}`,
    {
      method: "PATCH",
      body: JSON.stringify({
        title: input.title,
      content: input.content,
      scope: input.scope,
      source: input.source,
      strand: input.strand,
      objectiveId: input.objectiveId,
      sortOrder: input.sortOrder,
      isActive: input.isActive,
    }),
    }
  );
}

export async function deleteWrapperVector(vectorId: string): Promise<WrapperVectorRecord> {
  return apiFetch<WrapperVectorRecord>(`/api/profile/wrapper-vectors/${encodeURIComponent(vectorId)}`, {
    method: "DELETE",
  });
}


export async function createMathsCoursePlan(input: {
  studentId: string;
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
}) {
  return apiFetch("/api/course-plans/maths/from-assessment", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createLessonPlanFromTopic(input: {
  studentId: string;
  topic: string;
  subject?: "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
  keyStage?: "KS1" | "KS2" | "KS3" | "KS4";
  yearGroup?: number;
  domain?: "NUMBER" | "ALGEBRA" | "GEOMETRY" | "DATA" | "RATIO" | "PROBABILITY";
  maxObjectives?: number;
  assessmentCadenceWeeks?: number;
}): Promise<LessonPlanResponse> {
  return apiFetch<LessonPlanResponse>("/api/lesson-plans/from-topic", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function createLiveLesson(input: {
  objectiveId: string;
  studentIds: string[];
  coursePlanId?: string;
  lessonPlanId?: string;
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
  selectedChunkIds?: string[];
  title?: string;
}): Promise<LiveLessonSessionResponse> {
  return apiFetch<LiveLessonSessionResponse>("/api/live-lessons", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function getLiveLesson(lessonSessionId: string): Promise<LiveLessonSessionResponse> {
  return apiFetch<LiveLessonSessionResponse>(`/api/live-lessons/${encodeURIComponent(lessonSessionId)}`);
}

export async function advanceLiveLessonBlock(input: {
  lessonSessionId: string;
  blockKey: string;
}): Promise<LiveLessonSessionResponse> {
  return apiFetch<LiveLessonSessionResponse>(
    `/api/live-lessons/${encodeURIComponent(input.lessonSessionId)}/blocks`,
    {
      method: "POST",
      body: JSON.stringify({ blockKey: input.blockKey }),
    }
  );
}

export async function completeLiveLessonObjective(input: {
  lessonSessionId: string;
}): Promise<LiveLessonSessionResponse> {
  return apiFetch<LiveLessonSessionResponse>(
    `/api/live-lessons/${encodeURIComponent(input.lessonSessionId)}/complete-objective`,
    {
      method: "POST",
    }
  );
}

export async function endLiveLesson(input: {
  lessonSessionId: string;
}): Promise<LiveLessonSessionResponse> {
  return apiFetch<LiveLessonSessionResponse>(
    `/api/live-lessons/${encodeURIComponent(input.lessonSessionId)}/end`,
    {
      method: "POST",
    }
  );
}

export async function regenerateLiveLessonTeachingCards(input: {
  lessonSessionId: string;
}): Promise<LiveLessonSessionResponse> {
  return apiFetch<LiveLessonSessionResponse>(
    `/api/live-lessons/${encodeURIComponent(input.lessonSessionId)}/regenerate-teaching-cards`,
    {
      method: "POST",
    }
  );
}

export async function getStudentLiveLesson(input: {
  lessonSessionId: string;
  studentId: string;
}): Promise<StudentLiveLessonResponse> {
  return apiFetch<StudentLiveLessonResponse>(
    `/api/live-lessons/${encodeURIComponent(input.lessonSessionId)}/students/${encodeURIComponent(input.studentId)}`
  );
}

export async function submitLiveLessonMood(input: {
  lessonSessionId: string;
  studentId: string;
  moodKey: LiveLessonMoodCheckIn["moodKey"];
  moodLabel: string;
  pacingHint: string;
}): Promise<{ moodCheckIn: LiveLessonMoodCheckIn }> {
  return apiFetch<{ moodCheckIn: LiveLessonMoodCheckIn }>(
    `/api/live-lessons/${encodeURIComponent(input.lessonSessionId)}/mood`,
    {
      method: "POST",
      body: JSON.stringify({
        studentId: input.studentId,
        moodKey: input.moodKey,
        moodLabel: input.moodLabel,
        pacingHint: input.pacingHint,
      }),
    }
  );
}


export async function submitLiveLessonAnswer(input: {
  lessonSessionId: string;
  studentId: string;
  questionId: string;
  answerText: string;
}): Promise<{ isCorrect: boolean; correctAnswer: string }> {
  return apiFetch<{ isCorrect: boolean; correctAnswer: string }>(
    `/api/live-lessons/${encodeURIComponent(input.lessonSessionId)}/answers`,
    {
      method: "POST",
      body: JSON.stringify({
        studentId: input.studentId,
        questionId: input.questionId,
        answerText: input.answerText,
      }),
    }
  );
}


export async function login(input: { email: string; password: string }): Promise<AuthLoginResponse> {
  return apiFetch("/api/auth/login", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function loginStudentWithGoogle(idToken: string): Promise<AuthLoginResponse> {
  return apiFetch("/api/auth/google/student", {
    method: "POST",
    body: JSON.stringify({ idToken }),
  });
}
