import "dotenv/config";
import { rebuildOakCanonicals } from "../services/oakCanonicalRebuild.service.js";

function readListArg(name: string): string[] | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  if (!arg) return undefined;
  return arg
    .slice(prefix.length)
    .split(",")
    .map((value) => value.trim())
    .filter(Boolean);
}

function readNumberArg(name: string): number | undefined {
  const prefix = `--${name}=`;
  const arg = process.argv.find((value) => value.startsWith(prefix));
  if (!arg) return undefined;
  const value = Number(arg.slice(prefix.length));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

const apply = process.argv.includes("--apply");
const replaceExisting = process.argv.includes("--replace");

(async () => {
  const stats = await rebuildOakCanonicals({
    subjectSlugs: readListArg("subjects"),
    apply,
    replaceExisting,
    maxUnits: readNumberArg("max-units"),
    maxLessons: readNumberArg("max-lessons"),
  });
  console.log("Oak canonical rebuild complete:", JSON.stringify(stats, null, 2));
  if (!apply) {
    console.log(
      "Dry run only. Re-run with --apply to write rows, and --replace to clear existing Oak canonicals for the selected subjects first.",
    );
  }
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
