import type {
  AssessmentAnswerResponse,
  AssessmentSessionSummary,
  AssessmentStartResponse,
  CombinedChildProfileResponse,
  DashboardLearnerLookupResponse,
  LessonRuntimeResponse,
  StudentOnboardingResponse,
} from "../types/assessment";
import { getAuthToken } from "../utils/storage";

const API_BASE =
  import.meta.env.VITE_API_BASE?.replace(/\/$/, "") ?? "http://localhost:4010";

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const token = getAuthToken();
  const res = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });

  const data = await res.json().catch(() => null);

  if (!res.ok) {
    throw new Error(data?.error ?? `Request failed: ${res.status}`);
  }

  return data as T;
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

export async function startAssessment(input: {
  studentId: string;
  childCurrentYear: number;
}): Promise<AssessmentStartResponse> {
  return apiFetch<AssessmentStartResponse>("/api/assessment/start", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export async function submitAssessmentAnswer(input: {
  sessionId: string;
  questionId: string;
  selectedChoiceKey: "A" | "B" | "C" | "D";
}): Promise<AssessmentAnswerResponse> {
  return apiFetch<AssessmentAnswerResponse>("/api/assessment/answer", {
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
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
}): Promise<CombinedChildProfileResponse> {
  const params = new URLSearchParams({
    studentId: input.studentId,
  });

  if (input.assessmentSessionId) {
    params.set("assessmentSessionId", input.assessmentSessionId);
  }

  if (input.ndscreenSessionId) {
    params.set("ndscreenSessionId", input.ndscreenSessionId);
  }

  return apiFetch<CombinedChildProfileResponse>(
    `/api/profile/child-summary?${params.toString()}`
  );
}

export async function getLessonRuntimeByObjective(input: {
  objectiveId: string;
  studentId: string;
  assessmentSessionId?: string;
  ndscreenSessionId?: string;
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

  return apiFetch<LessonRuntimeResponse>(
    `/api/curriculum/objectives/${encodeURIComponent(input.objectiveId)}/runtime?${params.toString()}`
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
