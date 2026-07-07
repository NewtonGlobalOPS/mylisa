export function defaultStartingYearFromSchoolYear(schoolYear: number): number {
  return Math.max(1, schoolYear - 1);
}

export function normaliseAssessmentYear(
  schoolYear: number | null | undefined,
  age?: number | null
): number {
  const inferredYear =
    typeof schoolYear === "number" && Number.isFinite(schoolYear)
      ? schoolYear
      : typeof age === "number" && Number.isFinite(age)
      ? age - 4
      : 1;

  return Math.max(1, Math.min(13, inferredYear));
}
