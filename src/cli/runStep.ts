import { copyFile, mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { reviewChange, writeReviewReport, type ReviewerProvider } from "../agents/reviewer.js";
import { loadProjectConfig } from "../config/loadConfig.js";
import { writeContinuePackage } from "../continuePackage.js";
import { CodexSdkWorker, writeCodingArtifacts, type CodingResult, type CodingWorker } from "../codingWorker.js";
import { writeReviewPackage } from "../reviewPackage.js";
import { attemptDir, artifactRefs, completeAttempt, loadSession, loadStep, startAttempt, type Attempt, type Step } from "../runs/sessionModel.js";
import type { TaskBrief } from "../schemas/taskBrief.js";
import type { TaskInput } from "../schemas/taskInput.js";
import { ShellValidationRunner, buildValidationCommands, writeValidationReport, type ValidationRunner } from "../validationRunner.js";
import { resolveWorkspaceRoot } from "../workspaceRoot.js";

type RunStepOptions = { runsDir?: string; cwd?: string; codingWorker?: CodingWorker; validationRunner?: ValidationRunner; reviewerProvider?: ReviewerProvider };

function readOption(args: string[], name: string): string | undefined { const i=args.indexOf(name); return i === -1 ? undefined : args[i+1]; }
async function exists(file: string): Promise<boolean> { return stat(file).then(() => true, () => false); }
async function readJson<T>(file: string): Promise<T> { return JSON.parse(await readFile(file, "utf8")) as T; }
async function copyIfExists(from: string, to: string): Promise<string | undefined> { if (!(await exists(from))) return undefined; await mkdir(path.dirname(to), { recursive: true }); if (path.resolve(from) !== path.resolve(to)) await copyFile(from, to); return to; }
function taskBriefForStep(step: Step, prompt: string): TaskBrief { return { objective: step.title, acceptanceCriteria: [step.request], nonGoals: ["Do not push, merge, or create a remote PR."], codexInstruction: prompt, riskLevel: "standard" }; }
function runtimeStatus(error: unknown): { status: Attempt["status"]; resultStatus: string } {
  const msg = error instanceof Error ? error.message : String(error);
  return /timed out|timeout/i.test(msg) ? { status: "timed_out", resultStatus: "runtime-timeout" } : { status: "failed", resultStatus: "runtime-failure" };
}

async function runFakeChild(runDir: string, workspacePath: string, attemptPath: string): Promise<CodingResult> {
  await mkdir(workspacePath, { recursive: true });
  const runtimeDir = path.join(attemptPath, "runtime");
  await mkdir(runtimeDir, { recursive: true });
  await writeFile(path.join(runtimeDir, "runtime.json"), `${JSON.stringify({ schemaVersion: 1, runtime: "fake-child", sandboxMode: "danger-full-access", sandboxIsolation: "disabled", environmentPolicy: "allowlist", githubCredentialsRemoved: true, sshAgentRemoved: true }, null, 2)}\n`, "utf8");
  await writeFile(path.join(runtimeDir, "codex-runtime.stdout.log"), "fake-child stdout\n", "utf8");
  await writeFile(path.join(runtimeDir, "codex-runtime.stderr.log"), "", "utf8");
  return { threadId: `fake-thread-${path.basename(attemptPath)}`, finalResponse: "Fake child completed without modifying files.", workspacePath, changedFiles: [], diff: "", status: "", sandboxMode: "danger-full-access", sandboxIsolation: "disabled" };
}

export async function runStepCommand(args:string[], options:RunStepOptions={}): Promise<void> {
  const runId=readOption(args,"--run"); if(!runId) throw new Error("Chybí povinný parametr --run.");
  const root = options.cwd ?? process.cwd();
  const runDir=path.resolve(root, options.runsDir ?? "runs", runId);
  const fake = args.includes("--fake-child");
  const session = await loadSession(runDir);
  let step=await loadStep(runDir);
  if (!["open", "awaiting_decision"].includes(step.status)) throw new Error(`run-step is not allowed while step ${step.stepId} is ${step.status}.`);

  const taskInput = await readJson<TaskInput>(path.join(runDir, "input.json")).catch(() => ({ schemaVersion: 1, runId, projectId: "demo", goal: session.goal, createdAt: session.createdAt, configPath: "projects/demo.yaml" }) as TaskInput);
  const loaded = await loadProjectConfig(taskInput.configPath, root);
  const generated=await writeContinuePackage(runDir, new Date(), { cwd: root });
  const promptPath=readOption(args,"--prompt-file") ?? generated.codexPromptPath;
  const prompt=await readFile(promptPath,"utf8");
  const threadId = generated.package.execution.threadId;
  const runtimeMode = fake ? "fake-child" : loaded.config.codex.sandboxMode;
  const attempt=await startAttempt({ runDir, step, prompt: prompt.trimEnd(), runtimeMode });
  const thisAttemptDir = attemptDir(runDir, step, attempt);
  const workspacePath = session.workspacePath ?? generated.package.session.workspacePath;
  if (!workspacePath && !fake) throw new Error("Session has no workspacePath; run the initial hardened run first.");
  const workspaceRoot = resolveWorkspaceRoot(loaded.config.execution.workspaceRoot);
  const validationRunner = options.validationRunner ?? new ShellValidationRunner();
  const validationCommands = buildValidationCommands(loaded.config.commands, loaded.config.validation);
  const reviewerProvider = options.reviewerProvider;
  const taskBrief = taskBriefForStep(step, prompt);
  let reviewPackagePath: string | undefined;
  let completed: Attempt | undefined;

  try {
    const codingWorker = options.codingWorker ?? new CodexSdkWorker();
    const codingResult = fake
      ? await runFakeChild(runDir, workspacePath ?? path.join(runDir, "workspace"), thisAttemptDir)
      : codingWorker.continueInstruction
        ? await codingWorker.continueInstruction({ threadId, instruction: prompt, workspacePath, workspaceRoot, sandboxMode: loaded.config.codex.sandboxMode })
        : await codingWorker.continueTask({ threadId: threadId ?? "", workspacePath, workspaceRoot, reworkPackage: { schemaVersion: 1, attempt: attempt.order, originalObjective: step.title, acceptanceCriteria: [step.request], blockingFindings: [{ id: "run-step", title: "Continue active step", evidence: "Generated Continue Package", requiredChange: prompt }], preserve: ["Existing audited session artifacts."], mustChange: [prompt], mustNotChange: ["Do not push, merge, or create a remote PR."], previousAttemptSummary: "AutoCodex run-step continuation." }, sandboxMode: loaded.config.codex.sandboxMode });
    const codingArtifacts = await writeCodingArtifacts(thisAttemptDir, taskBrief, codingResult);
    const validationReport = fake
      ? { schemaVersion: 1 as const, status: "PASS" as const, workspacePath: codingResult.workspacePath, startedAt: new Date().toISOString(), finishedAt: new Date().toISOString(), results: [] }
      : await validationRunner.run({ workspacePath: codingResult.workspacePath, commands: validationCommands });
    const validationReportPath = await writeValidationReport(thisAttemptDir, validationReport);
    await copyIfExists(validationReportPath, path.join(runDir, "validation-report.json"));
    const reviewReport = fake ? { schemaVersion: 1 as const, verdict: "ACCEPT" as const, summary: "Fake child smoke review fixture.", reviewedAcceptanceCriteria: [], blockingFindings: [], warnings: [] } : await reviewChange({
      taskInput,
      taskBrief,
      codingResult,
      workspaceDiff: codingResult.diff,
      workspaceStatus: codingResult.status,
      validationReport,
      projectConstraints: { permissions: loaded.config.permissions, workflow: loaded.config.workflow, codex: loaded.config.codex },
    }, { provider: reviewerProvider });
    const reviewReportPath = await writeReviewReport(thisAttemptDir, reviewReport);
    await copyIfExists(reviewReportPath, path.join(runDir, "review-report.json"));
    const runtimeSource = fake ? path.join(thisAttemptDir, "runtime") : path.join(path.dirname(codingResult.workspacePath), "runtime");
    const runtimeTarget = path.join(thisAttemptDir, "runtime");
    const runtimeManifest = await copyIfExists(path.join(runtimeSource, "runtime.json"), path.join(runtimeTarget, "runtime.json"));
    const runtimeStdout = await copyIfExists(path.join(runtimeSource, "codex-runtime.stdout.log"), path.join(runtimeTarget, "codex-runtime.stdout.log"));
    const runtimeStderr = await copyIfExists(path.join(runtimeSource, "codex-runtime.stderr.log"), path.join(runtimeTarget, "codex-runtime.stderr.log"));
    const runtimeError = await copyIfExists(path.join(runtimeSource, "codex-runtime-error.json"), path.join(runtimeTarget, "codex-runtime-error.json"));
    const resultStatus = validationReport.status !== "PASS" ? "validation-failure" : reviewReport.verdict === "REWORK" ? "review-rework" : reviewReport.verdict === "HUMAN_REQUIRED" ? "human-required" : "completed";
    completed = await completeAttempt({ runDir, step, attempt, status: "succeeded", codexThreadId: codingResult.threadId, resultStatus, changedFiles: codingResult.changedFiles, validationSummary: validationReport.status, workspacePath: codingResult.workspacePath, artifacts: artifactRefs(runDir, { ...codingArtifacts, validationReportPath, reviewReportPath, runtimeDir: runtimeTarget, runtimeManifestPath: runtimeManifest, runtimeStdoutPath: runtimeStdout, runtimeStderrPath: runtimeStderr, runtimeErrorPath: runtimeError }) });
    const rp = await writeReviewPackage(runDir).catch((e: unknown) => ({ markdownPath: undefined, error: e }));
    reviewPackagePath = "markdownPath" in rp ? rp.markdownPath : undefined;
    if ("error" in rp) console.warn(`Review Package refresh failed: ${rp.error instanceof Error ? rp.error.message : String(rp.error)}`);
    console.log("Step attempt completed");
    console.log(`Session: ${session.sessionId}`);
    console.log(`Step: ${step.stepId}`);
    console.log(`Attempt: ${attempt.attemptId}`);
    console.log(`Runtime: ${fake ? "fake-child" : "hardened-codex"}`);
    console.log(`Codex thread: ${codingResult.threadId}`);
    console.log(`Changed files: ${codingResult.changedFiles.length ? codingResult.changedFiles.join(", ") : "none"}`);
    console.log(`Validation: ${validationReport.status}`);
    console.log(`Review: ${reviewReport.verdict}`);
    console.log("Status: awaiting_decision");
    console.log(`Review package: ${reviewPackagePath ?? "not refreshed; run npm run catos -- review --run " + runId}`);
    console.log(`Next step: npm run catos -- decide --run ${runId}`);
  } catch (error) {
    const { status, resultStatus } = runtimeStatus(error);
    const runtimeDir = path.join(thisAttemptDir, "runtime");
    await mkdir(runtimeDir, { recursive: true });
    const runtimeErrorPath = path.join(runtimeDir, "codex-runtime-error.json");
    if (!(await exists(runtimeErrorPath))) await writeFile(runtimeErrorPath, `${JSON.stringify({ schemaVersion: 1, reason: resultStatus, message: error instanceof Error ? error.message : String(error) }, null, 2)}\n`, "utf8");
    completed = await completeAttempt({ runDir, step, attempt, status, resultStatus, errorSummary: error instanceof Error ? error.message : String(error), changedFiles: [], artifacts: artifactRefs(runDir, { runtimeDir, runtimeErrorPath, runtimeManifestPath: path.join(runtimeDir, "runtime.json"), runtimeStdoutPath: path.join(runtimeDir, "codex-runtime.stdout.log"), runtimeStderrPath: path.join(runtimeDir, "codex-runtime.stderr.log") }) });
    await writeReviewPackage(runDir).catch(() => undefined);
    console.log(`Runtime error artifact: ${path.relative(runDir, runtimeErrorPath)}`);
    throw error;
  } finally {
    void completed;
  }
}
