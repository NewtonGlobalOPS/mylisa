import { Navigate, Route, Routes } from "react-router-dom";
import OnboardingPage from "./pages/OnboardingPage";
import ReadyPage from "./pages/ReadyPage";
import AssessmentPage from "./pages/AssessmentPage";
import ReportPage from "./pages/ReportPage";
import LessonPage from "./pages/LessonPage";
import DashboardPage from "./pages/DashboardPage";
import AssessmentLookupPage from "./pages/AssessmentLookupPage";

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/dashboard" element={<DashboardPage />} />
      <Route path="/onboarding" element={<OnboardingPage />} />
      <Route path="/ready" element={<ReadyPage />} />
      <Route path="/assessment" element={<AssessmentPage />} />
      <Route path="/report" element={<ReportPage />} />
      <Route path="/assessments" element={<AssessmentLookupPage />} />
      <Route path="/lesson/:objectiveId" element={<LessonPage />} />
    </Routes>
  );
}
