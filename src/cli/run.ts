import { analyzeTaskBrief, writeTaskBrief, type TaskAnalystProvider } from "../agents/taskAnalyst.js";
import { loadProjectConfig } from "../config/loadConfig.js";
import { resolveRepositoryRunConfig } from "../repositoryRunConfig.js";
import { validateManualRepository } from "../repositoryDiscovery.js";
import { stat, writeFile } from "node:fs/promises";
import { createRun } from "../runs/createRun.js";
import { CodexSdkWorker, writeCodingArtifacts, type CodingWorker, normalizeWorkBranchName, buildIsolatedWorkspacePath } from "../codingWorker.js";
import { ShellValidationRunner, buildValidationCommands, writeValidationReport, type ValidationRunner } from "../validationRunner.js";
import { reviewChange, writeReviewReport, type ReviewerProvider } from "../agents/reviewer.js";
import { resolveWorkspaceRoot } from "../workspaceRoot.js";
import { buildReworkPackage, hasRepeatedBlockingFinding, writeFinalResult, writeReworkPackage } from "../reworkLoop.js";
import type { FinalResult } from "../schemas/finalResult.js";
import path from "node:path";
import { artifactRefs, completeAttempt, createSession, startAttempt, appendTimelineEvent } from "../runs/sessionModel.js";
import { assertWorkspaceBranch, resolveGitContext } from "../gitSession.js";

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

async function isTracked(workspacePath: string, file: string): Promise<boolean> {
  const { execFile } = await import("node:child_process");
  const { promisify } = await import("node:util");
  const execFileAsync = promisify(execFile);
  try { await execFileAsync("git", ["-C", workspacePath, "ls-files", "--error-unmatch", "--", file]); return true; } catch { return false; }
}

export async function runCommand(args: string[], options: RunCliOptions = {}): Promise<void> {
  let projectId = readOption(args, "--project");
  const repositoryPath = readOption(args, "--repo") ?? readOption(args, "--repository");
  const goal = readOption(args, "--task");

  if (!projectId && !repositoryPath) {
    throw new Error("Chybí povinný parametr --project nebo --repo.");
  }

  if (!goal) {
    throw new Error("Chybí povinný parametr --task.");
  }

  let loaded: Awaited<ReturnType<typeof loadProjectConfig>>;
  let configSource: string = "project-config";
  let configPath: string;
  if (repositoryPath) {
    const repo = (await validateManualRepository(repositoryPath)).path;
    const resolved = await resolveRepositoryRunConfig(repo, options.cwd);
    loaded = { config: resolved.config, configPath: resolved.configPath, absoluteConfigPath: resolved.configPath, absoluteRepoPath: repo };
    configSource = resolved.configSource;
    projectId = projectId ?? loaded.config.project.id;
    configPath = resolved.configPath;
  } else {
    configPath = `projects/${projectId}.yaml`;
    loaded = await loadProjectConfig(configPath, options.cwd);
    if (loaded.config.project.id !== projectId) {
      throw new Error(`ID projektu v konfiguraci (${loaded.config.project.id}) neodpovídá parametru --project (${projectId}).`);
    }
  }

  const baseBranch = readOption(args, "--base-branch") ?? loaded.config.project.baseBranch;
  if (!baseBranch) throw new Error("Missing base branch: pass --base-branch or set project.baseBranch in config.");
  const prTargetBranch = readOption(args, "--pr-target") ?? loaded.config.git.prTargetBranch ?? baseBranch;
  const workspaceRoot = resolveWorkspaceRoot(loaded.config.execution.workspaceRoot);
  const run = await createRun(projectId!, goal, configPath, { runsDir: options.runsDir });
  await writeFile(run.inputPath, `${JSON.stringify({ ...run.input, repositoryPath: loaded.absoluteRepoPath, baseBranch, prTargetBranch, configSource }, null, 2)}\n`, "utf8");
  (run.input as any).repositoryPath = loaded.absoluteRepoPath;
  const runBranch = normalizeWorkBranchName(run.runId);
  const workspacePath = await buildIsolatedWorkspacePath({ workspaceRoot, runId: run.runId, repositoryPath: loaded.absoluteRepoPath });
  const git = await resolveGitContext({ projectId: projectId!, repositoryPath: loaded.absoluteRepoPath, baseBranch, prTargetBranch, runBranch, workspacePath, remoteName: loaded.config.git.remoteName });
  const sessionState = await createSession({ runDir: run.runDir, runId: run.runId, goal, branch: runBranch, workspacePath, git, requestTitle: "Initial run", request: goal });
  await appendTimelineEvent(run.runDir, { type: "git.base_resolved", sessionId: run.runId, metadata: { baseBranch, baseCommit: git.baseCommit, runBranch, prTargetBranch } });
  const analysis = await analyzeTaskBrief(goal, projectId!, { provider: options.taskAnalystProvider });
  const taskBriefPath = await writeTaskBrief(run.runDir, analysis.taskBrief);
  const codingWorker = options.codingWorker ?? new CodexSdkWorker();
  const validationRunner = options.validationRunner ?? new ShellValidationRunner();
  const validationCommands = buildValidationCommands(loaded.config.commands, loaded.config.validation);
  const maxReworkAttempts = loaded.config.workflow.maxReworkAttempts;

  let currentStep = sessionState.step;
  let currentAttempt = await startAttempt({ runDir: run.runDir, step: currentStep, prompt: analysis.taskBrief.codexInstruction, runtimeMode: loaded.config.codex.sandboxMode });

  let codingResult = await codingWorker.executeTask({
    instruction: analysis.taskBrief.codexInstruction,
    repositoryPath: loaded.absoluteRepoPath,
    baseBranch,
    baseCommit: git.baseCommit,
    runBranch,
    workspacePath,
    runId: run.runId,
    workspaceRoot,
    sandboxMode: loaded.config.codex.sandboxMode,
  });
  await appendTimelineEvent(run.runDir, { type: "git.run_branch_created", sessionId: run.runId, metadata: { baseBranch, baseCommit: git.baseCommit, runBranch, prTargetBranch } });
  const codingArtifacts = await writeCodingArtifacts(run.runDir, analysis.taskBrief, codingResult);
  let validationReport = await validationRunner.run({ workspacePath: codingResult.workspacePath, commands: validationCommands });
  let validationReportPath = await writeValidationReport(run.runDir, validationReport);
  await completeAttempt({
    runDir: run.runDir,
    step: currentStep,
    attempt: currentAttempt,
    status: "succeeded",
    codexThreadId: codingResult.threadId,
    resultStatus: "completed",
    changedFiles: codingResult.changedFiles,
    validationSummary: validationReport.status,
    workspacePath: codingResult.workspacePath,
    artifacts: artifactRefs(run.runDir, {
      codingResultPath: codingArtifacts.codingResultPath,
      diffPath: codingArtifacts.diffPath,
      statusPath: codingArtifacts.statusPath,
      taskBriefPath: codingArtifacts.taskBriefPath,
      validationReportPath,
      runtimeDir: path.join(path.dirname(codingResult.workspacePath), "runtime"),
      runtimeManifestPath: path.join(path.dirname(codingResult.workspacePath), "runtime", "runtime.json"),
      runtimeStdoutPath: path.join(path.dirname(codingResult.workspacePath), "runtime", "codex-runtime.stdout.log"),
      runtimeStderrPath: path.join(path.dirname(codingResult.workspacePath), "runtime", "codex-runtime.stderr.log"),
      runtimeErrorPath: path.join(path.dirname(codingResult.workspacePath), "runtime", "codex-runtime-error.json"),
    }),
  });
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
    currentStep = await import("../runs/sessionModel.js").then(m => m.loadStep(run.runDir, currentStep.stepId));
    currentAttempt = await startAttempt({ runDir: run.runDir, step: currentStep, prompt: reworkPackage.mustChange.join("\n"), runtimeMode: loaded.config.codex.sandboxMode });
    await assertWorkspaceBranch(run.runDir);
    codingResult = await codingWorker.continueTask({
      threadId: codingResult.threadId,
      workspacePath: codingResult.workspacePath,
      workspaceRoot,
      reworkPackage,
      sandboxMode: loaded.config.codex.sandboxMode,
    });
    await writeCodingArtifacts(attemptDir, analysis.taskBrief, codingResult);
    validationReport = await validationRunner.run({ workspacePath: codingResult.workspacePath, commands: validationCommands });
    validationReportPath = await writeValidationReport(attemptDir, validationReport);
    await completeAttempt({
      runDir: run.runDir,
      step: currentStep,
      attempt: currentAttempt,
      status: "succeeded",
      codexThreadId: codingResult.threadId,
      resultStatus: "completed",
      changedFiles: codingResult.changedFiles,
      validationSummary: validationReport.status,
      workspacePath: codingResult.workspacePath,
      artifacts: artifactRefs(run.runDir, {
        codingResultPath: path.join(attemptDir, "coding-result.json"),
        diffPath: path.join(attemptDir, "workspace.diff"),
        statusPath: path.join(attemptDir, "workspace-status.txt"),
        taskBriefPath: path.join(attemptDir, "task-brief.json"),
        validationReportPath,
        reviewReportPath,
        runtimeDir: path.join(path.dirname(codingResult.workspacePath), "runtime"),
        runtimeManifestPath: path.join(path.dirname(codingResult.workspacePath), "runtime", "runtime.json"),
        runtimeStdoutPath: path.join(path.dirname(codingResult.workspacePath), "runtime", "codex-runtime.stdout.log"),
        runtimeStderrPath: path.join(path.dirname(codingResult.workspacePath), "runtime", "codex-runtime.stderr.log"),
        runtimeErrorPath: path.join(path.dirname(codingResult.workspacePath), "runtime", "codex-runtime-error.json"),
      }),
    });
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
  const finalChangedFileObjects = await Promise.all(codingResult.changedFiles.map(async file => {
    let exists = false;
    try { exists = (await stat(path.join(codingResult.workspacePath, file))).isFile(); } catch {}
    return { path: file, changeType: (exists ? (await isTracked(codingResult.workspacePath, file) ? "modified" : "created") : "deleted") as "created" | "modified" | "deleted", exists };
  }));
  const finalOutputs = finalChangedFileObjects.filter(file => file.exists && /\.(md|txt|json|diff|log|ts|tsx|js|css|html|ya?ml)$/i.test(file.path)).map(file => ({ label: path.basename(file.path), path: file.path, type: "file" as const, contentAvailable: true }));
  const finalResult: FinalResult = {
    schemaVersion: 1,
    runId: run.runId,
    status: finalStatus,
    terminalMessage: finalStatus === "ACCEPTED" ? "TASK COMPLETE" : finalStatus === "HUMAN_REQUIRED" ? "HUMAN REVIEW REQUIRED" : "TASK FAILED",
    error: finalStatus === "REWORK_LIMIT_REACHED" ? { code: "attempt_exhaustion", message: reviewReport.summary || "Review requested rework, but no reason was recorded.", stepId: currentStep.stepId, details: reviewReport.blockingFindings.map(f => `${f.title}: ${f.requiredChange}`).join("\n") } : null,
    workspacePath: codingResult.workspacePath,
    changedFiles: finalChangedFileObjects,
    outputs: finalOutputs,
    finalResponse: codingResult.finalResponse,
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
  console.log(`Config source: ${configSource}`);
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
