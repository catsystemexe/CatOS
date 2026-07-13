import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { reviewReportSchema } from "../schemas/reviewReport.js";
import { taskBriefSchema } from "../schemas/taskBrief.js";
import { FileHumanGate, formatZodError, loadFinalResult, resolveRunArtifact, type HumanDecisionInput } from "../humanGate.js";

type DecideCliOptions = { cwd?: string; runsDir?: string };

function collectOption(args: string[], name: string): string[] {
  const values: string[] = [];
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name) {
      const value = args[i + 1];
      if (!value) throw new Error(`Chybí hodnota pro ${name}.`);
      values.push(value);
      i += 1;
    }
  }
  return values;
}

function readOption(args: string[], name: string): string | undefined {
  return collectOption(args, name)[0];
}

function parseDecision(value: string | undefined): HumanDecisionInput["decision"] {
  if (value === "approve") return "APPROVE";
  if (value === "reject") return "REJECT";
  if (value === "request-changes") return "REQUEST_CHANGES";
  throw new Error("Neplatné nebo chybějící --decision. Povolené hodnoty: approve, reject, request-changes.");
}

function evidenceFromReviewed(values: string[]): HumanDecisionInput["evidenceReviewed"] {
  const reviewed = new Set(values);
  const allowed = new Set(["task-brief", "diff", "validation", "review"]);
  for (const value of reviewed) {
    if (!allowed.has(value)) throw new Error(`Neplatná hodnota --reviewed: ${value}.`);
  }
  return {
    taskBrief: reviewed.has("task-brief"),
    finalDiff: reviewed.has("diff"),
    validationReport: reviewed.has("validation"),
    reviewReport: reviewed.has("review"),
  };
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function ensureRunDir(runDir: string): Promise<void> {
  try {
    const dir = await stat(runDir);
    if (!dir.isDirectory()) throw new Error(`Run path is not a directory: ${runDir}`);
  } catch {
    throw new Error(`Run not found: ${runDir}`);
  }
}

export async function decideCommand(args: string[], options: DecideCliOptions = {}): Promise<void> {
  const runId = readOption(args, "--run");
  if (!runId) throw new Error("Chybí povinný parametr --run.");
  const runsDir = options.runsDir ?? path.join(options.cwd ?? process.cwd(), "runs");
  const runDir = path.join(runsDir, runId);
  await ensureRunDir(runDir);

  let finalResult;
  try {
    finalResult = await loadFinalResult(runDir);
  } catch (error) {
    throw new Error(`Invalid or missing final-result.json: ${formatZodError(error)}`);
  }

  const taskBrief = taskBriefSchema.parse(await readJson(path.join(runDir, "task-brief.json")));
  const reviewReportPath = resolveRunArtifact(runDir, finalResult.finalReviewReportPath, "review-report.json");
  const reviewReport = reviewReportSchema.parse(await readJson(reviewReportPath));
  const diffPath = resolveRunArtifact(runDir, finalResult.finalDiffPath, "workspace.diff");
  const validationPath = resolveRunArtifact(runDir, finalResult.finalValidationReportPath, "validation-report.json");

  console.log(`Objective: ${taskBrief.objective}`);
  console.log(`Final status: ${finalResult.status}`);
  console.log(`Validation status: ${finalResult.finalValidationStatus}`);
  console.log(`Review verdict: ${reviewReport.verdict}`);
  console.log(`Changed files: ${finalResult.finalChangedFiles.length === 0 ? "none" : finalResult.finalChangedFiles.join(", ")}`);
  console.log("Sandbox isolation: see coding-result.json");
  console.log(`Total coding attempts: ${finalResult.totalCodingAttempts}`);
  console.log(`Diff: ${diffPath}`);
  console.log(`Validation report: ${validationPath}`);
  console.log(`Review report: ${reviewReportPath}`);

  const gate = new FileHumanGate();
  let decision;
  try {
    decision = await gate.recordDecision({ runId, runDir, finalResult }, {
      decision: parseDecision(readOption(args, "--decision")),
      comment: readOption(args, "--comment"),
      requestedChanges: collectOption(args, "--change"),
      evidenceReviewed: evidenceFromReviewed(collectOption(args, "--reviewed")),
    });
  } catch (error) {
    throw new Error(formatZodError(error));
  }

  console.log(`Human decision: ${decision.decision}`);
  console.log(`Run: ${runId}`);
  console.log(`Decision: ${path.join(runDir, "human-decision.json")}`);
  if (decision.decision === "REQUEST_CHANGES") {
    console.log(`Requested changes: ${decision.requestedChanges.length}`);
    console.log("Automatic rework was not started");
  }
  console.log("Next step: npm run catos -- commit --run <runId>");
}
