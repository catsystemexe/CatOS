import path from "node:path";
import { mkdir } from "node:fs/promises";
import { captureAttemptGitGuards, validateChanges, type ChangeValidationReport } from "./changeValidation.js";
import { runTaskChecks, type CheckRunReport } from "./checks.js";
import { runCodex, type CodexRunOptions } from "./codexRunner.js";
import { createCodingPrompt, createReviewPrompt } from "./feeder.js";
import { git } from "./git.js";
import { commitValidatedChanges, type V2Commit } from "./gitCommit.js";
import type { CodingResult, ReviewResult } from "./modelSchemas.js";
import { atomicWriteJson } from "./persistence.js";
import { createReworkContext, type ReworkContext } from "./reworkContext.js";
import { validateReviewResult } from "./reviewValidation.js";
import type { TaskPackage } from "./taskPackage.js";

export type OrchestratorInput = Readonly<{
  task: TaskPackage; workspacePath: string; artifactDir: string; runId: string; executable: string;
  timeoutMs?: number; maxReworks?: number; globalPathRules?: string[]; taskPackageDir?: string; taskPackagePath?: string;
  /** Optional task-level criteria are preserved in the Review snapshot. */ acceptanceCriteria?: readonly string[];
  sourceEnv?: NodeJS.ProcessEnv; extraEnv?: NodeJS.ProcessEnv;
}>;
export type StepOutcome = Readonly<{ stepId: string; status: "APPROVED" | "BLOCKED" | "REWORK_LIMIT_REACHED"; attempts: number; commits: readonly V2Commit[]; review?: ReviewResult }>;
export type OrchestratorResult = Readonly<{ status: "APPROVED" | "BLOCKED" | "REWORK_LIMIT_REACHED"; steps: readonly StepOutcome[] }>;

function frozen<T extends object>(value: T): T { return Object.freeze(value); }
function attemptId(stepId: string, number: number): string { return `${stepId}-attempt-${number}`; }
async function snapshot(workspacePath: string): Promise<{ head: string; status: string }> { return { head: (await git(workspacePath, ["rev-parse", "HEAD"])).trim(), status: await git(workspacePath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]) }; }
async function discardUncommitted(workspacePath: string): Promise<void> { await git(workspacePath, ["reset", "--hard", "HEAD"]); await git(workspacePath, ["clean", "-fd"]); }

/**
 * Sole v2 transition authority.  No caller receives a hook between Coding,
 * validation, CatOS commit, checks, and the read-only Review boundary.
 */
export async function orchestrate(input: OrchestratorInput): Promise<OrchestratorResult> {
  await mkdir(input.artifactDir, { recursive: true });
  const runBaseCommit = (await git(input.workspacePath, ["rev-parse", "HEAD"])).trim();
  const task = frozen({ ...input.task, checks: Object.freeze(input.task.checks.map((c) => frozen({ ...c, argv: Object.freeze([...c.argv]) }))), steps: Object.freeze(input.task.steps.map((s) => frozen({ ...s, checks: Object.freeze([...s.checks]), files: Object.freeze([...s.files]), dependsOn: Object.freeze([...s.dependsOn]) }))) });
  const outcomes: StepOutcome[] = []; const maxReworks = input.maxReworks ?? 3;
  for (const originalStep of task.steps) {
    const step = frozen({ ...originalStep, acceptanceCriteria: Object.freeze(input.acceptanceCriteria?.length ? [...input.acceptanceCriteria] : [`Only paths matching: ${originalStep.files.join(", ") || "(none declared)"}`, `Blocking checks: ${originalStep.checks.join(", ") || "(none declared)"}`]) });
    const commits: V2Commit[] = []; let context: ReworkContext | null = null; let finalReview: ReviewResult | undefined;
    for (let number = 1; ; number += 1) {
      const id = attemptId(step.id, number); const directory = path.join(input.artifactDir, "steps", step.id, "attempts", String(number)); await mkdir(directory, { recursive: true });
      const attempt = frozen({ id, attemptId: id, number, rework: number > 1, codingHandoff: context, commitBoundaries: { previousStepCommits: commits.map((commit) => commit.resultSha) } });
      const codingPrompt = createCodingPrompt(task, step, attempt, context);
      const guards = await captureAttemptGitGuards(input.workspacePath);
      const coding = await runCodex<CodingResult>({ executable: input.executable, mode: "coding", prompt: codingPrompt.prompt, cwd: input.workspacePath, artifactDirectory: path.join(directory, "coding"), timeoutMs: input.timeoutMs ?? 120_000, sourceEnv: input.sourceEnv, extraEnv: input.extraEnv });
      await atomicWriteJson(path.join(directory, "coding-result.json"), coding.result);
      if (coding.result.status === "BLOCKED") { outcomes.push(frozen({ stepId: step.id, status: "BLOCKED", attempts: number, commits: frozen(commits), review: undefined })); return frozen({ status: "BLOCKED", steps: frozen(outcomes) }); }
      const validationInput = { workspacePath: input.workspacePath, artifactDir: directory, taskId: task.taskId, stepId: step.id, attemptId: id, runId: input.runId, attemptBaseCommit: guards.attemptBaseCommit, expectedBranch: guards.branch, attemptBaseTags: guards.tags, attemptBaseSubmodules: guards.submodules, globalPathRules: input.globalPathRules ?? ["**"], stepPathRules: step.files.length ? [...step.files] : ["**"], taskPackageDir: input.taskPackageDir, taskPackagePath: input.taskPackagePath };
      const validation: ChangeValidationReport = await validateChanges(validationInput);
      if (validation.status !== "PASS") { await discardUncommitted(input.workspacePath); if (number > maxReworks) { outcomes.push(frozen({ stepId: step.id, status: "REWORK_LIMIT_REACHED", attempts: number, commits: frozen(commits) })); return frozen({ status: "REWORK_LIMIT_REACHED", steps: frozen(outcomes) }); } context = createReworkContext({ attemptNumber: number, validation }); continue; }
      const commit = await commitValidatedChanges({ ...validationInput, validation, codingStatus: coding.result.status }); commits.push(commit);
      const checks: CheckRunReport = await runTaskChecks({ task, workspacePath: input.workspacePath, artifactDir: directory, phase: "POST_COMMIT", stepId: step.id, expectedHead: commit.resultSha, environment: input.extraEnv });
      if (checks.status !== "PASS") { if (number > maxReworks) { outcomes.push(frozen({ stepId: step.id, status: "REWORK_LIMIT_REACHED", attempts: number, commits: frozen(commits) })); return frozen({ status: "REWORK_LIMIT_REACHED", steps: frozen(outcomes) }); } context = createReworkContext({ attemptNumber: number, checks, priorCommit: commit.resultSha }); continue; }
      const beforeReview = await snapshot(input.workspacePath);
      const cumulativeBase = runBaseCommit;
      const reviewAttempt = frozen({ ...attempt, commitBoundaries: { cumulativeBase, deltaBase: commit.parentSha, head: commit.resultSha }, cumulativeDiff: await git(input.workspacePath, ["diff", `${cumulativeBase}..${commit.resultSha}`]), deltaDiff: await git(input.workspacePath, ["diff", `${commit.parentSha}..${commit.resultSha}`]), codingHandoff: coding.result, blockingTests: checks.results.filter((r) => r.blocking), nonBlockingTests: checks.results.filter((r) => !r.blocking) });
      const reviewPrompt = createReviewPrompt(task, step, reviewAttempt, context);
      const reviewRun = await runCodex<ReviewResult>({ executable: input.executable, mode: "review", prompt: reviewPrompt.prompt, cwd: input.workspacePath, artifactDirectory: path.join(directory, "review"), timeoutMs: input.timeoutMs ?? 120_000, sourceEnv: input.sourceEnv, extraEnv: input.extraEnv, sandbox: "read-only" });
      const afterReview = await snapshot(input.workspacePath);
      if (beforeReview.head !== afterReview.head || beforeReview.status !== afterReview.status) throw new Error("Review mutation detected: Review must be read-only.");
      const review = validateReviewResult(reviewRun.result); await atomicWriteJson(path.join(directory, "review-result.json"), review); finalReview = review;
      if (review.decision === "APPROVE") { outcomes.push(frozen({ stepId: step.id, status: "APPROVED", attempts: number, commits: frozen(commits), review })); break; }
      if (review.decision === "BLOCKED") { outcomes.push(frozen({ stepId: step.id, status: "BLOCKED", attempts: number, commits: frozen(commits), review })); return frozen({ status: "BLOCKED", steps: frozen(outcomes) }); }
      if (number > maxReworks) { outcomes.push(frozen({ stepId: step.id, status: "REWORK_LIMIT_REACHED", attempts: number, commits: frozen(commits), review })); return frozen({ status: "REWORK_LIMIT_REACHED", steps: frozen(outcomes) }); }
      context = createReworkContext({ attemptNumber: number, review, priorCommit: commit.resultSha });
    }
    void finalReview;
  }
  return frozen({ status: "APPROVED", steps: frozen(outcomes) });
}

export const runOrchestrator = orchestrate;
export const runV2Orchestrator = orchestrate;
