import { analyzeTaskBrief, writeTaskBrief, type TaskAnalystProvider } from "../agents/taskAnalyst.js";
import { loadProjectConfig } from "../config/loadConfig.js";
import { createRun } from "../runs/createRun.js";
import { CodexSdkWorker, writeCodingArtifacts, type CodingWorker } from "../codingWorker.js";
import { ShellValidationRunner, buildValidationCommands, writeValidationReport, type ValidationRunner } from "../validationRunner.js";
import { reviewChange, writeReviewReport, type ReviewerProvider } from "../agents/reviewer.js";
import { resolveWorkspaceRoot } from "../workspaceRoot.js";
import { buildReworkPackage, hasRepeatedBlockingFinding, writeFinalResult, writeReworkPackage } from "../reworkLoop.js";
import type { FinalResult } from "../schemas/finalResult.js";
import path from "node:path";

type RunCliOptions = {
  cwd?: string;
  runsDir?: string;
  taskAnalystProvider?: TaskAnalystProvider;
  codingWorker?: CodingWorker;
  validationRunner?: ValidationRunner;
  reviewerProvider?: ReviewerProvider;
};

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

export async function runCommand(args: string[], options: RunCliOptions = {}): Promise<void> {
  const projectId = readOption(args, "--project");
  const goal = readOption(args, "--task");

  if (!projectId) {
    throw new Error("Chybí povinný parametr --project.");
  }

  if (!goal) {
    throw new Error("Chybí povinný parametr --task.");
  }

  const configPath = `projects/${projectId}.yaml`;
  const loaded = await loadProjectConfig(configPath, options.cwd);

  if (loaded.config.project.id !== projectId) {
    throw new Error(`ID projektu v konfiguraci (${loaded.config.project.id}) neodpovídá parametru --project (${projectId}).`);
  }

  const run = await createRun(projectId, goal, configPath, { runsDir: options.runsDir });
  const analysis = await analyzeTaskBrief(goal, projectId, { provider: options.taskAnalystProvider });
  const taskBriefPath = await writeTaskBrief(run.runDir, analysis.taskBrief);
  const workspaceRoot = resolveWorkspaceRoot(loaded.config.execution.workspaceRoot);
  const codingWorker = options.codingWorker ?? new CodexSdkWorker();
  const validationRunner = options.validationRunner ?? new ShellValidationRunner();
  const validationCommands = buildValidationCommands(loaded.config.commands, loaded.config.validation);
  const maxReworkAttempts = loaded.config.workflow.maxReworkAttempts;

  let codingResult = await codingWorker.executeTask({
    instruction: analysis.taskBrief.codexInstruction,
    repositoryPath: loaded.absoluteRepoPath,
    baseBranch: loaded.config.project.baseBranch,
    runId: run.runId,
    workspaceRoot,
    sandboxMode: loaded.config.codex.sandboxMode,
  });
  const codingArtifacts = await writeCodingArtifacts(run.runDir, analysis.taskBrief, codingResult);
  let validationReport = await validationRunner.run({ workspacePath: codingResult.workspacePath, commands: validationCommands });
  let validationReportPath = await writeValidationReport(run.runDir, validationReport);
  let reviewReport = await reviewChange({
    taskInput: run.input,
    taskBrief: analysis.taskBrief,
    codingResult: {
      threadId: codingResult.threadId,
      finalResponse: codingResult.finalResponse,
      workspacePath: codingResult.workspacePath,
      changedFiles: codingResult.changedFiles,
      sandboxMode: codingResult.sandboxMode,
      sandboxIsolation: codingResult.sandboxIsolation,
    },
    workspaceDiff: codingResult.diff,
    workspaceStatus: codingResult.status,
    validationReport,
    projectConstraints: {
      permissions: loaded.config.permissions,
      workflow: loaded.config.workflow,
      codex: loaded.config.codex,
    },
  }, { provider: options.reviewerProvider });
  let reviewReportPath = await writeReviewReport(run.runDir, reviewReport);

  const initialCodingResult = codingResult;
  const initialCodingArtifacts = codingArtifacts;
  const initialValidationReport = validationReport;
  const initialValidationReportPath = validationReportPath;
  const initialReviewReport = reviewReport;
  const initialReviewReportPath = reviewReportPath;
  console.log(`Review verdict: ${reviewReport.verdict}`);

  let previousReviewReport = reviewReport;
  let previousValidationStatus = validationReport.status;
  let reworkAttempts = 0;
  let forcedHumanRequired = false;

  while (reviewReport.verdict === "REWORK" && reworkAttempts < maxReworkAttempts && !forcedHumanRequired) {
    if (reviewReport.blockingFindings.length === 0) {
      forcedHumanRequired = true;
      break;
    }
    if (reworkAttempts > 0 && hasRepeatedBlockingFinding(previousReviewReport, reviewReport)) {
      forcedHumanRequired = true;
      break;
    }
    if (reworkAttempts > 0 && previousValidationStatus === "BLOCKED" && validationReport.status === "BLOCKED") {
      forcedHumanRequired = true;
      break;
    }

    const attempt = reworkAttempts + 1;
    console.log(`Starting rework attempt ${attempt}/${maxReworkAttempts}`);
    const attemptDir = path.join(run.runDir, "attempts", String(attempt).padStart(2, "0"));
    const reworkPackage = buildReworkPackage({
      attempt,
      taskBrief: analysis.taskBrief,
      reviewReport,
      codingResult,
      validationReport,
      workspaceDiff: codingResult.diff,
    });
    await writeReworkPackage(attemptDir, reworkPackage);
    const beforeReview = reviewReport;
    const beforeValidationStatus = validationReport.status;
    codingResult = await codingWorker.continueTask({
      threadId: codingResult.threadId,
      workspacePath: codingResult.workspacePath,
      reworkPackage,
      sandboxMode: loaded.config.codex.sandboxMode,
    });
    await writeCodingArtifacts(attemptDir, analysis.taskBrief, codingResult);
    validationReport = await validationRunner.run({ workspacePath: codingResult.workspacePath, commands: validationCommands });
    validationReportPath = await writeValidationReport(attemptDir, validationReport);
    reviewReport = await reviewChange({
      taskInput: run.input,
      taskBrief: analysis.taskBrief,
      codingResult: {
        threadId: codingResult.threadId,
        finalResponse: codingResult.finalResponse,
        workspacePath: codingResult.workspacePath,
        changedFiles: codingResult.changedFiles,
        sandboxMode: codingResult.sandboxMode,
        sandboxIsolation: codingResult.sandboxIsolation,
      },
      workspaceDiff: codingResult.diff,
      workspaceStatus: codingResult.status,
      validationReport,
      projectConstraints: {
        permissions: loaded.config.permissions,
        workflow: loaded.config.workflow,
        codex: loaded.config.codex,
      },
      reworkContext: {
        reworkPackage,
        previousBlockingFindings: reworkPackage.blockingFindings,
        requiredChanges: reworkPackage.mustChange,
        reworkReason: reworkPackage.previousAttemptSummary,
      },
    }, { provider: options.reviewerProvider });
    reviewReportPath = await writeReviewReport(attemptDir, reviewReport);
    console.log(`Rework validation: ${validationReport.status}`);
    console.log(`Rework review verdict: ${reviewReport.verdict}`);
    reworkAttempts = attempt;
    previousReviewReport = beforeReview;
    previousValidationStatus = beforeValidationStatus;
  }

  let finalStatus: FinalResult["status"];
  if (forcedHumanRequired || reviewReport.verdict === "HUMAN_REQUIRED") {
    finalStatus = "HUMAN_REQUIRED";
  } else if (reviewReport.verdict === "ACCEPT") {
    finalStatus = "ACCEPTED";
  } else {
    finalStatus = "REWORK_LIMIT_REACHED";
  }
  const finalResult: FinalResult = {
    schemaVersion: 1,
    runId: run.runId,
    status: finalStatus,
    finalReviewVerdict: reviewReport.verdict,
    totalCodingAttempts: 1 + reworkAttempts,
    reworkAttempts,
    finalWorkspacePath: codingResult.workspacePath,
    finalChangedFiles: codingResult.changedFiles,
    finalValidationStatus: validationReport.status,
    finalReviewReportPath: reviewReportPath,
    finalDiffPath: path.join(reworkAttempts === 0 ? run.runDir : path.join(run.runDir, "attempts", String(reworkAttempts).padStart(2, "0")), "workspace.diff"),
    finalValidationReportPath: validationReportPath,
  };
  const finalResultPath = await writeFinalResult(run.runDir, finalResult);


  console.log("CatOS run created");
  console.log(`Run ID: ${run.runId}`);
  console.log(`Project: ${loaded.config.project.id} (${loaded.config.project.name})`);
  console.log(`Repository: ${loaded.absoluteRepoPath}`);
  console.log(`Input: ${run.inputPath}`);
  console.log(`Task brief: ${taskBriefPath}`);
  console.log(`Workspace: ${initialCodingResult.workspacePath}`);
  console.log(`Codex sandbox mode: ${initialCodingResult.sandboxMode} (isolation: ${initialCodingResult.sandboxIsolation})`);
  console.log(`Changed files: ${initialCodingResult.changedFiles.length}`);
  if (initialCodingResult.changedFiles.length === 0) {
    console.log("Codex Worker completed without file changes.");
  }
  console.log(`Diff: ${initialCodingArtifacts.diffPath}`);
  console.log(`Codex thread ID: ${initialCodingResult.threadId}`);
  console.log(`Task Analyst attempts: ${analysis.attempts}`);
  console.log(`Validation: ${initialValidationReport.status}`);
  for (const result of initialValidationReport.results) {
    const exit = result.exitCode === null ? "null" : String(result.exitCode);
    console.log(`- ${result.name}: ${result.status} (exit ${exit}, ${(result.durationMs / 1000).toFixed(1)}s)`);
  }
  console.log(`Validation report: ${initialValidationReportPath}`);
  console.log(`Review verdict: ${initialReviewReport.verdict}`);
  console.log(`Review blocking findings: ${initialReviewReport.blockingFindings.length}`);
  console.log(`Review warnings: ${initialReviewReport.warnings.length}`);
  console.log(`Review report: ${initialReviewReportPath}`);
  console.log(`Final status: ${finalResult.status}`);
  console.log(`Total coding attempts: ${finalResult.totalCodingAttempts}`);
  console.log(`Final result: ${finalResultPath}`);
}
