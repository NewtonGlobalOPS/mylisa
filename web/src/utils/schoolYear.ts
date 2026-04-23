export function defaultStartingYearFromSchoolYear(schoolYear: number): number {
  return Math.max(1, schoolYear - 1);
}