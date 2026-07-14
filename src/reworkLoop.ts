import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { reworkPackageSchema, type ReworkPackage } from "./schemas/reworkPackage.js";
import { finalResultSchema, type FinalResult } from "./schemas/finalResult.js";
import type { TaskBrief } from "./schemas/taskBrief.js";
import type { CodingResult } from "./codingWorker.js";
import type { ReviewReport } from "./schemas/reviewReport.js";
import type { ValidationReport } from "./validationRunner.js";
import { ensureStepResultArtifacts, writeSessionReport } from "./finalExport.js";

export function buildReworkPackage(input: {
  attempt: number;
  taskBrief: TaskBrief;
  reviewReport: ReviewReport;
  codingResult: CodingResult;
  validationReport: ValidationReport;
  workspaceDiff: string;
}): ReworkPackage {
  if (input.reviewReport.verdict !== "REWORK") throw new Error("ReworkPackage can only be built for REWORK verdicts.");
  if (input.reviewReport.blockingFindings.length === 0) throw new Error("Reviewer returned REWORK without blocking findings.");
  const satisfied = input.reviewReport.reviewedAcceptanceCriteria
    .filter((item) => item.status === "SATISFIED")
    .map((item) => item.criterion);
  const preserve = Array.from(new Set([...satisfied, "Preserve existing changes unrelated to blocking findings."]));
  return reworkPackageSchema.parse({
    schemaVersion: 1,
    attempt: input.attempt,
    originalObjective: input.taskBrief.objective,
    acceptanceCriteria: input.taskBrief.acceptanceCriteria,
    blockingFindings: input.reviewReport.blockingFindings,
    preserve,
    mustChange: input.reviewReport.blockingFindings.map((finding) => finding.requiredChange),
    mustNotChange: input.taskBrief.nonGoals,
    previousAttemptSummary: [
      input.reviewReport.summary,
      `Validation status: ${input.validationReport.status}.`,
      `Changed files: ${input.codingResult.changedFiles.join(", ") || "none"}.`,
      `Current diff bytes: ${Buffer.byteLength(input.workspaceDiff, "utf8")}.`,
    ].join(" "),
  });
}

function normalizeFingerprintPart(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ");
}

export function blockingFindingFingerprint(finding: ReviewReport["blockingFindings"][number]): string {
  return [finding.title, finding.evidence, finding.requiredChange].map(normalizeFingerprintPart).join("\u241f");
}

export function hasRepeatedBlockingFinding(previous: ReviewReport, current: ReviewReport): boolean {
  const previousFingerprints = new Set(previous.blockingFindings.map(blockingFindingFingerprint));
  return current.blockingFindings.some((finding) => previousFingerprints.has(blockingFindingFingerprint(finding)));
}

export async function writeReworkPackage(attemptDir: string, reworkPackage: ReworkPackage): Promise<string> {
  const parsed = reworkPackageSchema.parse(reworkPackage);
  await mkdir(attemptDir, { recursive: true });
  const filePath = path.join(attemptDir, "rework-package.json");
  await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return filePath;
}

export async function writeFinalResult(runDir: string, finalResult: FinalResult): Promise<string> {
  const filePath = path.join(runDir, "final-result.json");
  const stepArtifacts = await ensureStepResultArtifacts(runDir);
  const draft = finalResultSchema.parse({ ...finalResult, runArtifacts: [...(finalResult.runArtifacts ?? []), ...stepArtifacts] });
  await writeFile(filePath, `${JSON.stringify(draft, null, 2)}\n`, "utf8");
  await writeSessionReport(runDir);
  const parsed = finalResultSchema.parse({
    ...draft,
    runArtifacts: [
      ...(draft.runArtifacts ?? stepArtifacts),
      { label: "FINAL_REPORT.md", path: "FINAL_REPORT.md", kind: "final-report", readable: true },
    ],
  });
  await writeFile(filePath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return filePath;
}
