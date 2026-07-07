import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import ParentReport from "../components/ParentReport";
import {
  apiUrl,
  createInterestFactors,
  createStoredReport,
  createWrapperVector,
  deleteWrapperVector,
  getCombinedChildProfile,
  listCurriculumObjectives,
  updateWrapperVector,
} from "../api/assessmentApi";
import type {
  AssessmentResult,
  CombinedChildProfileResponse,
  CurriculumObjectiveListResponse,
  StudentOnboardingResponse,
  WrapperVectorRecord,
} from "../types/assessment";
import { clearState, loadState, saveState } from "../utils/storage";

type ReportSubject = "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH";
type MathsObjectiveDomain =
  | "NUMBER"
  | "ALGEBRA"
  | "GEOMETRY"
  | "DATA"
  | "RATIO"
  | "PROBABILITY";
type CurriculumObjectiveItem = CurriculumObjectiveListResponse["items"][number];

const objectiveDomainOptions: Array<{ value: MathsObjectiveDomain; label: string }> = [
  { value: "NUMBER", label: "Number" },
  { value: "ALGEBRA", label: "Algebra" },
  { value: "GEOMETRY", label: "Geometry" },
  { value: "DATA", label: "Data" },
  { value: "RATIO", label: "Ratio" },
  { value: "PROBABILITY", label: "Probability" },
];

function textContainsAny(value: string, terms: string[]) {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function objectiveMatchesDomain(
  objective: { title?: string | null; strand?: string | null; reason?: string | null },
  domain: MathsObjectiveDomain | ""
) {
  if (!domain) return true;
  const text = [objective.title, objective.strand, objective.reason].filter(Boolean).join(" ");

  switch (domain) {
    case "NUMBER":
      return textContainsAny(text, [
        "number",
        "integer",
        "fraction",
        "decimal",
        "percentage",
        "place value",
        "rounding",
        "arithmetic",
        "addition",
        "subtraction",
        "multiplication",
        "division",
        "standard form",
        "surd",
      ]);
    case "ALGEBRA":
      return textContainsAny(text, [
        "algebra",
        "expression",
        "equation",
        "formula",
        "formulae",
        "rearrange",
        "sequence",
        "linear",
        "graph",
        "function",
        "identity",
        "inequal",
        "simultaneous",
      ]);
    case "GEOMETRY":
      return textContainsAny(text, [
        "geometry",
        "geometrical",
        "shape",
        "angle",
        "triangle",
        "quadrilateral",
        "circle",
        "polygon",
        "perimeter",
        "area",
        "volume",
        "construction",
        "pythagoras",
        "trigonometry",
        "bearing",
        "coordinate",
        "symmetry",
        "transformation",
      ]);
    case "DATA":
      return textContainsAny(text, [
        "data",
        "statistic",
        "statistics",
        "mean",
        "median",
        "mode",
        "range",
        "frequency",
        "table",
        "chart",
        "sampling",
      ]);
    case "RATIO":
      return textContainsAny(text, [
        "ratio",
        "proportion",
        "scale",
        "similarity",
        "compound measure",
        "rate",
      ]);
    case "PROBABILITY":
      return textContainsAny(text, [
        "probability",
        "chance",
        "event",
        "outcome",
        "sample space",
        "tree diagram",
      ]);
    default:
      return true;
  }
}

function uniqueSortedYears(values: Array<number | null | undefined>) {
  return Array.from(
    new Set(
      values.filter(
        (value): value is number =>
          typeof value === "number" && Number.isFinite(value) && value >= 1 && value <= 13
      )
    )
  ).sort((a, b) => a - b);
}

function requirementYears(profile: CombinedChildProfileResponse | null) {
  if (!profile) return [];

  return uniqueSortedYears([
    profile.assessment?.entryYear,
    profile.assessment?.entryYear != null ? profile.assessment.entryYear + 1 : null,
    profile.recommendations.course.targetYear,
    ...(profile.recommendations.course.yearBlend ?? []).map((item) => item.year),
    ...(profile.recommendations.course.interventions ?? []).map((item) => item.targetYear),
    ...profile.recommendations.objectives.map((objective) => objective.yearGroup),
    profile.child.schoolYear,
  ]);
}

function formatYearList(years: number[]) {
  if (!years.length) return "the requirement years";
  return years.map((year) => `Year ${year}`).join(", ");
}

function getAssessmentDisplayBand(
  band: string | null | undefined,
  entryYear: number | null | undefined,
  generatedLabel?: string | null
) {
  if (generatedLabel?.trim()) return generatedLabel.trim();

  const safeEntryYear = entryYear ?? 1;

  switch (band) {
    case "BELOW_ENTRY":
      return `Developing towards Year ${safeEntryYear}`;
    case "ENTRY_SECURE":
      return `Secure in Year ${safeEntryYear}`;
    case "ENTRY_SECURE_NEXT_EMERGING":
      return `Secure in Year ${safeEntryYear} and beginning Year ${safeEntryYear + 1}`;
    case "NEXT_DEVELOPING":
      return `Developing into Year ${safeEntryYear + 1}`;
    case "NEXT_SECURE":
      return `Secure in Year ${safeEntryYear + 1}`;
    case "INSUFFICIENT_EVIDENCE":
      return `Building Year ${safeEntryYear} security`;
    default:
      return "-";
  }
}

function formatReportDate(value: string | null | undefined) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleDateString(undefined, {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "-";
  return `${Math.round(value * 100)}%`;
}

function buildPrintableResult(
  profile: CombinedChildProfileResponse | null,
  fallback: AssessmentResult | null
): AssessmentResult | null {
  if (!profile?.assessment) return fallback;

  return {
    overallWorkingBand:
      profile.assessment.overallWorkingBand ??
      fallback?.overallWorkingBand ??
      "INSUFFICIENT_EVIDENCE",
    overallConfidence:
      profile.assessment.overallConfidence ??
      fallback?.overallConfidence ??
      0,
    questionCount: profile.assessment.questionCount,
    completionReason: fallback?.completionReason ?? "PROFILE_REPORT",
    strands: profile.assessment.strands.map((strand) => ({
      strand: strand.strand,
      secureYear: strand.secureYear,
      emergingYear: strand.emergingYear,
      confidence: strand.confidence,
      asked: strand.asked,
      correct: strand.correct,
      accuracy: strand.accuracy,
    })),
    summary:
      fallback?.summary ??
      `Assessment evidence is available for ${profile.child.displayName}.`,
    report: profile.assessment.report ?? fallback?.report ?? null,
  };
}

function buildPrintableStudent(
  profile: CombinedChildProfileResponse | null,
  fallback: StudentOnboardingResponse | null
): StudentOnboardingResponse | null {
  if (!profile) return fallback;

  return {
    message: fallback?.message ?? "Loaded learner profile",
    userId: fallback?.userId ?? profile.child.id,
    studentId: profile.child.id,
    email: fallback?.email ?? profile.child.guardianEmail ?? "",
    temporaryPassword: fallback?.temporaryPassword,
    student: {
      id: profile.child.id,
      firstName: profile.child.firstName ?? undefined,
      lastName: profile.child.lastName ?? undefined,
      age: profile.child.age,
      schoolYear: profile.child.schoolYear ?? fallback?.student.schoolYear ?? 0,
      keyStage: profile.child.keyStage ?? undefined,
      subjects: profile.child.subjects,
      guardianEmail: profile.child.guardianEmail ?? undefined,
    },
  };
}

export default function ReportPage() {
  const navigate = useNavigate();
  const state = loadState();
  const studentId = state.student?.studentId ?? "";
  const [selectedSubject, setSelectedSubject] = useState<ReportSubject>(
    state.subject ?? "MATHS"
  );
  const [selectedAssessmentSessionId, setSelectedAssessmentSessionId] = useState(
    state.sessionId ?? ""
  );
  const [selectedObjectiveDomain, setSelectedObjectiveDomain] = useState<
    MathsObjectiveDomain | ""
  >("");
  const [domainObjectives, setDomainObjectives] =
    useState<CurriculumObjectiveListResponse | null>(null);
  const [domainObjectivesLoading, setDomainObjectivesLoading] = useState(false);
  const reportSubject: ReportSubject = selectedSubject;
  const assessmentSessionId = selectedAssessmentSessionId;
  const subjectLabel = reportSubject === "SCIENCE" ? "science" : "maths";
  const subjectTitle = reportSubject === "SCIENCE" ? "Science" : "Maths";
  const persistedNdscreenSessionId = state.ndscreenSessionId ?? "";
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [profile, setProfile] = useState<CombinedChildProfileResponse | null>(null);
  const [ndscreenInput, setNdscreenInput] = useState(persistedNdscreenSessionId);
  const [ndscreenSessionId, setNdscreenSessionId] = useState(persistedNdscreenSessionId);
  const [vectorDraft, setVectorDraft] = useState({
    title: "",
    content: "",
    scope: "GENERAL",
    strand: "",
  });
  const [interestDraft, setInterestDraft] = useState({
    category: "",
    primaryFactor: "",
    secondaryFactor: "",
    notes: "",
  });
  const [savingVector, setSavingVector] = useState(false);
  const [isReportPreviewOpen, setIsReportPreviewOpen] = useState(false);
  const [generatingReport, setGeneratingReport] = useState(false);
  const [copiedReportLink, setCopiedReportLink] = useState(false);
  const displayBand = getAssessmentDisplayBand(
    profile?.assessment?.overallWorkingBand ?? state.result?.overallWorkingBand,
    profile?.assessment?.entryYear ?? state.entryYear,
    state.result?.report?.displayBandLabel ?? null
  );
  const printableResult = buildPrintableResult(profile, state.result);
  const printableStudent = buildPrintableStudent(profile, state.student);
  const reportLessons = profile?.learningReport.lessons ?? [];
  const completedReportLessons = reportLessons.filter(
    (lesson) => lesson.endedAt || lesson.status === "COMPLETED"
  );
  const completedQuestionsAnswered = completedReportLessons.reduce(
    (sum, lesson) => sum + lesson.questionsAnswered,
    0
  );
  const completedQuestionsCorrect = completedReportLessons.reduce(
    (sum, lesson) => sum + lesson.questionsCorrect,
    0
  );
  const completedLessonAccuracy =
    completedQuestionsAnswered > 0 ? completedQuestionsCorrect / completedQuestionsAnswered : null;
  const recommendedObjectives = useMemo(
    () =>
      (profile?.recommendations.objectives ?? []).filter((objective) =>
        objectiveMatchesDomain(objective, selectedObjectiveDomain)
      ),
    [profile, selectedObjectiveDomain]
  );
  const domainRequirementYears = useMemo(() => requirementYears(profile), [profile]);
  const groupedDomainObjectives = useMemo(() => {
    const groups = new Map<
      string,
      { yearGroup: number | null; strand: string; items: CurriculumObjectiveItem[] }
    >();

    for (const objective of domainObjectives?.items ?? []) {
      const key = `${objective.yearGroup ?? "na"}|${objective.strand}`;
      const existing = groups.get(key);
      if (existing) {
        existing.items.push(objective);
      } else {
        groups.set(key, {
          yearGroup: objective.yearGroup,
          strand: objective.strand,
          items: [objective],
        });
      }
    }

    return Array.from(groups.values()).sort(
      (a, b) =>
        (a.yearGroup ?? 99) - (b.yearGroup ?? 99) ||
        a.strand.localeCompare(b.strand)
    );
  }, [domainObjectives]);

  useEffect(() => {
    if (!profile || reportSubject !== "MATHS" || !selectedObjectiveDomain) {
      setDomainObjectives(null);
      setDomainObjectivesLoading(false);
      return;
    }

    let cancelled = false;
    const domain = selectedObjectiveDomain;
    const years = domainRequirementYears.length
      ? domainRequirementYears
      : uniqueSortedYears([profile.child.schoolYear]);

    async function loadDomainObjectives() {
      setDomainObjectivesLoading(true);
      try {
        const responses = await Promise.all(
          years.map((yearGroup) =>
            listCurriculumObjectives({
              subject: "MATHS",
              yearGroup,
              domain,
              limit: 250,
            })
          )
        );
        const itemById = new Map<string, CurriculumObjectiveListResponse["items"][number]>();
        for (const response of responses) {
          for (const item of response.items) itemById.set(item.id, item);
        }
        const items = Array.from(itemById.values()).sort(
          (a, b) =>
            (a.yearGroup ?? 99) - (b.yearGroup ?? 99) ||
            a.strand.localeCompare(b.strand) ||
            a.title.localeCompare(b.title)
        );
        const base = responses[0];
        if (!cancelled) {
          setDomainObjectives({
            organisation: base?.organisation ?? { id: "", slug: "", name: "" },
            filters: {
              subject: "MATHS",
              keyStage: null,
              yearGroup: null,
              domain,
              strand: null,
              search: null,
              hasContent: null,
              hasCanonical: null,
              limit: 250,
            },
            count: items.length,
            items,
          });
        }
      } catch (err) {
        if (!cancelled) {
          setDomainObjectives({
            organisation: { id: "", slug: "", name: "" },
            filters: {
              subject: "MATHS",
              keyStage: null,
              yearGroup: null,
              domain,
              strand: null,
              search: null,
              hasContent: null,
              hasCanonical: null,
              limit: 250,
            },
            count: 0,
            items: [],
          });
          setError(
            err instanceof Error
              ? `Failed to load ${domain.toLowerCase()} objectives. ${err.message}`
              : `Failed to load ${domain.toLowerCase()} objectives.`
          );
        }
      } finally {
        if (!cancelled) setDomainObjectivesLoading(false);
      }
    }

    void loadDomainObjectives();

    return () => {
      cancelled = true;
    };
  }, [domainRequirementYears, profile, reportSubject, selectedObjectiveDomain]);

  useEffect(() => {
    if (!state.student?.studentId) {
      navigate("/dashboard");
      return;
    }

    async function loadProfile() {
      if (!studentId) return;

      setLoading(true);
      setError("");

      try {
        const next = await getCombinedChildProfile({
          studentId,
          subject: reportSubject,
          assessmentSessionId: assessmentSessionId || undefined,
          ndscreenSessionId: ndscreenSessionId.trim() || undefined,
        });
        setProfile(next);

        const resolvedNdscreenSessionId = next.screening?.sessionId?.trim() ?? "";
        if (resolvedNdscreenSessionId && !ndscreenSessionId.trim()) {
          setNdscreenInput(resolvedNdscreenSessionId);
          setNdscreenSessionId(resolvedNdscreenSessionId);
          saveState({
            ...loadState(),
            ndscreenSessionId: resolvedNdscreenSessionId,
          });
        }
      } catch (err) {
        setError(
          err instanceof Error
            ? `${subjectTitle} profile failed to load. ${err.message}`
            : `Failed to load ${subjectLabel} child profile`
        );
      } finally {
        setLoading(false);
      }
    }

    void loadProfile();
  }, [
    assessmentSessionId,
    ndscreenSessionId,
    navigate,
    reportSubject,
    studentId,
  ]);

  if (!state.student?.studentId) {
    return null;
  }

  function applyNdscreenSession() {
    const nextSessionId = ndscreenInput.trim();
    setNdscreenSessionId(nextSessionId);
    saveState({
      ...state,
      ndscreenSessionId: nextSessionId,
    });
  }

  function switchReportSubject(subject: ReportSubject) {
    const matchingAssessment = profile?.availableAssessments.find(
      (assessment) => assessment.subject === subject
    );
    const nextSessionId = matchingAssessment?.id ?? "";

    setSelectedSubject(subject);
    setSelectedAssessmentSessionId(nextSessionId);
    setProfile(null);
    saveState({
      ...loadState(),
      subject,
      sessionId: nextSessionId,
      currentQuestion: null,
      result: null,
      askedCount: 0,
    });
  }

  async function reloadProfile() {
    const next = await getCombinedChildProfile({
      studentId,
      subject: reportSubject,
      assessmentSessionId: assessmentSessionId || undefined,
      ndscreenSessionId: ndscreenSessionId.trim() || undefined,
    });
    setProfile(next);
  }

  async function handleCreateVector() {
    if (!vectorDraft.title.trim() || !vectorDraft.content.trim()) return;

    setSavingVector(true);
    setError("");
    try {
      await createWrapperVector({
        studentId,
        title: vectorDraft.title.trim(),
        content: vectorDraft.content.trim(),
        scope: vectorDraft.scope.trim() || "GENERAL",
        strand: vectorDraft.strand.trim() || undefined,
      });
      setVectorDraft({
        title: "",
        content: "",
        scope: "GENERAL",
        strand: "",
      });
      await reloadProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create wrapper vector");
    } finally {
      setSavingVector(false);
    }
  }

  async function handleToggleVector(vector: WrapperVectorRecord) {
    setSavingVector(true);
    setError("");
    try {
      await updateWrapperVector({
        vectorId: vector.id,
        isActive: !vector.isActive,
      });
      await reloadProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to update wrapper vector");
    } finally {
      setSavingVector(false);
    }
  }

  async function handleDeleteVector(vectorId: string) {
    setSavingVector(true);
    setError("");
    try {
      await deleteWrapperVector(vectorId);
      await reloadProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to delete wrapper vector");
    } finally {
      setSavingVector(false);
    }
  }

  async function handleCreateInterestFactors() {
    if (
      !interestDraft.category.trim() ||
      !interestDraft.primaryFactor.trim() ||
      !interestDraft.secondaryFactor.trim()
    ) {
      return;
    }

    setSavingVector(true);
    setError("");
    try {
      await createInterestFactors({
        studentId,
        category: interestDraft.category.trim(),
        primaryFactor: interestDraft.primaryFactor.trim(),
        secondaryFactor: interestDraft.secondaryFactor.trim(),
        notes: interestDraft.notes.trim() || undefined,
      });
      setInterestDraft({
        category: "",
        primaryFactor: "",
        secondaryFactor: "",
        notes: "",
      });
      await reloadProfile();
    } catch (err) {
      setError(
        err instanceof Error ? err.message : "Failed to create interest factors"
      );
    } finally {
      setSavingVector(false);
    }
  }

  async function handleGenerateStoredReport() {
    if (!studentId || !reportDocument) return;

    setGeneratingReport(true);
    setCopiedReportLink(false);
    setError("");
    try {
      await createStoredReport({
        studentId,
        subject: reportSubject,
        assessmentSessionId:
          (profile?.assessment?.sessionId ?? assessmentSessionId) || undefined,
        ndscreenSessionId: ndscreenSessionId.trim() || undefined,
      });
      await reloadProfile();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build stored PDF report");
    } finally {
      setGeneratingReport(false);
    }
  }

  function openStoredReport() {
    if (!profile?.storedReport?.parentViewUrl) return;
    window.open(apiUrl(profile.storedReport.parentViewUrl), "_blank", "noopener,noreferrer");
  }

  async function copyParentReportLink() {
    if (!profile?.storedReport?.parentViewUrl) return;
    await navigator.clipboard.writeText(apiUrl(profile.storedReport.parentViewUrl));
    setCopiedReportLink(true);
  }

  const reportDocument = printableResult ? (
    <ParentReport
      student={printableStudent}
      result={printableResult}
      sessionId={profile?.assessment?.sessionId ?? state.sessionId}
      profile={profile}
      subject={profile?.assessment?.subject ?? reportSubject}
    />
  ) : null;

  return (
    <Layout
      title={`${subjectTitle} learner profile`}
      subtitle={`Bring MyLisa ${subjectLabel} assessment evidence and ndscreen screening context into one view so the next course, strands, and objectives can be chosen deliberately.`}
    >
      <div className="card no-print">
        <div className="button-row">
          <button
            className="btn btn-primary"
            disabled={!reportDocument}
            onClick={() => setIsReportPreviewOpen(true)}
          >
            Preview report
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => navigate("/dashboard")}
          >
            Dashboard
          </button>
          <button
            className="btn btn-secondary"
            onClick={() => {
              clearState();
              navigate("/onboarding");
            }}
          >
            New learner
          </button>
        </div>
        <div className="report-subject-switcher" aria-label="Choose report subject">
          {(["MATHS", "SCIENCE"] as ReportSubject[]).map((subject) => {
            const assessment = profile?.availableAssessments.find(
              (item) => item.subject === subject
            );
            const isSelected = reportSubject === subject;
            return (
              <button
                key={subject}
                className={`btn ${isSelected ? "btn-primary" : "btn-secondary"}`}
                disabled={loading || (!assessment && subject !== reportSubject)}
                onClick={() => switchReportSubject(subject)}
              >
                {subject === "MATHS" ? "Maths" : "Science"} report
                {assessment
                  ? ` · ${assessment.status.toLowerCase()}`
                  : " · no assessment"}
              </button>
            );
          })}
        </div>
      </div>

      <div style={{ height: 20 }} />

      {reportDocument ? (
        <div className="card no-print report-ready-card">
          <div>
            <h2>Formal report</h2>
            <p className="meta">
              Preview the report, then build and store a PDF for parent access.
            </p>
            {profile?.storedReport ? (
              <p className="meta">
                Stored PDF generated {formatReportDate(profile.storedReport.generatedAt)}.
              </p>
            ) : null}
          </div>
          <div className="button-row">
            <button className="btn btn-secondary" onClick={() => setIsReportPreviewOpen(true)}>
              Open preview
            </button>
            <button
              className="btn btn-primary"
              disabled={generatingReport}
              onClick={handleGenerateStoredReport}
            >
              {generatingReport ? "Building PDF..." : "Build stored PDF"}
            </button>
            {profile?.storedReport ? (
              <>
                <button className="btn btn-secondary" onClick={openStoredReport}>
                  Open stored PDF
                </button>
                <button className="btn btn-secondary" onClick={copyParentReportLink}>
                  {copiedReportLink ? "Link copied" : "Copy parent link"}
                </button>
              </>
            ) : null}
          </div>
        </div>
      ) : (
        <div className="card no-print">
          <h2>Printable report</h2>
          <p className="meta">
            Complete or load an assessment profile to generate the printable report.
          </p>
        </div>
      )}

      {reportDocument ? <div className="print-surface print-only">{reportDocument}</div> : null}

      {isReportPreviewOpen && reportDocument ? (
        <div className="report-preview-backdrop no-print" role="dialog" aria-modal="true">
          <div className="report-preview-panel">
            <div className="report-preview-toolbar">
              <div>
                <h2>Report preview</h2>
                <p className="meta">This is the document that will be sent to PDF.</p>
              </div>
              <div className="button-row">
                <button
                  className="btn btn-primary"
                  disabled={generatingReport}
                  onClick={handleGenerateStoredReport}
                >
                  {generatingReport ? "Building PDF..." : "Build stored PDF"}
                </button>
                {profile?.storedReport ? (
                  <button className="btn btn-secondary" onClick={openStoredReport}>
                    Open stored PDF
                  </button>
                ) : null}
                <button className="btn btn-secondary" onClick={() => setIsReportPreviewOpen(false)}>
                  Close
                </button>
              </div>
            </div>
            <div className="report-preview-scroll">
              <div className="report-preview-sheet">{reportDocument}</div>
            </div>
          </div>
        </div>
      ) : null}

      <div className="grid grid-2">
        <div className="card">
          <h2>Integrated profile</h2>
          <p className="meta">
            Link an ndscreen session to blend screening context with the {subjectLabel}{" "}
            assessment.
          </p>
          <label className="label">ndscreen session ID</label>
          <input
            className="input"
            value={ndscreenInput}
            onChange={(e) => setNdscreenInput(e.target.value)}
            placeholder="Paste session ID to load screening context"
          />
          <div style={{ marginTop: 12 }}>
            <button className="btn btn-secondary" onClick={applyNdscreenSession}>
              Load screening profile
            </button>
          </div>
          {error ? <div className="error-box">{error}</div> : null}
          {loading ? <p className="meta" style={{ marginTop: 12 }}>Loading profile...</p> : null}
          {profile?.screening?.error && ndscreenSessionId.trim() ? (
            <div className="error-box">
              {profile.screening.error}
            </div>
          ) : null}
        </div>

        <div className="card">
          <h2>Recommended course</h2>
          <div className="profile-highlight">
            <div className="pill profile-pill">
              {profile?.recommendations.course.intensity ?? "ADAPTIVE"}
            </div>
            <h3 style={{ marginBottom: 8 }}>
              {profile?.recommendations.course.label ?? "Assessment-led course"}
            </h3>
            <p className="meta">
              {profile?.recommendations.course.rationale ??
                "We will select the next course once assessment evidence is available."}
            </p>
          </div>
          <div className="small-grid" style={{ marginTop: 14 }}>
            <div>
              <strong>Pace:</strong>{" "}
              {profile?.recommendations.deliveryProfile.pace ?? "STANDARD"}
            </div>
            <div>
              <strong>Scaffolding:</strong>{" "}
              {profile?.recommendations.deliveryProfile.scaffolding ?? "MEDIUM"}
            </div>
            <div>
              <strong>Confidence priority:</strong>{" "}
              {profile?.recommendations.deliveryProfile.confidencePriority ?? "MEDIUM"}
            </div>
          </div>
          {profile?.recommendations.course.yearBlend?.length ? (
            <div style={{ marginTop: 14 }}>
              <strong>Year blend:</strong>{" "}
              {profile.recommendations.course.yearBlend
                .slice(0, 3)
                .map((item) => `Year ${item.year} (${item.weight}%)`)
                .join(", ")}
            </div>
          ) : null}
          {profile?.recommendations.course.matchedCourse ? (
            <div style={{ marginTop: 10 }}>
              <strong>NewtonCentre course:</strong>{" "}
              {profile.recommendations.course.matchedCourse.title} (
              {profile.recommendations.course.matchedCourse.slug})
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ height: 20 }} />

      <div className="grid grid-2">
        <div className="card">
          <h2>Course and objectives report</h2>
          <div className="profile-highlight">
            <div className="pill profile-pill">
              {profile?.learningReport.course.source === "SAVED_COURSE_PLAN"
                ? "SAVED COURSE"
                : "ASSESSMENT SET"}
            </div>
            <h3 style={{ marginBottom: 8 }}>
              {profile?.learningReport.course.title ?? "Assessment-led course"}
            </h3>
            <p className="meta">
              Status: {profile?.learningReport.course.status ?? "Recommended"}
              {profile?.learningReport.course.updatedAt
                ? ` · Updated ${formatReportDate(profile.learningReport.course.updatedAt)}`
                : ""}
            </p>
          </div>
          <div className="profile-stack" style={{ marginTop: 14 }}>
            {(profile?.learningReport.objectives ?? []).slice(0, 8).map((objective) => (
              <div key={objective.objectiveId} className="profile-item">
                <div className="profile-item-head">
                  <strong>
                    {objective.sequence ? `${objective.sequence}. ` : ""}
                    {objective.code}
                  </strong>
                  <span className="pill">{objective.status}</span>
                </div>
                <p className="meta" style={{ marginBottom: 6 }}>
                  {objective.title}
                </p>
                <p className="meta">
                  {objective.yearGroup != null ? `Year ${objective.yearGroup}. ` : ""}
                  {objective.strand}. {objective.reason}
                </p>
              </div>
            ))}
            {!profile?.learningReport.objectives.length ? (
              <p className="meta">
                Objectives will appear here once the assessment has generated a course focus.
              </p>
            ) : null}
          </div>
        </div>

        <div className="card">
          <h2>Lesson progress report</h2>
          <div className="small-grid">
            <div>
              <strong>Planned objectives:</strong>{" "}
              {profile?.learningReport.progressSummary.plannedObjectiveCount ?? 0}
            </div>
            <div>
              <strong>Lessons:</strong>{" "}
              {completedReportLessons.length}
            </div>
            <div>
              <strong>Completed:</strong>{" "}
              {completedReportLessons.length}
            </div>
            <div>
              <strong>Lesson accuracy:</strong>{" "}
              {formatPercent(completedLessonAccuracy)}
            </div>
          </div>
          <div className="profile-stack" style={{ marginTop: 14 }}>
            {completedReportLessons.map((lesson) => (
              <div key={lesson.lessonSessionId} className="profile-item">
                <div className="profile-item-head">
                  <strong>{lesson.title}</strong>
                  <span className="pill">{lesson.status}</span>
                </div>
                <p className="meta" style={{ marginBottom: 6 }}>
                  {lesson.objective.code}: {lesson.objective.title}
                </p>
                <p className="meta">
                  {lesson.progressLabel}{" "}
                  {lesson.accuracy != null ? `Accuracy ${formatPercent(lesson.accuracy)}. ` : ""}
                  Last activity {formatReportDate(lesson.lastActiveAt ?? lesson.updatedAt)}.
                </p>
              </div>
            ))}
            {!completedReportLessons.length ? (
              <p className="meta">
                No completed lessons have been recorded for this profile yet. Lesson progress will be reported here once sessions are completed.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div style={{ height: 20 }} />

      <div className="grid grid-2">
        <div className="card">
          <h2>Interest factors</h2>
          <p className="meta">
            Capture two specific factors for each learner interest so the wrapper can stay context relevant, for example `SPORT:FOOTBALL` and `SPORT:MANCHESTER_UNITED`.
          </p>
          <label className="label">Category</label>
          <input
            className="input"
            value={interestDraft.category}
            onChange={(event) =>
              setInterestDraft((current) => ({
                ...current,
                category: event.target.value,
              }))
            }
            placeholder="SPORT, ART, MUSIC, GAMING..."
          />
          <label className="label" style={{ marginTop: 12 }}>Primary factor</label>
          <input
            className="input"
            value={interestDraft.primaryFactor}
            onChange={(event) =>
              setInterestDraft((current) => ({
                ...current,
                primaryFactor: event.target.value,
              }))
            }
            placeholder="FOOTBALL, DRAWING, PIANO..."
          />
          <label className="label" style={{ marginTop: 12 }}>Secondary factor</label>
          <input
            className="input"
            value={interestDraft.secondaryFactor}
            onChange={(event) =>
              setInterestDraft((current) => ({
                ...current,
                secondaryFactor: event.target.value,
              }))
            }
            placeholder="MANCHESTER UNITED, MANGA, JAZZ..."
          />
          <label className="label" style={{ marginTop: 12 }}>Optional notes</label>
          <textarea
            className="input"
            rows={4}
            value={interestDraft.notes}
            onChange={(event) =>
              setInterestDraft((current) => ({
                ...current,
                notes: event.target.value,
              }))
            }
            placeholder="Any extra context about how the learner connects to these interests"
          />
          <div style={{ marginTop: 12 }}>
            <button
              className="btn btn-primary"
              disabled={
                savingVector ||
                !interestDraft.category.trim() ||
                !interestDraft.primaryFactor.trim() ||
                !interestDraft.secondaryFactor.trim()
              }
              onClick={handleCreateInterestFactors}
            >
              Add 2-factor interest
            </button>
          </div>
        </div>

        <div className="card">
          <h2>Wrapper vectors</h2>
          <p className="meta">
            These editable vectors shape the personalised wrapper around the learner journey after assessment, alongside ndscreen context.
          </p>
          <div className="profile-stack" style={{ marginTop: 14 }}>
            {(profile?.wrapperVectors ?? []).map((vector) => (
              <div key={vector.id} className="profile-item">
                <div className="profile-item-head">
                  <strong>{vector.title}</strong>
                  <span className="pill">{vector.scope}</span>
                </div>
                <p className="meta" style={{ marginBottom: 8 }}>
                  {vector.content}
                </p>
                <p className="meta">
                  {vector.strand ? `Strand: ${vector.strand}. ` : ""}
                  {vector.objective ? `Objective: ${vector.objective.code}. ` : ""}
                  {vector.isActive ? "Active in lesson wrapping." : "Inactive."}
                </p>
                <div className="button-row" style={{ marginTop: 10 }}>
                  <button
                    className="btn btn-secondary"
                    disabled={savingVector}
                    onClick={() => handleToggleVector(vector)}
                  >
                    {vector.isActive ? "Pause vector" : "Activate vector"}
                  </button>
                  <button
                    className="btn btn-secondary"
                    disabled={savingVector}
                    onClick={() => handleDeleteVector(vector.id)}
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
            {!profile?.wrapperVectors?.length ? (
              <p className="meta">
                No wrapper vectors have been added yet. Add delivery notes below to personalise the next vectored question rounds.
              </p>
            ) : null}
          </div>
        </div>

        <div className="card">
          <h2>Add wrapper vector</h2>
          <label className="label">Title</label>
          <input
            className="input"
            value={vectorDraft.title}
            onChange={(event) =>
              setVectorDraft((current) => ({ ...current, title: event.target.value }))
            }
            placeholder="Short vector name"
          />
          <label className="label" style={{ marginTop: 12 }}>Scope</label>
          <input
            className="input"
            value={vectorDraft.scope}
            onChange={(event) =>
              setVectorDraft((current) => ({ ...current, scope: event.target.value }))
            }
            placeholder="GENERAL, STRAND, REGULATION, LANGUAGE..."
          />
          <label className="label" style={{ marginTop: 12 }}>Optional strand</label>
          <input
            className="input"
            value={vectorDraft.strand}
            onChange={(event) =>
              setVectorDraft((current) => ({ ...current, strand: event.target.value }))
            }
            placeholder="Number, Algebra, Geometry..."
          />
          <label className="label" style={{ marginTop: 12 }}>Vector content</label>
          <textarea
            className="input"
            rows={6}
            value={vectorDraft.content}
            onChange={(event) =>
              setVectorDraft((current) => ({ ...current, content: event.target.value }))
            }
            placeholder="How should the wrapper adapt for this learner?"
          />
          <div style={{ marginTop: 12 }}>
            <button
              className="btn btn-primary"
              disabled={savingVector || !vectorDraft.title.trim() || !vectorDraft.content.trim()}
              onClick={handleCreateVector}
            >
              Add vector
            </button>
          </div>
        </div>
      </div>

      <div style={{ height: 20 }} />

      <div className="grid grid-2">
        <div className="card">
          <h2>Interventions</h2>
          <div className="profile-stack">
            {(profile?.recommendations.course.interventions ?? []).map((item) => (
              <div key={`${item.label}-${item.targetYear ?? "na"}`} className="profile-item">
                <div className="profile-item-head">
                  <strong>{item.label}</strong>
                  <span className="pill">{item.severity}</span>
                </div>
                <p className="meta">{item.reason}</p>
              </div>
            ))}
            {!profile?.recommendations.course.interventions?.length ? (
              <p className="meta">
                No standalone intervention is currently flagged. The course can stay blended and adaptive.
              </p>
            ) : null}
          </div>
        </div>

        <div className="card">
          <h2>Weighted modules</h2>
          <div className="profile-stack">
            {(profile?.recommendations.course.weightedModules ?? []).slice(0, 6).map((module) => (
              <div key={module.moduleId} className="profile-item">
                <div className="profile-item-head">
                  <strong>{module.title}</strong>
                  <span className="pill">{module.weight}%</span>
                </div>
                <p className="meta">
                  {module.yearGroup != null ? `Year ${module.yearGroup}. ` : ""}
                  {module.reason}
                </p>
              </div>
            ))}
            {!profile?.recommendations.course.weightedModules?.length ? (
              <p className="meta">
                Weighted NewtonCentre modules will appear here when the course catalogue integration is configured.
              </p>
            ) : null}
          </div>
        </div>
      </div>

      <div style={{ height: 20 }} />

      <div className="grid grid-2">
        <div className="card">
          <h2>{subjectTitle} assessment</h2>
          <div className="small-grid">
            <div>
              <strong>Working band:</strong>{" "}
              {displayBand}
            </div>
            <div>
              <strong>Confidence:</strong>{" "}
              {typeof (profile?.assessment?.overallConfidence ?? state.result?.overallConfidence) ===
              "number"
                ? `${Math.round(
                    (profile?.assessment?.overallConfidence ?? state.result?.overallConfidence ?? 0) *
                      100
                  )}%`
                : "-"}
            </div>
            <div>
              <strong>Questions answered:</strong>{" "}
              {profile?.assessment?.questionCount ?? state.result?.questionCount ?? "-"}
            </div>
            <div>
              <strong>Entry year:</strong>{" "}
              {profile?.assessment?.entryYear != null
                ? `Year ${profile.assessment.entryYear}`
                : "-"}
            </div>
          </div>
        </div>

        <div className="card">
          <h2>ndscreen summary</h2>
          {profile?.screening ? (
            <div className="small-grid">
              <div>
                <strong>Status:</strong> {profile.screening.status ?? "Not linked"}
              </div>
              <div>
                <strong>Screening kind:</strong>{" "}
                {profile.screening.screeningKind ?? "-"}
              </div>
              <div>
                <strong>Question set:</strong>{" "}
                {profile.screening.questionSet?.key ?? "-"}
              </div>
              <div>
                <strong>Latest profile:</strong>{" "}
                {profile.screening.learningProfile?.primaryProfile ??
                  profile.screening.latestResult?.profileType ??
                  "-"}
              </div>
              <div>
                <strong>Confidence:</strong>{" "}
                {profile.screening.learningProfile?.confidence != null
                  ? `${Math.round(profile.screening.learningProfile.confidence * 100)}%`
                  : profile.screening.latestResult?.confidence != null
                  ? `${Math.round(profile.screening.latestResult.confidence * 100)}%`
                  : "-"}
              </div>
              <div>
                <strong>Report:</strong>{" "}
                {profile.screening.report?.status ?? "Not ready"}
              </div>
            </div>
          ) : (
            <p className="meta">
              No ndscreen session is linked yet. Add one above to bring the
              screening profile into this view.
            </p>
          )}
        </div>
      </div>

      <div style={{ height: 20 }} />

      <div className="card">
        <h2>Priority strands</h2>
        <div className="profile-stack">
          {(profile?.recommendations.strands ?? []).map((strand) => (
            <div key={strand.strand} className="profile-item">
              <div className="profile-item-head">
                <strong>
                  {strand.priority}. {strand.strand}
                </strong>
                <span className="pill">
                  {strand.evidenceLabel ?? `${Math.round(strand.accuracy * 100)}% accuracy`}
                </span>
              </div>
              <p className="meta">
                {strand.reason} Secure year:{" "}
                {strand.secureYear != null ? `Year ${strand.secureYear}` : "not secure yet"}.
              </p>
            </div>
          ))}
          {!profile?.recommendations.strands.length ? (
            <p className="meta">
              Strand priorities will appear here once the assessment evidence has
              been loaded.
            </p>
          ) : null}
        </div>
      </div>

      <div style={{ height: 20 }} />

      <div className="card">
        <div className="profile-item-head">
          <div>
            <h2>Recommended objectives</h2>
            <p className="meta">
              {selectedObjectiveDomain
                ? domainObjectivesLoading
                  ? "Loading objective catalogue..."
                  : `${domainObjectives?.count ?? 0} ${objectiveDomainOptions
                      .find((domain) => domain.value === selectedObjectiveDomain)
                      ?.label.toLowerCase()} objectives across ${formatYearList(
                      domainRequirementYears
                    )}.`
                : "Showing assessment-led recommended objectives."}
            </p>
          </div>
          {selectedObjectiveDomain ? (
            <span className="pill">
              {
                objectiveDomainOptions.find(
                  (domain) => domain.value === selectedObjectiveDomain
                )?.label
              }
            </span>
          ) : null}
        </div>
        {reportSubject === "MATHS" ? (
          <div className="button-row" style={{ marginBottom: 14 }}>
            <button
              className={`btn ${selectedObjectiveDomain === "" ? "btn-primary" : "btn-secondary"}`}
              onClick={() => setSelectedObjectiveDomain("")}
            >
              All
            </button>
            {objectiveDomainOptions.map((domain) => (
              <button
                key={domain.value}
                className={`btn ${
                  selectedObjectiveDomain === domain.value
                    ? "btn-primary"
                    : "btn-secondary"
                }`}
                onClick={() => setSelectedObjectiveDomain(domain.value)}
              >
                {domain.label}
              </button>
            ))}
          </div>
        ) : null}
        <div className="profile-stack">
          {selectedObjectiveDomain ? (
            domainObjectivesLoading ? (
              <p className="meta">Loading objectives...</p>
            ) : (
              groupedDomainObjectives.map((group) => (
                <div
                  key={`${group.yearGroup ?? "na"}-${group.strand}`}
                  className="profile-item"
                >
                  <div className="profile-item-head">
                    <strong>
                      {group.yearGroup != null ? `Year ${group.yearGroup}` : "Year n/a"} ·{" "}
                      {group.strand}
                    </strong>
                    <span className="pill">{group.items.length} objectives</span>
                  </div>
                  <div className="profile-stack" style={{ marginTop: 12 }}>
                    {group.items.map((objective) => (
                      <div key={objective.id} className="lesson-support-item">
                        <div className="profile-item-head">
                          <strong>{objective.title}</strong>
                          <span className="pill">{objective.keyStage}</span>
                        </div>
                        <p className="meta">
                          {objective.contentChunkCount} chunks ·{" "}
                          {objective.canonicalQuestionCount} canonical questions
                        </p>
                        <div style={{ marginTop: 12 }}>
                          <div className="button-row">
                            <button
                              className="btn btn-primary"
                              onClick={() => {
                                const params = new URLSearchParams({
                                  objectiveId: objective.id,
                                  domain: selectedObjectiveDomain,
                                });
                                navigate(`/lesson-builder?${params.toString()}`);
                              }}
                            >
                              Open lesson builder
                            </button>
                            <button
                              className="btn btn-secondary"
                              onClick={() => navigate(`/lesson/${objective.id}`)}
                            >
                              Quick preview
                            </button>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              ))
            )
          ) : (
            recommendedObjectives.map((objective) => (
              <div key={objective.objectiveId} className="profile-item">
                <div className="profile-item-head">
                  <strong>{objective.title}</strong>
                  <span className="pill">
                    {objective.yearGroup != null ? `Year ${objective.yearGroup}` : "Year n/a"}
                  </span>
                </div>
                <p className="meta" style={{ marginBottom: 6 }}>
                  {objective.strand}
                </p>
                <p className="meta">
                  {objective.reason} Source: {objective.source.replaceAll("_", " ")}.
                </p>
                <div style={{ marginTop: 12 }}>
                  <div className="button-row">
                    <button
                      className="btn btn-primary"
                      onClick={() =>
                        navigate(`/lesson-builder?objectiveId=${objective.objectiveId}`)
                      }
                    >
                      Open lesson builder
                    </button>
                    <button
                      className="btn btn-secondary"
                      onClick={() => navigate(`/lesson/${objective.objectiveId}`)}
                    >
                      Quick preview
                    </button>
                  </div>
                </div>
              </div>
            ))
          )}
          {!profile?.recommendations.objectives.length ? (
            <p className="meta">
              Objective recommendations will appear here once the combined profile
              has been built.
            </p>
          ) : null}
          {!selectedObjectiveDomain &&
          profile?.recommendations.objectives.length &&
          !recommendedObjectives.length ? (
            <p className="meta">
              No recommended objectives match this filter yet.
            </p>
          ) : null}
          {selectedObjectiveDomain &&
          !domainObjectivesLoading &&
          !(domainObjectives?.items.length ?? 0) ? (
            <p className="meta">
              No objectives are available for this domain and requirement path yet.
            </p>
          ) : null}
        </div>
      </div>

      {profile?.screening?.learningProfile?.summary ||
      profile?.screening?.learningProfile?.recommendation ? (
        <>
          <div style={{ height: 20 }} />
          <div className="card">
            <h2>Screening-informed support notes</h2>
            <p className="meta">
              {profile.screening.learningProfile?.summary ??
                profile.screening.learningProfile?.summaryText}
            </p>
            {profile.screening.learningProfile?.recommendation ? (
              <p className="meta">
                <strong>Recommended support:</strong>{" "}
                {profile.screening.learningProfile.recommendation}
              </p>
            ) : null}
          </div>
        </>
      ) : null}

      <div style={{ height: 20 }} />

    </Layout>
  );
}
