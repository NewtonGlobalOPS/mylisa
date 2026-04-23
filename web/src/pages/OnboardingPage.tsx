import { useState } from "react";
import { useNavigate } from "react-router-dom";
import Layout from "../components/Layout";
import { createStudent } from "../api/assessmentApi";
import { saveNdscreenSessionId, saveStudent } from "../utils/storage";
import { getAgePresentation } from "../utils/agePresentation";

const SUBJECT_OPTIONS = [
  { value: "MATHS", label: "Maths" },
  { value: "ENGLISH", label: "English" },
  { value: "SCIENCE", label: "Science" },
  { value: "COMPUTING", label: "Computing" },
] as const;

type SubjectOption = (typeof SUBJECT_OPTIONS)[number]["value"];

export default function OnboardingPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [email, setEmail] = useState("student1@example.com");
  const [firstName, setFirstName] = useState("Leif");
  const [lastName, setLastName] = useState("Osten");
  const [age, setAge] = useState(13);
  const [schoolYear, setSchoolYear] = useState(8);
  const [guardianEmail, setGuardianEmail] = useState("parent@example.com");
  const [ndscreenSessionId, setNdscreenSessionId] = useState("");
  const [subjects, setSubjects] = useState<SubjectOption[]>([
    "MATHS",
    "ENGLISH",
  ]);
  const presentation = getAgePresentation(schoolYear);

  function toggleSubject(subject: SubjectOption) {
    setSubjects((current) => {
      if (current.includes(subject)) {
        return current.length > 1
          ? current.filter((value) => value !== subject)
          : current;
      }

      return [...current, subject];
    });
  }

  async function handleCreate() {
    setLoading(true);
    setError("");

    try {
      const created = await createStudent({
        email,
        firstName,
        lastName,
        age,
        schoolYear,
        subjects,
        guardianEmail,
      });

      saveStudent(created);
      saveNdscreenSessionId(ndscreenSessionId.trim());
      navigate("/ready");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to create student");
    } finally {
      setLoading(false);
    }
  }

  return (
    <Layout
      title="Create learner profile"
      subtitle={
        presentation.band === "junior"
          ? "Set up a younger learner and we will keep the learning journey calm and encouraging."
          : presentation.band === "middle"
          ? "Set up the learner and we will tailor the assessment tone to their stage."
          : ""
      }
      kicker={presentation.kicker}
      themeClass={presentation.themeClass}
    >
      <div className="card">
        <h2>Learner details</h2>

        <div className="row">
          <div>
            <label className="label">First name</label>
            <input
              className="input"
              value={firstName}
              onChange={(e) => setFirstName(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Last name</label>
            <input
              className="input"
              value={lastName}
              onChange={(e) => setLastName(e.target.value)}
            />
          </div>
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <div>
            <label className="label">Student email</label>
            <input
              className="input"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
            />
          </div>
          <div>
            <label className="label">Guardian email</label>
            <input
              className="input"
              value={guardianEmail}
              onChange={(e) => setGuardianEmail(e.target.value)}
            />
          </div>
        </div>

        <div className="row" style={{ marginTop: 14 }}>
          <div>
            <label className="label">Age</label>
            <input
              className="input"
              type="number"
              value={age}
              onChange={(e) => setAge(Number(e.target.value))}
            />
          </div>
          <div>
            <label className="label">School year</label>
            <select
              className="select"
              value={schoolYear}
              onChange={(e) => setSchoolYear(Number(e.target.value))}
            >
              {Array.from({ length: 13 }).map((_, i) => {
                const year = i + 1;
                return (
                  <option key={year} value={year}>
                    Year {year}
                  </option>
                );
              })}
            </select>
          </div>
        </div>

        <div style={{ marginTop: 14 }}>
          <label className="label">ndscreen session ID (optional)</label>
          <input
            className="input"
            value={ndscreenSessionId}
            onChange={(e) => setNdscreenSessionId(e.target.value)}
            placeholder="Paste the linked ndscreen session ID if you have one"
          />
        </div>

        <div style={{ marginTop: 14 }}>
          <label className="label">Subjects</label>
          <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
            {SUBJECT_OPTIONS.map((subject) => (
              <label
                key={subject.value}
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                }}
              >
                <input
                  type="checkbox"
                  checked={subjects.includes(subject.value)}
                  onChange={() => toggleSubject(subject.value)}
                />
                <span>{subject.label}</span>
              </label>
            ))}
          </div>
        </div>

        {error ? <div className="error-box">{error}</div> : null}

        <div style={{ marginTop: 20 }}>
          <button
            className="btn btn-primary"
            disabled={loading}
            onClick={handleCreate}
          >
            {loading ? "Creating..." : "Continue"}
          </button>
        </div>
      </div>
    </Layout>
  );
}
