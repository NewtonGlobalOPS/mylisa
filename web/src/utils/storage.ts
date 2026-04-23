import type { StoredAssessmentState, StudentOnboardingResponse } from "../types/assessment";

const KEY = "mylisa_assessment_state_v1";

export function loadState(): StoredAssessmentState {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) {
      return {
        student: null,
        sessionId: "",
        entryYear: null,
        currentQuestion: null,
        result: null,
        askedCount: 0,
        ndscreenSessionId: "",
        authToken: "",
      };
    }
    return JSON.parse(raw) as StoredAssessmentState;
  } catch {
    return {
      student: null,
      sessionId: "",
      entryYear: null,
      currentQuestion: null,
      result: null,
      askedCount: 0,
      ndscreenSessionId: "",
      authToken: "",
    };
  }
}

export function saveState(next: StoredAssessmentState) {
  localStorage.setItem(KEY, JSON.stringify(next));
}

export function clearState() {
  localStorage.removeItem(KEY);
}

export function saveStudent(student: StudentOnboardingResponse) {
  const state = loadState();
  saveState({ ...state, student });
}

export function saveStudentFromLookup(input: {
  userId: string;
  studentId: string;
  email: string;
  firstName?: string | null;
  lastName?: string | null;
  age: number;
  schoolYear: number;
  keyStage?: string | null;
  subjects: string[];
  guardianEmail?: string | null;
}) {
  const state = loadState();
  saveState({
    ...state,
    student: {
      message: "Loaded from dashboard lookup",
      userId: input.userId,
      studentId: input.studentId,
      email: input.email,
      student: {
        id: input.studentId,
        firstName: input.firstName ?? undefined,
        lastName: input.lastName ?? undefined,
        age: input.age,
        schoolYear: input.schoolYear,
        keyStage: input.keyStage ?? undefined,
        subjects: input.subjects,
        guardianEmail: input.guardianEmail ?? undefined,
      },
    },
  });
}

export function saveNdscreenSessionId(ndscreenSessionId: string) {
  const state = loadState();
  saveState({ ...state, ndscreenSessionId });
}

export function saveAuthToken(authToken: string) {
  const state = loadState();
  saveState({ ...state, authToken });
}

export function getAuthToken(): string {
  return loadState().authToken ?? "";
}
