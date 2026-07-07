import type { ReactElement } from "react";
import { Navigate, Route, Routes, useLocation } from "react-router-dom";
import OnboardingPage from "./pages/OnboardingPage";
import ReadyPage from "./pages/ReadyPage";
import AssessmentPage from "./pages/AssessmentPage";
import ReportPage from "./pages/ReportPage";
import LessonPage from "./pages/LessonPage";
import LessonBuilderPage from "./pages/LessonBuilderPage";
import DashboardPage from "./pages/DashboardPage";
import AssessmentLookupPage from "./pages/AssessmentLookupPage";
import LoginPage from "./pages/LoginPage";
import TutorLiveLessonPage from "./pages/TutorLiveLessonPage";
import StudentLiveLessonPage from "./pages/StudentLiveLessonPage";
import TimetablePage from "./pages/TimetablePage";
import StudentsPage from "./pages/StudentsPage";
import ScreeningsPage from "./pages/ScreeningsPage";
import { getAuthToken } from "./utils/storage";

function RequireLogin({ children }: { children: ReactElement }) {
  const location = useLocation();
  const token = getAuthToken();

  if (!token) {
    const redirect = `${location.pathname}${location.search}`;
    return <Navigate to={`/login?redirect=${encodeURIComponent(redirect)}`} replace />;
  }

  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/" element={<Navigate to="/dashboard" replace />} />
      <Route path="/login" element={<LoginPage />} />
      <Route path="/dashboard" element={<RequireLogin><DashboardPage /></RequireLogin>} />
      <Route path="/timetable" element={<RequireLogin><TimetablePage /></RequireLogin>} />
      <Route path="/students" element={<RequireLogin><StudentsPage /></RequireLogin>} />
      <Route path="/screenings" element={<RequireLogin><ScreeningsPage /></RequireLogin>} />
      <Route path="/onboarding" element={<RequireLogin><OnboardingPage /></RequireLogin>} />
      <Route path="/ready" element={<RequireLogin><ReadyPage /></RequireLogin>} />
      <Route path="/assessment" element={<RequireLogin><AssessmentPage /></RequireLogin>} />
      <Route path="/report" element={<RequireLogin><ReportPage /></RequireLogin>} />
      <Route path="/assessments" element={<RequireLogin><AssessmentLookupPage /></RequireLogin>} />
      <Route path="/lesson-builder" element={<RequireLogin><LessonBuilderPage /></RequireLogin>} />
      <Route path="/lesson/:objectiveId" element={<RequireLogin><LessonPage /></RequireLogin>} />
      <Route path="/tutor/live-lessons/:lessonSessionId" element={<RequireLogin><TutorLiveLessonPage /></RequireLogin>} />
      <Route path="/student/live-lessons/:lessonSessionId" element={<RequireLogin><StudentLiveLessonPage /></RequireLogin>} />
    </Routes>
  );
}
