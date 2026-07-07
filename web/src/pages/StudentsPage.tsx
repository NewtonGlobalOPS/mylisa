import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import {
  downloadProgressReport,
  endLiveLesson,
  getLearnerJourney,
  getNewtonCentreTimetableGroups,
  startAssessment,
} from "../api/assessmentApi";
import type {
  LearnerJourneyItem,
  LearnerJourneyResponse,
  NewtonCentreTimetableGroupsResponse,
} from "../types/assessment";
import {
  loadState,
  saveNdscreenSessionId,
  saveState,
  saveStudentFromLookup,
} from "../utils/storage";
import { normaliseAssessmentYear } from "../utils/schoolYear";

type TimetableStudent = NewtonCentreTimetableGroupsResponse["groups"][number]["students"][number] & {
  groupId: string;
  groupTitle: string;
  dayLabel: string;
  startTime: string;
  subject: string;
  keyStage: string | null;
};

type AssessmentSubject = "MATHS" | "SCIENCE";
const ASSESSMENT_SUBJECTS: AssessmentSubject[] = ["MATHS", "SCIENCE"];

function defaultAssessmentSubject(subjects: string[]): AssessmentSubject {
  return subjects.includes("SCIENCE") && !subjects.includes("MATHS") ? "SCIENCE" : "MATHS";
}

function saveLearnerWorkspace(item: LearnerJourneyItem) {
  saveStudentFromLookup({
    userId: item.userId,
    studentId: item.studentId,
    email: item.userEmail,
    firstName: item.firstName,
    lastName: item.lastName,
    age: item.age,
    schoolYear: item.schoolYear ?? item.age - 4,
    keyStage: item.keyStage,
    subjects: item.subjects,
    guardianEmail: item.guardianEmail,
  });
  saveNdscreenSessionId(item.ndscreenSessionId ?? "");
  saveState({
    ...loadState(),
    subject: item.latestAssessment?.subject ?? defaultAssessmentSubject(item.subjects),
    sessionId: item.latestAssessment?.id ?? "",
    currentQuestion: null,
    result: null,
    askedCount: 0,
  });
}

function learnerStatus(item: LearnerJourneyItem | null, timetableStudent: TimetableStudent) {
  if (!timetableStudent.mylisaStudentId) return "Needs MyLisa link";
  if (!item) return "Mapped, no journey data";
  if (item.hasCompletedAssessment) return "Ready for lesson";
  if (item.hasAssessmentInProgress) return "Assessment in progress";
  return "Needs assessment";
}

function missingAssessmentSubjects(item: LearnerJourneyItem): AssessmentSubject[] {
  const completedSubjects = new Set(item.completedAssessmentSubjects);
  return ASSESSMENT_SUBJECTS.filter((subject) => !completedSubjects.has(subject));
}

function formatPercent(value: number | null | undefined) {
  return typeof value === "number" ? `${Math.round(value * 100)}%` : "n/a";
}

function formatShortDate(value: string | null | undefined) {
  if (!value) return "No session";
  return new Date(value).toLocaleDateString(undefined, { day: "2-digit", month: "short" });
}

function progressWindowLabel(window: LearnerJourneyItem["progressReport"]["today"]) {
  if (!window.lessonCount) return "0 lessons";
  if (!window.questionsAnswered) return `${window.lessonCount} lesson${window.lessonCount === 1 ? "" : "s"}`;
  return `${window.questionsCorrect}/${window.questionsAnswered} · ${formatPercent(window.accuracy)}`;
}

export default function StudentsPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [subject, setSubject] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [startingAssessmentStudentId, setStartingAssessmentStudentId] = useState("");
  const [downloadingProgressStudentId, setDownloadingProgressStudentId] = useState("");
  const [endingLessonSessionId, setEndingLessonSessionId] = useState("");
  const [expandedStartedLessonStudentIds, setExpandedStartedLessonStudentIds] = useState<string[]>([]);
  const [error, setError] = useState("");
  const [journey, setJourney] = useState<LearnerJourneyResponse | null>(null);
  const [groups, setGroups] = useState<NewtonCentreTimetableGroupsResponse | null>(null);

  async function loadStudents() {
    setLoading(true);
    setError("");
    try {
      const [nextJourney, nextGroups] = await Promise.all([
        getLearnerJourney({ query: query.trim() || undefined, limit: 100 }),
        getNewtonCentreTimetableGroups(),
      ]);
      setJourney(nextJourney);
      setGroups(nextGroups);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load students");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadStudents();
  }, [query]);

  const journeyByStudentId = useMemo(
    () => new Map((journey?.items ?? []).map((item) => [item.studentId, item])),
    [journey],
  );

  const timetableStudents = useMemo<TimetableStudent[]>(() => {
    const rows = (groups?.groups ?? []).flatMap((group) =>
      group.students.map((student) => ({
        ...student,
        groupId: group.id,
        groupTitle: group.title,
        dayLabel: group.dayLabel,
        startTime: group.startTime,
        subject: group.subject,
        keyStage: group.keyStage,
      })),
    );

    const seen = new Set<string>();
    return rows
      .filter((student) => {
        const key = student.mylisaStudentId ?? student.remoteStudentId;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [groups]);

  const subjectOptions = useMemo(
    () => Array.from(new Set(timetableStudents.map((item) => item.subject))).sort((a, b) => a.localeCompare(b)),
    [timetableStudents],
  );

  const visibleStudents = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return timetableStudents.filter((student) => {
      if (subject !== "ALL" && student.subject !== subject) return false;
      if (!normalizedQuery) return true;
      return [
        student.displayName,
        student.workspaceEmail,
        student.groupTitle,
        student.parentEmails.join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [query, subject, timetableStudents]);

  const readyCount = visibleStudents.filter((student) =>
    student.mylisaStudentId
      ? journeyByStudentId.get(student.mylisaStudentId)?.hasCompletedAssessment
      : false,
  ).length;
  const unmappedCount = visibleStudents.filter((student) => !student.mylisaStudentId).length;

  function openLessonBuilder(item: LearnerJourneyItem, groupId?: string) {
    saveLearnerWorkspace(item);
    const params = new URLSearchParams({ studentId: item.studentId });
    if (groupId) params.set("groupId", groupId);
    navigate(`/lesson-builder?${params.toString()}`);
  }

  function openReport(item: LearnerJourneyItem) {
    saveLearnerWorkspace(item);
    navigate(item.hasCompletedAssessment ? "/report" : "/ready");
  }

  async function beginAssessment(item: LearnerJourneyItem, assessmentSubject = defaultAssessmentSubject(item.subjects)) {
    saveLearnerWorkspace(item);
    setStartingAssessmentStudentId(item.studentId);
    setError("");
    try {
      const started = await startAssessment({
        studentId: item.studentId,
        childCurrentYear: normaliseAssessmentYear(item.schoolYear, item.age),
        subject: assessmentSubject,
      });
      saveState({
        ...loadState(),
        subject: started.subject,
        sessionId: started.sessionId,
        entryYear: started.entryYear,
        currentQuestion: started.firstQuestion,
        result: null,
        askedCount: 0,
      });
      navigate("/assessment");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start assessment");
    } finally {
      setStartingAssessmentStudentId("");
    }
  }

  async function downloadParentProgressReport(item: LearnerJourneyItem) {
    setDownloadingProgressStudentId(item.studentId);
    setError("");
    try {
      const blob = await downloadProgressReport({
        studentId: item.studentId,
        subject: defaultAssessmentSubject(item.subjects),
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      const safeName = item.displayName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
      link.href = url;
      link.download = `${safeName || "student"}-progress-report.pdf`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to download progress report");
    } finally {
      setDownloadingProgressStudentId("");
    }
  }

  async function endStartedLesson(lessonSessionId: string) {
    setEndingLessonSessionId(lessonSessionId);
    setError("");
    try {
      await endLiveLesson({ lessonSessionId });
      await loadStudents();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to end lesson");
    } finally {
      setEndingLessonSessionId("");
    }
  }

  function toggleStartedLessons(studentId: string) {
    setExpandedStartedLessonStudentIds((current) =>
      current.includes(studentId)
        ? current.filter((id) => id !== studentId)
        : [...current, studentId],
    );
  }

  function continueStartedLesson(lessonSessionId: string) {
    navigate(`/tutor/live-lessons/${encodeURIComponent(lessonSessionId)}`);
  }

  return (
    <Layout
      title="Students"
      subtitle="A single operational list of timetabled learners, mapped MyLisa records, evidence status, and next actions."
      kicker="MyLisa"
    >
      {error ? <div className="error-box" style={{ marginBottom: 20 }}>{error}</div> : null}

      <section className="workspace-panel">
        <div className="workspace-toolbar">
          <div>
            <h2>Timetabled Students</h2>
            <p className="meta">Move from learner to action without returning to the dashboard.</p>
          </div>
          <div className="button-row">
            <button className="btn btn-secondary" onClick={() => navigate("/timetable")}>Timetable</button>
            <button className="btn btn-primary" onClick={() => navigate("/lesson-builder")}>New lesson</button>
          </div>
        </div>
        <div className="dashboard-readiness student-kpis">
          <div><strong>{visibleStudents.length}</strong><span className="meta">students shown</span></div>
          <div><strong>{readyCount}</strong><span className="meta">lesson ready</span></div>
          <div><strong>{unmappedCount}</strong><span className="meta">unmapped</span></div>
          <div><strong>{journey?.count ?? 0}</strong><span className="meta">MyLisa learners</span></div>
        </div>
        <div className="student-filter-bar">
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search student, guardian, email, or group"
          />
          <select className="input" value={subject} onChange={(event) => setSubject(event.target.value)}>
            <option value="ALL">All subjects</option>
            {subjectOptions.map((item) => (
              <option key={item} value={item}>{item}</option>
            ))}
          </select>
        </div>
      </section>

      <div style={{ height: 16 }} />

      <section className="student-table">
        {visibleStudents.map((student) => {
          const item = student.mylisaStudentId ? journeyByStudentId.get(student.mylisaStudentId) ?? null : null;
          const status = learnerStatus(item, student);
          const activeLessons = item?.progressReport.activeLessons ?? [];
          const startedLessonsOpen = item ? expandedStartedLessonStudentIds.includes(item.studentId) : false;
          return (
            <article key={`${student.groupId}-${student.remoteStudentId}`} className="student-row">
              <div className="student-main">
                <strong>{student.displayName}</strong>
                <p className="meta">
                  {student.groupTitle} · {student.dayLabel} {student.startTime} · {student.subject}
                  {student.keyStage ? ` · ${student.keyStage}` : ""}
                </p>
                <p className="meta">
                  {student.workspaceEmail ?? "No workspace email"}
                  {student.parentEmails.length ? ` · ${student.parentEmails.join(", ")}` : ""}
                </p>
              </div>
              <div className="student-status">
                <span className={`pill ${status === "Ready for lesson" ? "pill-success" : ""}`}>{status}</span>
                {item?.activeWrapperVectorCount ? (
                  <span className="meta">{item.activeWrapperVectorCount} active support vectors</span>
                ) : null}
                {item?.progressReport ? (
                  <div className="student-progress-report" aria-label={`${student.displayName} progress report`}>
                    <div className="student-progress-latest">
                      <span className="meta">Latest</span>
                      <strong>{item.progressReport.latestSession?.status ?? "No session"}</strong>
                      <span className="meta">
                        {item.progressReport.latestSession
                          ? `${formatShortDate(item.progressReport.latestSession.activityAt)} · ${item.progressReport.latestSession.questionsCorrect}/${item.progressReport.latestSession.questionsAnswered || 0}`
                          : "No lesson activity"}
                      </span>
                    </div>
                    <div className="student-progress-windows">
                      <span><strong>Today</strong>{progressWindowLabel(item.progressReport.today)}</span>
                      <span><strong>7 days</strong>{progressWindowLabel(item.progressReport.week)}</span>
                      <span><strong>30 days</strong>{progressWindowLabel(item.progressReport.month)}</span>
                    </div>
                    {activeLessons.length ? (
                      <div className="student-live-lessons">
                        <button
                          type="button"
                          className="student-live-lessons-toggle"
                          aria-expanded={startedLessonsOpen}
                          onClick={() => toggleStartedLessons(item.studentId)}
                        >
                          <span>Started lessons ({activeLessons.length})</span>
                          <strong>{startedLessonsOpen ? "Hide" : "Show"}</strong>
                        </button>
                        {startedLessonsOpen
                          ? activeLessons.map((lesson) => (
                              <div className="student-live-lesson" key={lesson.id}>
                                <div>
                                  <strong>{lesson.title}</strong>
                                  <span className="meta">
                                    {lesson.status} · {formatShortDate(lesson.activityAt)} · {lesson.questionsCorrect}/{lesson.questionsAnswered || 0}
                                  </span>
                                </div>
                                <div className="student-live-lesson-actions">
                                  <button
                                    className="btn btn-primary"
                                    onClick={() => continueStartedLesson(lesson.id)}
                                  >
                                    Continue lesson
                                  </button>
                                  <button
                                    className="btn btn-secondary"
                                    disabled={Boolean(endingLessonSessionId)}
                                    onClick={() => void endStartedLesson(lesson.id)}
                                  >
                                    {endingLessonSessionId === lesson.id ? "Ending..." : "End lesson"}
                                  </button>
                                </div>
                              </div>
                            ))
                          : null}
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </div>
              <div className="student-actions">
                {item ? (
                  <>
                    <button className="btn btn-primary" onClick={() => openLessonBuilder(item, student.groupId)}>
                      Build lesson
                    </button>
                    <button className="btn btn-secondary" onClick={() => openReport(item)}>
                      {item.hasCompletedAssessment ? "Report" : "Open profile"}
                    </button>
                    <button
                      className="btn btn-secondary"
                      disabled={downloadingProgressStudentId === item.studentId}
                      onClick={() => void downloadParentProgressReport(item)}
                    >
                      {downloadingProgressStudentId === item.studentId ? "Preparing..." : "Progress report"}
                    </button>
                    {!item.hasCompletedAssessment ? (
                      <button
                        className="btn btn-secondary"
                        disabled={startingAssessmentStudentId === item.studentId}
                        onClick={() => void beginAssessment(item)}
                      >
                        {startingAssessmentStudentId === item.studentId ? "Starting..." : "Assess"}
                      </button>
                    ) : null}
                    {item.hasCompletedAssessment
                      ? missingAssessmentSubjects(item).map((assessmentSubject) => (
                          <button
                            key={assessmentSubject}
                            className="btn btn-secondary"
                            disabled={startingAssessmentStudentId === item.studentId}
                            onClick={() => void beginAssessment(item, assessmentSubject)}
                          >
                            {startingAssessmentStudentId === item.studentId
                              ? "Starting..."
                              : `Assess ${assessmentSubject === "SCIENCE" ? "Science" : "Maths"}`}
                          </button>
                        ))
                      : null}
                  </>
                ) : (
                  <button className="btn btn-secondary" disabled>
                    Link required
                  </button>
                )}
              </div>
            </article>
          );
        })}
        {!loading && !visibleStudents.length ? (
          <div className="workspace-panel"><p className="meta">No timetabled students match this view.</p></div>
        ) : null}
        {loading ? (
          <div className="workspace-panel"><p className="meta">Loading students...</p></div>
        ) : null}
      </section>
    </Layout>
  );
}
