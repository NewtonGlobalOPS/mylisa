import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import Layout from "../components/Layout";
import {
  ApiError,
  buildBespokeLesson,
  createLessonPlanFromTopic,
  createLiveLesson,
  generateBespokeSectionContent,
  getCombinedChildProfile,
  getLessonRuntimeByObjective,
  getNewtonCentreTimetableGroups,
  listCurriculumObjectives,
  searchCurriculumStrands,
} from "../api/assessmentApi";
import type {
  CombinedChildProfileResponse,
  BespokeLessonBuildResponse,
  BespokeSectionContentResponse,
  CurriculumObjectiveListResponse,
  CurriculumStrandSearchResponse,
  LessonPlanResponse,
  LessonRuntimeResponse,
  NewtonCentreTimetableGroupsResponse,
} from "../types/assessment";
import { loadState } from "../utils/storage";

type SelectionMode = "auto" | "custom";
type LessonSubject = "MATHS" | "SCIENCE";
type MathsObjectiveDomain =
  | "NUMBER"
  | "ALGEBRA"
  | "GEOMETRY"
  | "DATA"
  | "RATIO"
  | "PROBABILITY";
type RecommendedObjective =
  CombinedChildProfileResponse["recommendations"]["objectives"][number] & {
    learnerCount?: number;
    learnerNames?: string[];
  };
type SubscribedStudent = NewtonCentreTimetableGroupsResponse["groups"][number]["students"][number] & {
  groupId: string;
  groupTitle: string;
  dayLabel: string;
  startTime: string;
  subject: string;
  keyStage: string | null;
};

const objectiveDomainOptions: Array<{ value: MathsObjectiveDomain; label: string }> = [
  { value: "NUMBER", label: "Number" },
  { value: "ALGEBRA", label: "Algebra" },
  { value: "GEOMETRY", label: "Geometry" },
  { value: "DATA", label: "Data" },
  { value: "RATIO", label: "Ratio" },
  { value: "PROBABILITY", label: "Probability" },
];

const keyStageOptions = [
  { value: "KS1", label: "KS1" },
  { value: "KS2", label: "KS2" },
  { value: "KS3", label: "KS3" },
  { value: "KS4", label: "KS4" },
] as const;

const yearGroupOptions = Array.from({ length: 13 }, (_, index) => index + 1);

function isMathsObjectiveDomain(value: string): value is MathsObjectiveDomain {
  return objectiveDomainOptions.some((option) => option.value === value);
}

function normaliseLessonSubject(value: string | null | undefined): LessonSubject | null {
  const normalized = String(value ?? "").trim().toUpperCase();
  if (normalized.includes("SCIENCE")) return "SCIENCE";
  if (normalized.includes("MATH")) return "MATHS";
  return null;
}

function textMatchesAny(value: string, terms: string[]) {
  const normalized = value.toLowerCase();
  return terms.some((term) => normalized.includes(term));
}

function objectiveMatchesDomain(
  objective: { title?: string | null; strand?: string | null; statement?: string | null },
  domain: MathsObjectiveDomain | "",
) {
  if (!domain) return true;

  const text = [objective.title, objective.strand, objective.statement].filter(Boolean).join(" ");
  switch (domain) {
    case "ALGEBRA":
      return textMatchesAny(text, [
        "algebra",
        "expression",
        "equation",
        "formula",
        "sequence",
        "function",
        "graph",
        "linear",
        "inequal",
        "iteration",
        "simultaneous",
      ]);
    case "GEOMETRY":
      return textMatchesAny(text, [
        "geometry",
        "geometrical",
        "shape",
        "angle",
        "perimeter",
        "area",
        "volume",
        "construction",
        "trigonometry",
        "similarity",
        "pythagoras",
        "bearing",
        "loci",
        "coordinate",
        "position",
        "direction",
        "symmetry",
        "transformation",
        "elevation",
        "polygon",
      ]);
    case "DATA":
      return textMatchesAny(text, ["data", "statistic", "sampling", "summary", "table"]);
    case "RATIO":
      return textMatchesAny(text, [
        "ratio",
        "proportion",
        "multiplicative relationship",
        "compound measure",
      ]);
    case "PROBABILITY":
      return textMatchesAny(text, ["probability", "probabilities"]);
    case "NUMBER":
      return textMatchesAny(text, [
        "number",
        "place value",
        "fraction",
        "decimal",
        "integer",
        "arithmetic",
        "addition",
        "subtraction",
        "multiplication",
        "division",
        "calculating",
        "rounding",
        "standard form",
        "surds",
        "money",
        "measure",
        "time",
        "coin",
      ]);
    default:
      return true;
  }
}

function aggregateRecommendedObjectives(
  profiles: CombinedChildProfileResponse[]
): RecommendedObjective[] {
  const byObjective = new Map<string, RecommendedObjective & { score: number }>();

  for (const profile of profiles) {
    for (const objective of profile.recommendations.objectives) {
      const existing = byObjective.get(objective.objectiveId);
      const score =
        10 +
        (objective.priorityWeight ?? 0) * 3 +
        (objective.gapSeverity ?? 0) * 4 +
        (objective.occurrenceCount ?? 0);

      if (existing) {
        existing.score += score;
        existing.learnerCount = (existing.learnerCount ?? 1) + 1;
        existing.learnerNames = Array.from(
          new Set([...(existing.learnerNames ?? []), profile.child.displayName])
        );
        existing.reason = `${existing.learnerCount} learners need this objective.`;
        continue;
      }

      byObjective.set(objective.objectiveId, {
        ...objective,
        score,
        learnerCount: 1,
        learnerNames: [profile.child.displayName],
      });
    }
  }

  return Array.from(byObjective.values())
    .sort((a, b) => b.score - a.score || (b.learnerCount ?? 0) - (a.learnerCount ?? 0))
    .map(({ score: _score, ...objective }) => objective)
    .slice(0, 8);
}

export default function LessonBuilderPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const state = loadState();
  const stateStudentId = state.student?.studentId ?? "";

  const selectedObjectiveId = searchParams.get("objectiveId")?.trim() ?? "";
  const selectedGroupId = searchParams.get("groupId")?.trim() ?? "";
  const selectedStudentId = searchParams.get("studentId")?.trim() ?? "";
  const selectedStudentIdsParam = searchParams.get("studentIds")?.trim() ?? "";
  const selectedStudentIdsFromParams = selectedStudentIdsParam
    .split(",")
    .map((id) => id.trim())
    .filter(Boolean);
  const selectedSubjectParam = normaliseLessonSubject(searchParams.get("subject"));
  const objectiveSearch = searchParams.get("search")?.trim() ?? "";
  const topicParam = searchParams.get("topic")?.trim() ?? "";
  const teachingKeyStageParam = searchParams.get("teachKeyStage")?.trim().toUpperCase() ?? "";
  const teachingYearParam = searchParams.get("teachYear")?.trim() ?? "";
  const teachingYearFromParams = teachingYearParam ? Number.parseInt(teachingYearParam, 10) : null;
  const objectiveDomainParam = searchParams.get("domain")?.trim().toUpperCase() ?? "";
  const selectedObjectiveDomain: MathsObjectiveDomain | "" =
    isMathsObjectiveDomain(objectiveDomainParam) ? objectiveDomainParam : "";
  const studentId = selectedStudentIdsFromParams[0] || selectedStudentId || stateStudentId;
  const stateMatchesSelectedStudent = !selectedStudentId || selectedStudentId === stateStudentId;
  const assessmentSessionId = stateMatchesSelectedStudent ? state.sessionId || undefined : undefined;
  const ndscreenSessionId = stateMatchesSelectedStudent
    ? state.ndscreenSessionId?.trim() || undefined
    : undefined;

  const [selectionMode, setSelectionMode] = useState<SelectionMode>("auto");
  const [selectedChunkIds, setSelectedChunkIds] = useState<string[]>([]);
  const [objectivesLoading, setObjectivesLoading] = useState(true);
  const [groupsLoading, setGroupsLoading] = useState(true);
  const [profileLoading, setProfileLoading] = useState(true);
  const [runtimeLoading, setRuntimeLoading] = useState(false);
  const [bespokeLoading, setBespokeLoading] = useState(false);
  const [sectionContentLoadingKey, setSectionContentLoadingKey] = useState<string | null>(null);
  const [sectionContent, setSectionContent] = useState<BespokeSectionContentResponse | null>(null);
  const [launchingLiveLesson, setLaunchingLiveLesson] = useState(false);
  const [error, setError] = useState("");
  const [topicInput, setTopicInput] = useState(topicParam || objectiveSearch || "");
  const [learnerSearch, setLearnerSearch] = useState("");
  const [profiles, setProfiles] = useState<CombinedChildProfileResponse[]>([]);
  const [objectives, setObjectives] =
    useState<CurriculumObjectiveListResponse | null>(null);
  const [strandResults, setStrandResults] =
    useState<CurriculumStrandSearchResponse | null>(null);
  const [groups, setGroups] =
    useState<NewtonCentreTimetableGroupsResponse | null>(null);
  const [runtime, setRuntime] = useState<LessonRuntimeResponse | null>(null);
  const [bespokeLesson, setBespokeLesson] = useState<BespokeLessonBuildResponse | null>(null);
  const [lessonPlan, setLessonPlan] = useState<LessonPlanResponse | null>(null);

  const activeChunkIds = useMemo(() => {
    if (selectionMode === "custom") {
      return selectedChunkIds;
    }

    return runtime?.screenPayload.supportSelection.selectedChunkIds ?? [];
  }, [runtime, selectedChunkIds, selectionMode]);

  const timetableGroups = groups?.groups ?? [];

  const selectedGroup = useMemo(
    () => timetableGroups.find((group) => group.id === selectedGroupId) ?? null,
    [timetableGroups, selectedGroupId],
  );

  const subscribedStudents = useMemo<SubscribedStudent[]>(() => {
    const rows = timetableGroups.flatMap((group) =>
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
        if (!student.mylisaStudentId) return false;
        const key = student.mylisaStudentId;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      })
      .sort((a, b) => a.displayName.localeCompare(b.displayName));
  }, [timetableGroups]);

  const visibleSubscribedStudents = useMemo(() => {
    const normalizedQuery = learnerSearch.trim().toLowerCase();
    return subscribedStudents.filter((student) => {
      if (!normalizedQuery) return true;
      return [
        student.displayName,
        student.workspaceEmail,
        student.groupTitle,
        student.subject,
        student.parentEmails.join(" "),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [learnerSearch, subscribedStudents]);

  const selectedGroupStudentIds = useMemo(
    () =>
      selectedGroup
        ? selectedGroup.students
            .map((student) => student.mylisaStudentId)
            .filter((id): id is string => Boolean(id))
        : [],
    [selectedGroup],
  );

  const selectedLearnerIds = selectedGroup
    ? selectedGroupStudentIds
    : selectedStudentIdsFromParams.length
    ? selectedStudentIdsFromParams
    : [studentId].filter(Boolean);
  const launchStudentIds = selectedLearnerIds;
  const hasUnmappedGroupStudents = Boolean(selectedGroup?.unmappedStudentCount);
  const primaryProfile =
    profiles.find((item) => item.child.id === studentId) ?? profiles[0] ?? null;
  const learnerKeyStage =
    primaryProfile?.child.keyStage ??
    state.student?.student.keyStage ??
    selectedGroup?.keyStage ??
    undefined;
  const learnerSchoolYear =
    primaryProfile?.child.schoolYear ?? state.student?.student.schoolYear ?? null;
  const selectedTeachingKeyStage =
    keyStageOptions.some((option) => option.value === teachingKeyStageParam)
      ? teachingKeyStageParam
      : learnerKeyStage;
  const selectedTeachingYear =
    Number.isInteger(teachingYearFromParams) &&
    teachingYearFromParams !== null &&
    teachingYearFromParams >= 1 &&
    teachingYearFromParams <= 13
      ? teachingYearFromParams
      : learnerSchoolYear;
  const selectedLearnerFromSearch =
    subscribedStudents.find((student) => student.mylisaStudentId === studentId) ?? null;
  const stateStudentName = [state.student?.student.firstName, state.student?.student.lastName]
    .filter(Boolean)
    .join(" ")
    .trim();
  const assignedLearnerLabel =
    primaryProfile?.child.displayName ??
    selectedLearnerFromSearch?.displayName ??
    (stateStudentName || "");
  const selectedSubject: LessonSubject =
    selectedSubjectParam ??
    normaliseLessonSubject(selectedGroup?.subject) ??
    (state.subject === "SCIENCE" ? "SCIENCE" : "MATHS");
  const profileStudentIds = selectedLearnerIds;
  const recommendedObjectives = useMemo(
    () =>
      aggregateRecommendedObjectives(profiles).filter((objective) =>
        selectedSubject === "MATHS" && objectiveMatchesDomain(objective, selectedObjectiveDomain)
      ),
    [profiles, selectedObjectiveDomain, selectedSubject]
  );
  const assessmentStrands = useMemo(() => {
    const byStrand = new Map<
      string,
      {
        strand: string;
        asked: number;
        correct: number;
        accuracy: number;
        confidence: number;
        secureYear: number | null;
        emergingYear: number | null;
        learnerNames: string[];
      }
    >();

    for (const profile of profiles) {
      for (const strand of profile.assessment?.strands ?? []) {
        if (!strand.strand || strand.asked <= 0) continue;
        const key = strand.strand.toLowerCase();
        const existing =
          byStrand.get(key) ??
          {
            strand: strand.strand,
            asked: 0,
            correct: 0,
            accuracy: 0,
            confidence: 0,
            secureYear: null,
            emergingYear: null,
            learnerNames: [],
          };
        existing.asked += strand.asked;
        existing.correct += strand.correct;
        existing.confidence = Math.max(existing.confidence, strand.confidence);
        existing.secureYear =
          existing.secureYear == null
            ? strand.secureYear
            : strand.secureYear == null
            ? existing.secureYear
            : Math.max(existing.secureYear, strand.secureYear);
        existing.emergingYear =
          existing.emergingYear == null
            ? strand.emergingYear
            : strand.emergingYear == null
            ? existing.emergingYear
            : Math.max(existing.emergingYear, strand.emergingYear);
        existing.learnerNames = Array.from(
          new Set([...existing.learnerNames, profile.child.displayName])
        );
        existing.accuracy = existing.asked > 0 ? existing.correct / existing.asked : 0;
        byStrand.set(key, existing);
      }
    }

    return Array.from(byStrand.values()).sort(
      (a, b) => a.accuracy - b.accuracy || b.asked - a.asked
    );
  }, [profiles]);

  useEffect(() => {
    if (!profileStudentIds.length) {
      setProfiles([]);
      setProfileLoading(false);
      return;
    }

    async function loadProfiles() {
      setProfileLoading(true);
      setError("");

      try {
        const nextProfiles = await Promise.all(
          profileStudentIds.map((profileStudentId) =>
            getCombinedChildProfile({
              studentId: profileStudentId,
              subject: selectedSubject,
              assessmentSessionId:
                profileStudentId === stateStudentId ? assessmentSessionId : undefined,
              ndscreenSessionId:
                profileStudentId === stateStudentId ? ndscreenSessionId : undefined,
            })
          )
        );
        setProfiles(nextProfiles);

        const firstRecommendedObjective = aggregateRecommendedObjectives(nextProfiles)[0];
        if (!selectedObjectiveId && firstRecommendedObjective) {
          const params = new URLSearchParams(searchParams);
          params.set("objectiveId", firstRecommendedObjective.objectiveId);
          setSearchParams(params);
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load learner report vectors");
      } finally {
        setProfileLoading(false);
      }
    }

    void loadProfiles();
  }, [
    assessmentSessionId,
    ndscreenSessionId,
    profileStudentIds.join(","),
    selectedObjectiveId,
    selectedSubject,
    stateStudentId,
    studentId,
  ]);

  useEffect(() => {
    async function loadObjectives() {
      setObjectivesLoading(true);
      setError("");

      try {
        const next = await listCurriculumObjectives({
          subject: selectedSubject,
          keyStage: selectedTeachingKeyStage as "KS1" | "KS2" | "KS3" | "KS4" | undefined,
          yearGroup: selectedTeachingYear ?? undefined,
          domain: selectedSubject === "MATHS" ? selectedObjectiveDomain || undefined : undefined,
          hasCanonical: true,
          search: objectiveSearch || undefined,
          limit: 30,
        });
        setObjectives(next);
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load lesson objectives"
        );
      } finally {
        setObjectivesLoading(false);
      }
    }

    void loadObjectives();
  }, [objectiveDomainParam, objectiveSearch, selectedSubject, selectedTeachingKeyStage, selectedTeachingYear]);

  useEffect(() => {
    const query = topicInput.trim() || objectiveSearch;
    if (!query) {
      setStrandResults(null);
      return;
    }

    let cancelled = false;

    async function loadStrands() {
      try {
        const next = await searchCurriculumStrands({
          subject: selectedSubject,
          search: query,
          domain: selectedSubject === "MATHS" ? selectedObjectiveDomain || undefined : undefined,
          hasCanonical: true,
          limit: 120,
        });
        if (!cancelled) setStrandResults(next);
      } catch {
        if (!cancelled) setStrandResults(null);
      }
    }

    void loadStrands();
    return () => {
      cancelled = true;
    };
  }, [objectiveSearch, selectedObjectiveDomain, selectedSubject, topicInput]);

  useEffect(() => {
    async function loadGroups() {
      setGroupsLoading(true);
      setError("");

      try {
        const next = await getNewtonCentreTimetableGroups();
        setGroups(next);

        if (selectedGroupId && !selectedStudentId) {
          const selected = next.groups.find((group) => group.id === selectedGroupId);
          const mappedStudentIds =
            selected?.students
              .map((student) => student.mylisaStudentId)
              .filter((id): id is string => Boolean(id)) ?? [];
          if (mappedStudentIds.length) {
            const params = new URLSearchParams(searchParams);
            params.set("studentId", mappedStudentIds[0]);
            params.set("studentIds", mappedStudentIds.join(","));
            setSearchParams(params);
          }
          return;
        }

        return;
      } catch (err) {
        setError(
          err instanceof Error ? err.message : "Failed to load Newton Centre timetable"
        );
      } finally {
        setGroupsLoading(false);
      }
    }

    void loadGroups();
  }, []);

  useEffect(() => {
    if (!studentId || !selectedObjectiveId) {
      setRuntime(null);
      return;
    }

    async function loadRuntime() {
      setRuntimeLoading(true);
      setError("");

      try {
        const next = await getLessonRuntimeByObjective({
          objectiveId: selectedObjectiveId,
          studentId,
          assessmentSessionId,
          ndscreenSessionId,
          selectedChunkIds:
            selectionMode === "custom" ? selectedChunkIds : undefined,
        });
        setRuntime(next);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to build lesson");
      } finally {
        setRuntimeLoading(false);
      }
    }

    void loadRuntime();
  }, [
    assessmentSessionId,
    ndscreenSessionId,
    selectedChunkIds,
    selectedObjectiveId,
    selectionMode,
    studentId,
  ]);

  function setObjectiveSearchValue(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value.trim()) next.set("search", value.trim());
    else next.delete("search");
    setSearchParams(next);
  }

  function findMatchingObjectives() {
    const topic = topicInput.trim();
    const next = new URLSearchParams(searchParams);
    if (topic) {
      next.set("topic", topic);
      next.set("search", topic);
    } else {
      next.delete("search");
    }
    setSearchParams(next);
  }

  function assignLearner(nextStudentId: string) {
    const next = new URLSearchParams(searchParams);
    next.set("studentId", nextStudentId);
    next.set("studentIds", nextStudentId);
    next.delete("groupId");
    setSearchParams(next);
    setSelectionMode("auto");
    setSelectedChunkIds([]);
    setRuntime(null);
  }

  function toggleLearner(nextStudentId: string) {
    const currentIds = selectedLearnerIds.length ? selectedLearnerIds : [studentId].filter(Boolean);
    const nextIds = currentIds.includes(nextStudentId)
      ? currentIds.filter((id) => id !== nextStudentId)
      : [...currentIds, nextStudentId];
    const next = new URLSearchParams(searchParams);

    next.delete("groupId");
    if (nextIds.length) {
      next.set("studentId", nextIds[0]);
      next.set("studentIds", nextIds.join(","));
    } else {
      next.delete("studentId");
      next.delete("studentIds");
    }

    setSearchParams(next);
    setSelectionMode("auto");
    setSelectedChunkIds([]);
    setRuntime(null);
  }

  function chooseSearchStrand(input: {
    strand: string;
    keyStage?: string | null;
    yearGroup?: number | null;
  }) {
    const next = new URLSearchParams(searchParams);
    next.set("topic", input.strand);
    next.set("search", input.strand);
    if (input.keyStage) next.set("teachKeyStage", input.keyStage);
    if (typeof input.yearGroup === "number") next.set("teachYear", String(input.yearGroup));
    next.delete("objectiveId");
    setTopicInput(input.strand);
    setBespokeLesson(null);
    setLessonPlan(null);
    setSelectionMode("auto");
    setSelectedChunkIds([]);
    setSearchParams(next);
  }

  function setTeachingKeyStage(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("teachKeyStage", value);
    else next.delete("teachKeyStage");
    next.delete("objectiveId");
    setSearchParams(next);
    setSelectionMode("auto");
    setSelectedChunkIds([]);
  }

  function setTeachingYear(value: string) {
    const next = new URLSearchParams(searchParams);
    if (value) next.set("teachYear", value);
    else next.delete("teachYear");
    next.delete("objectiveId");
    setSearchParams(next);
    setSelectionMode("auto");
    setSelectedChunkIds([]);
  }

  async function generateBespokeTopicLesson() {
    const topic = topicInput.trim();
    if (!topic) {
      setError("Enter a lesson topic first.");
      return;
    }

    setBespokeLoading(true);
    setError("");
    try {
      const next = await buildBespokeLesson({
        topic,
        subject: selectedSubject,
        keyStage: selectedTeachingKeyStage as "KS1" | "KS2" | "KS3" | "KS4" | undefined,
        yearGroup: selectedTeachingYear ?? undefined,
        domain: selectedSubject === "MATHS" ? selectedObjectiveDomain || undefined : undefined,
        maxObjectives: 6,
      });
      setBespokeLesson(next);

      const params = new URLSearchParams(searchParams);
      params.set("topic", topic);
      params.set("search", topic);
      if (!selectedObjectiveId && next.retrieval.objectives[0]) {
        params.set("objectiveId", next.retrieval.objectives[0].id);
      }
      setSearchParams(params);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to build bespoke lesson");
    } finally {
      setBespokeLoading(false);
    }
  }

  async function saveGovernedLessonPlan() {
    const topic = topicInput.trim();
    if (!topic) {
      setError("Enter a lesson topic first.");
      return;
    }
    if (!studentId) {
      setError("Choose a student before saving a lesson plan.");
      return;
    }

    setBespokeLoading(true);
    setError("");
    try {
      const next = await createLessonPlanFromTopic({
        studentId,
        topic,
        subject: selectedSubject,
        keyStage: selectedTeachingKeyStage as "KS1" | "KS2" | "KS3" | "KS4" | undefined,
        yearGroup: selectedTeachingYear ?? undefined,
        domain: selectedSubject === "MATHS" ? selectedObjectiveDomain || undefined : undefined,
        maxObjectives: 6,
        assessmentCadenceWeeks: 4,
      });
      setLessonPlan(next);

      const firstObjectiveId = next.objectives[0]?.objectiveId;
      if (firstObjectiveId) {
        const params = new URLSearchParams(searchParams);
        params.set("topic", topic);
        params.set("search", topic);
        params.set("objectiveId", firstObjectiveId);
        setSearchParams(params);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to save governed lesson plan");
    } finally {
      setBespokeLoading(false);
    }
  }

  async function generateSectionContent(
    section: BespokeLessonBuildResponse["guide"]["lessonSections"][number],
    sectionIndex: number,
  ) {
    if (!bespokeLesson) return;

    const loadingKey = `${section.title}-${sectionIndex}`;
    setSectionContentLoadingKey(loadingKey);
    setError("");
    try {
      const next = await generateBespokeSectionContent({
        topic: bespokeLesson.retrieval.topic,
        subject: bespokeLesson.guide.subject as "MATHS" | "SCIENCE" | "COMPUTING" | "ENGLISH",
        keyStage: bespokeLesson.guide.keyStage as "KS1" | "KS2" | "KS3" | "KS4" | null,
        yearGroup: bespokeLesson.guide.yearGroup,
        guideTitle: bespokeLesson.guide.title,
        section,
        objectives: bespokeLesson.retrieval.objectives.slice(0, 6).map((objective) => ({
          code: objective.code,
          title: objective.title,
          statement: objective.statement,
          strand: objective.strand,
          keyStage: objective.keyStage as "KS1" | "KS2" | "KS3" | "KS4",
          yearGroup: objective.yearGroup,
        })),
        questions: bespokeLesson.retrieval.questions.slice(0, 10).map((question) => ({
          id: question.id,
          promptText: question.promptText,
          answerText: question.answerText,
          difficulty: question.difficulty,
          objectiveCode: question.objectiveCode,
        })),
      });
      setSectionContent(next);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate section content");
    } finally {
      setSectionContentLoadingKey(null);
    }
  }

  function selectObjectiveDomain(domain: MathsObjectiveDomain | "") {
    const next = new URLSearchParams(searchParams);
    if (domain) next.set("domain", domain);
    else next.delete("domain");
    setSearchParams(next);
  }

  function selectSubject(subject: LessonSubject) {
    const next = new URLSearchParams(searchParams);
    next.set("subject", subject);
    next.delete("objectiveId");
    if (subject !== "MATHS") next.delete("domain");
    setSearchParams(next);
    setSelectionMode("auto");
    setSelectedChunkIds([]);
  }

  function selectObjective(objectiveId: string) {
    const next = new URLSearchParams(searchParams);
    next.set("objectiveId", objectiveId);
    setSearchParams(next);
    setSelectionMode("auto");
    setSelectedChunkIds([]);
  }

  function selectGroup(groupId: string) {
    const next = new URLSearchParams(searchParams);
    if (groupId) next.set("groupId", groupId);
    else next.delete("groupId");
    const group = timetableGroups.find((item) => item.id === groupId);
    const groupStudentIds =
      group?.students
        .map((student) => student.mylisaStudentId)
        .filter((id): id is string => Boolean(id)) ?? [];
    if (groupStudentIds[0]) next.set("studentId", groupStudentIds[0]);
    if (groupStudentIds.length) next.set("studentIds", groupStudentIds.join(","));
    else next.delete("studentIds");
    const groupSubject = normaliseLessonSubject(group?.subject);
    if (groupSubject) {
      next.set("subject", groupSubject);
      if (groupSubject !== "MATHS") next.delete("domain");
    }
    next.delete("objectiveId");
    next.delete("teachKeyStage");
    next.delete("teachYear");
    next.delete("topic");
    next.delete("search");
    setSearchParams(next);
    setTopicInput("");
    setBespokeLesson(null);
    setLessonPlan(null);
    setSelectionMode("auto");
    setSelectedChunkIds([]);
    setRuntime(null);
  }

  function toggleChunk(chunkId: string) {
    const baseline =
      selectionMode === "custom"
        ? selectedChunkIds
        : runtime?.screenPayload.supportSelection.selectedChunkIds ?? [];
    const nextIds = baseline.includes(chunkId)
      ? baseline.filter((id) => id !== chunkId)
      : [...baseline, chunkId];

    setSelectionMode("custom");
    setSelectedChunkIds(nextIds);
  }

  function resetAutoSelection() {
    setSelectionMode("auto");
    setSelectedChunkIds([]);
  }



  async function launchLiveLesson() {
    if (!selectedObjectiveId || !studentId || !runtime || !launchStudentIds.length) return;

    setLaunchingLiveLesson(true);
    setError("");
    try {
      const lesson = await createLiveLesson({
        objectiveId: selectedObjectiveId,
        studentIds: launchStudentIds,
        assessmentSessionId,
        ndscreenSessionId,
        lessonPlanId: lessonPlan?.id,
        selectedChunkIds: selectionMode === "custom" ? selectedChunkIds : undefined,
        title: selectedGroup
          ? `${selectedGroup.dayLabel} ${selectedGroup.startTime} ${selectedGroup.title}: ${runtime.screenPayload.objective.title}`
          : runtime.screenPayload.objective.title,
      });
      navigate(`/tutor/live-lessons/${lesson.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const returnTo = `${window.location.pathname}${window.location.search}`;
        navigate(`/login?redirect=${encodeURIComponent(returnTo)}`);
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to launch live lesson");
    } finally {
      setLaunchingLiveLesson(false);
    }
  }

  function openLessonPreview() {
    if (!selectedObjectiveId) return;

    const previewParams = new URLSearchParams();
    if (selectionMode === "custom" && selectedChunkIds.length > 0) {
      previewParams.set("selectedChunkIds", selectedChunkIds.join(","));
    }

    const suffix = previewParams.toString() ? `?${previewParams.toString()}` : "";
    navigate(`/lesson/${selectedObjectiveId}${suffix}`);
  }

  async function launchGuidedLesson() {
    const topic = topicInput.trim();
    if (!topic) {
      setError("Tell MyLisa what you want to teach first.");
      return;
    }
    if (!studentId) {
      setError("Choose a student before launching the lesson.");
      return;
    }

    setLaunchingLiveLesson(true);
    setError("");
    try {
      const governedPlan =
        lessonPlan ??
        (await createLessonPlanFromTopic({
          studentId,
          topic,
          subject: selectedSubject,
          keyStage: selectedTeachingKeyStage as "KS1" | "KS2" | "KS3" | "KS4" | undefined,
          yearGroup: selectedTeachingYear ?? undefined,
          domain: selectedSubject === "MATHS" ? selectedObjectiveDomain || undefined : undefined,
          maxObjectives: 6,
          assessmentCadenceWeeks: 4,
        }));

      setLessonPlan(governedPlan);

      const objectiveId =
        governedPlan.objectives[0]?.objectiveId ??
        bespokeLesson?.retrieval.objectives[0]?.id ??
        selectedObjectiveId;

      if (!objectiveId) {
        throw new Error("MyLisa could not find an Oak objective for this lesson yet.");
      }

      const lesson = await createLiveLesson({
        objectiveId,
        studentIds: launchStudentIds,
        assessmentSessionId,
        ndscreenSessionId,
        lessonPlanId: governedPlan.id,
        title: governedPlan.title,
      });
      navigate(`/tutor/live-lessons/${lesson.id}`);
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        const returnTo = `${window.location.pathname}${window.location.search}`;
        navigate(`/login?redirect=${encodeURIComponent(returnTo)}`);
        return;
      }
      setError(err instanceof Error ? err.message : "Failed to launch lesson");
    } finally {
      setLaunchingLiveLesson(false);
    }
  }

  void objectivesLoading;
  void profileLoading;
  void runtimeLoading;
  void bespokeLoading;
  void sectionContentLoadingKey;
  void sectionContent;
  void objectives;
  void activeChunkIds;
  void hasUnmappedGroupStudents;
  void recommendedObjectives;
  void setObjectiveSearchValue;
  void findMatchingObjectives;
  void generateBespokeTopicLesson;
  void saveGovernedLessonPlan;
  void generateSectionContent;
  void selectObjectiveDomain;
  void selectSubject;
  void selectObjective;
  void selectGroup;
  void chooseSearchStrand;
  void toggleChunk;
  void resetAutoSelection;
  void assignLearner;
  void launchLiveLesson;
  void openLessonPreview;

  const hasTopic = Boolean(topicInput.trim());
  const relatedStrands = strandResults?.items ?? [];
  const levelLabel =
    selectedTeachingKeyStage || selectedTeachingYear
      ? `${selectedTeachingKeyStage ?? "Any key stage"}${selectedTeachingYear ? ` · Year ${selectedTeachingYear}` : ""}`
      : "Any curriculum level";

  return (
    <Layout
      title="Lesson builder"
      subtitle="Tell MyLisa what you want to teach. It will guide the choices, align the lesson to Oak, and launch it for the student."
      kicker="MyLisa Lesson Builder"
    >
      {error ? (
        <>
          <div className="error-box">{error}</div>
          <div style={{ height: 20 }} />
        </>
      ) : null}

      <div className="card lesson-guide-card">
        <div className="profile-item-head">
          <div>
            <h2>Plan a lesson</h2>
            <p className="meta">
              MyLisa asks for one thing at a time, then prepares the Oak-aligned lesson in the background.
            </p>
          </div>
          <span className="pill">
            {launchStudentIds.length
              ? `${launchStudentIds.length} student${launchStudentIds.length === 1 ? "" : "s"} selected`
              : "Guided setup"}
          </span>
        </div>

        <div className="guided-flow">
          <section className="guided-step">
            <span className="guided-step-number">1</span>
            <label className="label">What would you like to teach?</label>
            <input
              className="input"
              value={topicInput}
              onChange={(event) => {
                setTopicInput(event.target.value);
                setBespokeLesson(null);
                setLessonPlan(null);
              }}
              placeholder="e.g. Algebra, Pythagoras, times tables"
            />
            {hasTopic ? (
              <p className="meta">MyLisa will find the closest Oak objectives and keep assessments Oak-governed.</p>
            ) : null}
            {hasTopic && relatedStrands.length > 0 ? (
              <div className="strand-picker">
                <div className="strand-picker-head">
                  <strong>Related Oak strands</strong>
                  <span className="meta">Across all year groups</span>
                </div>
                <div className="strand-choice-grid">
                  {relatedStrands.slice(0, 8).map((strand) => (
                    <button
                      key={`${strand.subject}-${strand.keyStage}-${strand.yearGroup ?? "na"}-${strand.strand}`}
                      className="strand-choice"
                      onClick={() =>
                        chooseSearchStrand({
                          strand: strand.strand,
                          keyStage: strand.keyStage,
                          yearGroup: strand.yearGroup,
                        })
                      }
                    >
                      <span>
                        <strong>{strand.strand}</strong>
                        <small>
                          {strand.keyStage}
                          {strand.yearGroup ? ` · Year ${strand.yearGroup}` : ""}
                          {` · ${strand.objectiveCount} objective${strand.objectiveCount === 1 ? "" : "s"}`}
                        </small>
                      </span>
                      <span className="pill">{strand.canonicalQuestionCount} Oak Qs</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
            {assessmentStrands.length > 0 ? (
              <div className="strand-picker">
                <div className="strand-picker-head">
                  <strong>Assessment strands</strong>
                  <span className="meta">{assignedLearnerLabel || "Selected learner"}</span>
                </div>
                <div className="strand-chip-row">
                  {assessmentStrands.map((strand) => (
                    <button
                      key={strand.strand}
                      className="strand-chip"
                      onClick={() => chooseSearchStrand({ strand: strand.strand })}
                    >
                      <strong>{strand.strand}</strong>
                      <span>{Math.round(strand.accuracy * 100)}%</span>
                    </button>
                  ))}
                </div>
              </div>
            ) : null}
          </section>

          {hasTopic ? (
            <section className="guided-step">
              <span className="guided-step-number">2</span>
              <label className="label">Which subject is this?</label>
              <div className="report-subject-switcher" aria-label="Choose lesson subject">
                {(["MATHS", "SCIENCE"] as LessonSubject[]).map((subject) => (
                  <button
                    key={subject}
                    className={`subject-tab ${selectedSubject === subject ? "subject-tab-active" : ""}`.trim()}
                    onClick={() => selectSubject(subject)}
                  >
                    {subject === "MATHS" ? "Maths" : "Science"}
                  </button>
                ))}
              </div>
              <p className="meta">
                MyLisa will only search Oak objectives inside the selected subject.
              </p>
            </section>
          ) : null}

          {hasTopic ? (
            <section className="guided-step">
              <span className="guided-step-number">3</span>
              <label className="label">What level should this lesson teach at?</label>
              <div className="grid grid-2">
                <select
                  className="input"
                  value={selectedTeachingKeyStage ?? ""}
                  onChange={(event) => setTeachingKeyStage(event.target.value)}
                >
                  <option value="">Any key stage</option>
                  {keyStageOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
                <select
                  className="input"
                  value={selectedTeachingYear ?? ""}
                  onChange={(event) => setTeachingYear(event.target.value)}
                >
                  <option value="">Any year</option>
                  {yearGroupOptions.map((year) => (
                    <option key={year} value={year}>
                      Year {year}
                    </option>
                  ))}
                </select>
              </div>
              <p className="meta">This can be lower or higher than the student's age.</p>
            </section>
          ) : null}

          {hasTopic ? (
            <section className="guided-step">
              <span className="guided-step-number">4</span>
              <label className="label">Assign students</label>
              <input
                className="input"
                value={learnerSearch}
                onChange={(event) => setLearnerSearch(event.target.value)}
                placeholder="Search student name"
              />
              <div className="student-choice-list">
                {groupsLoading ? <p className="meta">Loading students...</p> : null}
                {visibleSubscribedStudents.slice(0, 8).map((student) => {
                  const isAssigned = Boolean(
                    student.mylisaStudentId && selectedLearnerIds.includes(student.mylisaStudentId)
                  );
                  return (
                    <button
                      key={student.mylisaStudentId}
                      className={`student-choice ${isAssigned ? "student-choice-selected" : ""}`.trim()}
                      onClick={() => student.mylisaStudentId && toggleLearner(student.mylisaStudentId)}
                    >
                      <span>
                        <strong>{student.displayName}</strong>
                        <small>
                          {student.subject}
                          {student.keyStage ? ` · ${student.keyStage}` : ""}
                        </small>
                      </span>
                      <span className="pill">{isAssigned ? "Selected" : "Add"}</span>
                    </button>
                  );
                })}
                {!groupsLoading && !visibleSubscribedStudents.length ? (
                  <p className="meta">No students matched that search.</p>
                ) : null}
              </div>
            </section>
          ) : null}
        </div>
      </div>

      {hasTopic && studentId ? (
        <>
          <div style={{ height: 20 }} />
          <div className="card launch-card">
            <div className="profile-item-head">
              <div>
                <h2>Ready to launch</h2>
                <p className="meta">
                  MyLisa will build the guide, save the governed plan, align the assessment layer to Oak, and open the live lesson.
                </p>
              </div>
              <button
                className="btn btn-primary btn-large"
                disabled={launchingLiveLesson}
                onClick={() => void launchGuidedLesson()}
              >
                {launchingLiveLesson ? "Launching..." : "Launch lesson"}
              </button>
            </div>
            <div className="launch-summary">
              <div>
                <span className="meta">Teach</span>
                <strong>{topicInput.trim()}</strong>
              </div>
              <div>
                <span className="meta">Subject</span>
                <strong>{selectedSubject === "MATHS" ? "Maths" : "Science"}</strong>
              </div>
              <div>
                <span className="meta">Level</span>
                <strong>{levelLabel}</strong>
              </div>
              <div>
                <span className="meta">Students</span>
                <strong>
                  {launchStudentIds.length === 1
                    ? assignedLearnerLabel
                    : `${launchStudentIds.length} selected`}
                </strong>
              </div>
            </div>
          </div>
        </>
      ) : null}
    </Layout>
  );

}
