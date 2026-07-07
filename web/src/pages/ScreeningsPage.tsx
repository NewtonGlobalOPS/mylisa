import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import {
  getNdscreenChildrenDashboard,
  importStudentFromNdscreen,
  startAssessment,
} from "../api/assessmentApi";
import type { NdscreenDashboardResponse } from "../types/assessment";
import { loadState, saveNdscreenSessionId, saveState, saveStudent } from "../utils/storage";
import { normaliseAssessmentYear } from "../utils/schoolYear";

type ScreeningRow = NdscreenDashboardResponse["items"][number];
type AssessmentSubject = "MATHS" | "SCIENCE";

const ASSESSMENT_SUBJECTS: AssessmentSubject[] = ["MATHS", "SCIENCE"];

function formatDate(value: string | null | undefined) {
  if (!value) return "Not ready";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not ready";
  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function confidencePercent(value: number | null | undefined) {
  return typeof value === "number" && Number.isFinite(value)
    ? `${Math.round(value * 100)}%`
    : "Pending";
}

function screeningText(row: ScreeningRow) {
  return [
    row.childDisplayName,
    row.firstName,
    row.lastName,
    row.guardianEmail,
    row.sessionId,
    row.questionSet?.key,
    row.screeningStatus,
    row.report?.status,
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

export default function ScreeningsPage() {
  const navigate = useNavigate();
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("ALL");
  const [loading, setLoading] = useState(true);
  const [startingKey, setStartingKey] = useState("");
  const [error, setError] = useState("");
  const [dashboard, setDashboard] = useState<NdscreenDashboardResponse | null>(null);

  async function load() {
    setLoading(true);
    setError("");
    try {
      setDashboard(await getNdscreenChildrenDashboard());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load screenings");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const unimported = useMemo(
    () => (dashboard?.items ?? []).filter((item) => !item.isImportedToMylisa),
    [dashboard],
  );

  const statusOptions = useMemo(
    () =>
      Array.from(new Set(unimported.map((item) => item.screeningStatus).filter(Boolean))).sort(
        (a, b) => a.localeCompare(b),
      ),
    [unimported],
  );

  const visibleRows = useMemo(() => {
    const normalizedQuery = query.trim().toLowerCase();
    return unimported
      .filter((item) => status === "ALL" || item.screeningStatus === status)
      .filter((item) => !normalizedQuery || screeningText(item).includes(normalizedQuery))
      .sort((a, b) => {
        const aDate = new Date(a.report?.readyAt ?? "").getTime() || 0;
        const bDate = new Date(b.report?.readyAt ?? "").getTime() || 0;
        return bDate - aDate || a.childDisplayName.localeCompare(b.childDisplayName);
      });
  }, [query, status, unimported]);

  async function startScreeningAssessment(row: ScreeningRow, subject: AssessmentSubject) {
    const key = `${row.sessionId}:${subject}`;
    setStartingKey(key);
    setError("");

    try {
      const imported = await importStudentFromNdscreen(row.sessionId);
      const importedForSubject = {
        ...imported,
        student: {
          ...imported.student,
          subjects: Array.from(new Set([...imported.student.subjects, subject])),
        },
      };
      saveStudent(importedForSubject);
      saveNdscreenSessionId(row.sessionId);

      const started = await startAssessment({
        studentId: imported.studentId,
        childCurrentYear: normaliseAssessmentYear(
          imported.student.schoolYear,
          imported.student.age,
        ),
        subject,
      });

      saveState({
        ...loadState(),
        student: importedForSubject,
        subject: started.subject,
        sessionId: started.sessionId,
        entryYear: started.entryYear,
        currentQuestion: started.firstQuestion,
        result: null,
        askedCount: 0,
        ndscreenSessionId: row.sessionId,
      });
      navigate("/assessment");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to start assessment");
      await load();
    } finally {
      setStartingKey("");
    }
  }

  const readyReports = unimported.filter((item) => item.report?.status === "READY").length;
  const learningScreens = unimported.filter((item) => item.questionSet?.key?.includes("learning")).length;

  return (
    <Layout
      title="Screenings"
      subtitle="NDSCREEN children who have screening evidence but do not yet have a MYLISA student record."
      kicker="MyLisa"
    >
      {error ? <div className="error-box" style={{ marginBottom: 20 }}>{error}</div> : null}

      <section className="workspace-panel">
        <div className="workspace-toolbar">
          <div>
            <h2>Unlinked Screenings</h2>
            <p className="meta">Create a learner record and start the first assessment in one step.</p>
          </div>
          <div className="button-row">
            <button className="btn btn-secondary" onClick={() => void load()} disabled={loading}>
              {loading ? "Refreshing..." : "Refresh"}
            </button>
          </div>
        </div>
        <div className="dashboard-readiness student-kpis">
          <div><strong>{unimported.length}</strong><span className="meta">unlinked</span></div>
          <div><strong>{readyReports}</strong><span className="meta">reports ready</span></div>
          <div><strong>{learningScreens}</strong><span className="meta">learning screens</span></div>
          <div><strong>{dashboard?.count ?? 0}</strong><span className="meta">total screenings</span></div>
        </div>
        <div className="student-filter-bar">
          <input
            className="input"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search child, guardian, session, or question set"
          />
          <select className="input" value={status} onChange={(event) => setStatus(event.target.value)}>
            <option value="ALL">All statuses</option>
            {statusOptions.map((item) => (
              <option key={item} value={item}>{item.replaceAll("_", " ")}</option>
            ))}
          </select>
        </div>
      </section>

      <div style={{ height: 16 }} />

      <section className="student-table">
        {visibleRows.map((row) => (
          <article key={row.sessionId} className="student-row">
            <div className="student-main">
              <strong>{row.childDisplayName}</strong>
              <p className="meta">
                {row.questionSet?.key ?? "Unknown question set"} · {row.screeningStatus.replaceAll("_", " ")}
                {row.screeningKind ? ` · ${row.screeningKind}` : ""}
              </p>
              <p className="meta">
                {row.guardianEmail ?? "No guardian email"}
                {row.schoolYear ? ` · Year ${row.schoolYear}` : ""}
                {row.age ? ` · age ${row.age}` : ""}
              </p>
            </div>
            <div className="student-status">
              <span className={`pill ${row.report?.status === "READY" ? "pill-success" : ""}`}>
                {row.report?.status ?? "No report"}
              </span>
              <span className="meta">
                {formatDate(row.report?.readyAt)} · confidence {confidencePercent(
                  row.learningProfile?.confidence ?? row.latestResult?.confidence,
                )}
              </span>
            </div>
            <div className="student-actions">
              {ASSESSMENT_SUBJECTS.map((subject) => {
                const key = `${row.sessionId}:${subject}`;
                return (
                  <button
                    key={subject}
                    className={subject === "MATHS" ? "btn btn-primary" : "btn btn-secondary"}
                    disabled={Boolean(startingKey)}
                    onClick={() => void startScreeningAssessment(row, subject)}
                  >
                    {startingKey === key
                      ? "Starting..."
                      : `Start ${subject === "MATHS" ? "Maths" : "Science"}`}
                  </button>
                );
              })}
            </div>
          </article>
        ))}
        {!loading && !visibleRows.length ? (
          <div className="workspace-panel">
            <p className="meta">No unlinked screenings match this view.</p>
          </div>
        ) : null}
        {loading ? (
          <div className="workspace-panel">
            <p className="meta">Loading screenings...</p>
          </div>
        ) : null}
      </section>
    </Layout>
  );
}
