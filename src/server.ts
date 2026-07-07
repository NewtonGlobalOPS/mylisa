import express from "express";
import cors from "cors";
import helmet from "helmet";

import { env } from "./lib/env.js";
import { errorMiddleware } from "./middleware/error.js";
import { requireApiKey } from "./middleware/apiKey.js";

import { healthRouter } from "./routes/health.routes.js";
import { authRouter } from "./routes/auth.routes.js";
import { profileRouter } from "./routes/profile.routes.js";
import { tutorRouter } from "./routes/tutor.routes.js";
import oakAdminRoutes from "./routes/oakAdmin.routes.js";
import { assessmentRouter } from "./routes/assessment.routes.js";
import { onboardingRouter } from "./routes/onboarding.routes.js";
import { newtonCentreRouter } from "./routes/newtoncentre.routes.js";
import { newtonCentreTimetableRouter } from "./routes/newtoncentreTimetable.routes.js";
import { curriculumRouter } from "./routes/curriculum.routes.js";
import { dashboardRouter } from "./routes/dashboard.routes.js";
import { liveLessonRouter } from "./routes/liveLesson.routes.js";
import { publicReportRouter, reportRouter } from "./routes/report.routes.js";



const app = express();

app.use(helmet());
app.use(cors({ origin: true, credentials: true }));
app.use(express.json({ limit: "2mb" }));

app.use("/api", healthRouter);
app.use(newtonCentreRouter);
app.use(publicReportRouter);
app.use("/api", requireApiKey);
app.use(assessmentRouter);
app.use(onboardingRouter);
app.use(curriculumRouter);
app.use(dashboardRouter);
app.use(reportRouter);
app.use(liveLessonRouter);
app.use(newtonCentreTimetableRouter);
app.use("/api/auth", authRouter);
app.use("/api/profile", profileRouter);
app.use("/api/tutor", tutorRouter);
app.use("/api/admin/oak", oakAdminRoutes);
app.use(errorMiddleware);

app.listen(env.PORT, () => {
  console.log(`myLisa API running on http://localhost:${env.PORT}`);
});
