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

function dayOrder(groups: TimetableGroup[]) {
  return Array.from(new Map(groups.map((group) => [group.dayOfWeek, group.dayLabel])).entries())
    .sort(([a], [b]) => a - b)
    .map(([dayOfWeek, dayLabel]) => ({ dayOfWeek, dayLabel }));
}

export default function TimetablePage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(true);
  const [journeyLoading, setJourneyLoading] = useState(true);
  const [error, setError] = useState("");
  const [groups, setGroups] = useState<NewtonCentreTimetableGroupsResponse | null>(null);
  const [journey, setJourney] = useState<LearnerJourneyResponse | null>(null);
  const [selectedSubject, setSelectedSubject] = useState("ALL");

  useEffect(() => {
    async function loadGroups() {
      setLoading(true);
      setError("");
      try {
        setGroups(await getNewtonCentreTimetableGroups());
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load timetable groups");
      } finally {
        setLoading(false);
      }
    }

    async function loadJourney() {
      setJourneyLoading(true);
      try {
        setJourney(await getLearnerJourney({ limit: 120 }));
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load learner journey");
      } finally {
        setJourneyLoading(false);
      }
    }

    void loadGroups();
    void loadJourney();
  }, []);

  const timetableGroups = groups?.groups ?? [];
  const journeyByStudentId = useMemo(
    () => new Map((journey?.items ?? []).map((item) => [item.studentId, item])),
    [journey],
  );
  const subjectOptions = useMemo(
    () =>
      Array.from(new Set(timetableGroups.map((group) => group.subject).filter(Boolean))).sort((a, b) =>
        a.localeCompare(b),
      ),
    [timetableGroups],
  );
  const visibleGroups = useMemo(
    () =>
      selectedSubject === "ALL"
        ? timetableGroups
        : timetableGroups.filter((group) => group.subject === selectedSubject),
    [selectedSubject, timetableGroups],
  );
  const days = useMemo(() => dayOrder(visibleGroups), [visibleGroups]);

  function openLessonBuilderForLearner(item: LearnerJourneyItem, groupId?: string) {
    saveLearnerWorkspace(item);
    const params = new URLSearchParams();
    if (groupId) params.set("groupId", groupId);
    navigate(`/lesson-builder${params.toString() ? `?${params.toString()}` : ""}`);
  }

  function openGroup(group: TimetableGroup) {
    const firstMappedStudentId = group.students.find((student) => student.mylisaStudentId)?.mylisaStudentId;
    const firstMapped = group.students
      .map((student) => (student.mylisaStudentId ? journeyByStudentId.get(student.mylisaStudentId) : null))
      .find((item): item is LearnerJourneyItem => Boolean(item));

    if (firstMapped) {
      openLessonBuilderForLearner(firstMapped, group.id);
      return;
    }

    const params = new URLSearchParams({ groupId: group.id });
    if (firstMappedStudentId) params.set("studentId", firstMappedStudentId);
    navigate(`/lesson-builder?${params.toString()}`);
  }

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

  return (
    <Layout
      title="Timetable"
      subtitle="A compact weekly view of the Newton Centre delivery groups, with lesson readiness visible at a glance."
      kicker="MyLisa"
    >
      {error ? <div className="error-box" style={{ marginBottom: 20 }}>{error}</div> : null}

      <section className="card">
        <div className="profile-item-head">
          <div>
            <h2>Weekly Groups</h2>
            <p className="meta">
              Sessions are shown in delivery order. Open a group to prepare or launch the lesson.
            </p>
          </div>
          <div className="button-row">
            <button className="btn btn-secondary" onClick={() => navigate("/dashboard")}>
              Dashboard
            </button>
          </div>
        </div>

        {subjectOptions.length ? (
          <div className="dashboard-subject-row" aria-label="Filter timetable groups by subject">
            <button
              className={`btn ${selectedSubject === "ALL" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setSelectedSubject("ALL")}
            >
              All
            </button>
            {subjectOptions.map((subject) => (
              <button
                key={subject}
                className={`btn ${selectedSubject === subject ? "btn-primary" : "btn-secondary"}`}
                onClick={() => setSelectedSubject(subject)}
              >
                {subject}
              </button>
            ))}
          </div>
        ) : null}

        {!loading && !TIMETABLE_READY_SOURCES.includes(groups?.source ?? "") ? (
          <div className="error-box" style={{ marginTop: 16 }}>
            Newton Centre timetable is not available right now.
          </div>
        ) : null}

        <div className="timetable-week">
          {days.map((day) => {
            const dayGroups = visibleGroups
              .filter((group) => group.dayOfWeek === day.dayOfWeek)
              .sort((a, b) => a.startTime.localeCompare(b.startTime));

            return (
              <section key={day.dayOfWeek} className="timetable-day">
                <div className="profile-item-head">
                  <h3>{day.dayLabel}</h3>
                  <span className="pill">{dayGroups.length}</span>
                </div>
                <div className="profile-stack">
                  {dayGroups.map((group) => {
                    const readiness = groupReadiness(group);
                    return (
                      <div
                        key={group.id}
                        className={`timetable-event ${readiness.ready ? "timetable-event-ready" : ""}`.trim()}
                      >
                        <div className="today-lesson-time">
                          <strong>{group.startTime}</strong>
                          <span>{group.endTime}</span>
                        </div>
                        <div className="today-lesson-main">
                          <div className="profile-item-head">
                            <strong>{group.title}</strong>
                            <span className="pill">{readiness.ready ? "Ready" : "Needs attention"}</span>
                          </div>
                          <p className="meta">
                            {group.subject}
                            {group.keyStage ? ` · ${group.keyStage}` : ""}
                            {group.tutor?.name ? ` · ${group.tutor.name}` : " · Tutor not assigned"}
                            {group.room ? ` · ${group.room}` : ""}
                          </p>
                          <div className="small-grid dashboard-readiness">
                            <div><strong>{group.students.length}</strong><span className="meta">assigned</span></div>
                            <div><strong>{readiness.mapped.length}</strong><span className="meta">mapped</span></div>
                            <div><strong>{readiness.assessed.length}</strong><span className="meta">assessed</span></div>
                            <div><strong>{group.unmappedStudentCount}</strong><span className="meta">unmapped</span></div>
                          </div>
                          <button
                            className="btn btn-primary"
                            disabled={!readiness.mapped.length || journeyLoading}
                            onClick={() => openGroup(group)}
                          >
                            Open group builder
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>
            );
          })}
          {!loading && !visibleGroups.length ? (
            <p className="meta">No timetable groups are available for this view.</p>
          ) : null}
        </div>
      </section>
    </Layout>
  );
}
