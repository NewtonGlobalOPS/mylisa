// src/scripts/oakSync.ts
import { syncOakCurriculum } from "../services/oakSync.service.js";

function readSubjectArgs(): string[] {
  const direct = process.argv
    .slice(2)
    .map((value) => value.trim())
    .filter(Boolean);

  if (!direct.length) {
    return [];
  }

  return direct.flatMap((value) =>
    value.startsWith("--subjects=")
      ? value
          .slice("--subjects=".length)
          .split(",")
          .map((item) => item.trim())
          .filter(Boolean)
      : value.split(",").map((item) => item.trim()).filter(Boolean),
  );
}

(async () => {
  const stats = await syncOakCurriculum({
    subjectSlugs: readSubjectArgs(),
  });
  console.log("Oak sync complete:", stats);
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
