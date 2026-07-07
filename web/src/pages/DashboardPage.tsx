import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import {
  getLearnerJourney,
  getNewtonCentreTimetableGroups,
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

type TimetableGroup = NewtonCentreTimetableGroupsResponse["groups"][number];

const TIMETABLE_READY_SOURCES = ["REMOTE_API", "REMOTE_API_CACHE", "REMOTE_DB"];

function defaultAssessmentSubject(subjects: string[]) {
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

export default function DashboardPage() {
  const navigate = useNavigate();
  const state = loadState();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [journey, setJourney] = useState<LearnerJourneyResponse | null>(null);
  const [groups, setGroups] = useState<NewtonCentreTimetableGroupsResponse | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      setError("");
      try {
        const [nextJourney, nextGroups] = await Promise.all([
          getLearnerJourney({ limit: 100 }),
          getNewtonCentreTimetableGroups(),
        ]);
        setJourney(nextJourney);
        setGroups(nextGroups);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load dashboard");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, []);

  const journeyByStudentId = useMemo(
    () => new Map((journey?.items ?? []).map((item) => [item.studentId, item])),
    [journey],
  );

  const timetableGroups = groups?.groups ?? [];
  const todayGroups = useMemo(() => {
    const today = new Date().getDay();
    return timetableGroups
      .filter((group) => group.dayOfWeek === today)
      .sort((a, b) => a.startTime.localeCompare(b.startTime));
  }, [timetableGroups]);

  function groupReadiness(group: TimetableGroup) {
    const mapped = group.students.filter((student) => student.mylisaStudentId);
    const assessed = mapped.filter((student) =>
      student.mylisaStudentId
        ? journeyByStudentId.get(student.mylisaStudentId)?.hasCompletedAssessment
        : false,
    );
    return {
      mapped,
      assessed,
      ready: group.students.length > 0 && group.unmappedStudentCount === 0 && assessed.length === mapped.length,
    };
  }

  function openGroup(group: TimetableGroup) {
    const firstMapped = group.students
      .map((student) => (student.mylisaStudentId ? journeyByStudentId.get(student.mylisaStudentId) : null))
      .find((item): item is LearnerJourneyItem => Boolean(item));

    if (firstMapped) {
      saveLearnerWorkspace(firstMapped);
    }

    const params = new URLSearchParams({ groupId: group.id });
    if (firstMapped) params.set("studentId", firstMapped.studentId);
    navigate(`/lesson-builder?${params.toString()}`);
  }

  const assessedCount = journey?.totals.assessed ?? 0;
  const evidenceGapCount =
    (journey?.totals.awaitingAssessment ?? 0) + (journey?.totals.assessmentInProgress ?? 0);
  const unmappedToday = todayGroups.reduce((sum, group) => sum + group.unmappedStudentCount, 0);

  return (
    <Layout
      title="Today"
      subtitle="A compact command centre for lesson delivery, learner evidence, and timetable readiness."
      kicker="MyLisa"
    >
      {error ? <div className="error-box" style={{ marginBottom: 20 }}>{error}</div> : null}

      <section className="workspace-panel">
        <div className="workspace-toolbar">
          <div>
            <h2>Operations Snapshot</h2>
            <p className="meta">Start here, then use the menu for deeper work.</p>
          </div>
          <div className="button-row">
            <button className="btn btn-primary" onClick={() => navigate("/lesson-builder")}>
              Build lesson
            </button>
            <button className="btn btn-secondary" onClick={() => navigate("/students")}>
              Students
            </button>
            <button className="btn btn-secondary" onClick={() => navigate("/timetable")}>
              Timetable
            </button>
          </div>
        </div>
        <div className="dashboard-readiness student-kpis">
          <div><strong>{todayGroups.length}</strong><span className="meta">groups today</span></div>
          <div><strong>{assessedCount}</strong><span className="meta">lesson ready learners</span></div>
          <div><strong>{evidenceGapCount}</strong><span className="meta">evidence gaps</span></div>
          <div><strong>{unmappedToday}</strong><span className="meta">unmapped today</span></div>
        </div>
      </section>

      <div style={{ height: 16 }} />

      <section className="workspace-panel">
        <div className="workspace-toolbar">
          <div>
            <h2>Today's Timetable</h2>
            <p className="meta">
              Open a group to prepare its lesson. Full learner actions live in Students.
            </p>
          </div>
          <span className="pill">{loading ? "Loading" : `${todayGroups.length} groups`}</span>
        </div>

        {!loading && !TIMETABLE_READY_SOURCES.includes(groups?.source ?? "") ? (
          <div className="error-box" style={{ marginTop: 16 }}>
            Newton Centre timetable is not available right now.
          </div>
        ) : null}

        <div className="today-lesson-list" style={{ marginTop: 16 }}>
          {todayGroups.slice(0, 8).map((group) => {
            const readiness = groupReadiness(group);
            return (
              <div key={group.id} className={`today-lesson ${readiness.ready ? "today-lesson-ready" : ""}`.trim()}>
                <div className="today-lesson-time">
                  <strong>{group.startTime}</strong>
                  <span>{group.endTime}</span>
                </div>
                <div className="today-lesson-main">
                  <div className="profile-item-head">
                    <strong>{group.title}</strong>
                    <span className={`pill ${readiness.ready ? "pill-success" : ""}`}>
                      {readiness.ready ? "Ready" : "Needs attention"}
                    </span>
                  </div>
                  <p className="meta">
                    {group.subject}
                    {group.keyStage ? ` · ${group.keyStage}` : ""}
                    {group.tutor?.name ? ` · ${group.tutor.name}` : " · Tutor not assigned"}
                    {group.students.length ? ` · ${readiness.assessed.length}/${group.students.length} assessed` : " · no learners"}
                  </p>
                  <div className="button-row">
                    <button className="btn btn-primary" disabled={!readiness.mapped.length} onClick={() => openGroup(group)}>
                      Open builder
                    </button>
                    <button className="btn btn-secondary" onClick={() => navigate(`/students?groupId=${encodeURIComponent(group.id)}`)}>
                      View students
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
          {!loading && !todayGroups.length ? (
            <p className="meta">No lessons are scheduled for today.</p>
          ) : null}
        </div>
      </section>

      <div style={{ height: 16 }} />

      <section className="workspace-panel">
        <div className="workspace-toolbar">
          <div>
            <h2>Current Workspace</h2>
            <p className="meta">The selected learner is used by reports, assessments, and the lesson builder.</p>
          </div>
          <button className="btn btn-secondary" onClick={() => navigate("/onboarding")}>
            New learner
          </button>
        </div>
        <div className="dashboard-strip" style={{ marginTop: 14 }}>
          <div>
            <span className="meta">Learner</span>
            <strong>
              {state.student
                ? `${state.student.student.firstName ?? ""} ${state.student.student.lastName ?? ""}`.trim() ||
                  state.student.email
                : "None loaded"}
            </strong>
          </div>
          <div>
            <span className="meta">Assessment</span>
            <strong>{state.sessionId ? `${state.subject} · ${state.sessionId}` : "No active session"}</strong>
          </div>
          <div>
            <span className="meta">Screening</span>
            <strong>{state.ndscreenSessionId || "Not linked"}</strong>
          </div>
          <div className="button-row">
            <button className="btn btn-secondary" onClick={() => navigate("/report")}>Report</button>
            <button className="btn btn-secondary" onClick={() => navigate("/assessments")}>Lookup</button>
          </div>
        </div>
      </section>
    </Layout>
  );
}
