import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { git } from "./git.js";
import { atomicWriteJson } from "./persistence.js";
import type { TaskPackage } from "./taskPackage.js";
import { runTestProcess, type TestProcessResult } from "./testRunner.js";

export type CheckPhase = "BASELINE" | "POST_COMMIT";
export type CheckStatus = "PASS" | "FAIL" | "TIMEOUT" | "SIGNAL" | "RUNNER_ERROR" | "GIT_MUTATION";
export type CheckResult = Readonly<{ id: string; argv: readonly string[]; required: boolean; blocking: boolean; mustPassAtBaseline: boolean; cwd: string; timeoutSeconds: number; status: CheckStatus; process: TestProcessResult; gitViolation?: string }>;
export type CheckRunReport = Readonly<{ schemaVersion: 2; phase: CheckPhase; status: "PASS" | "REWORK_TESTS" | "FAILED_TEST_PROCESS"; expectedHead: string; results: readonly CheckResult[]; startedAt: string; finishedAt: string }>;

function inside(parent: string, child: string): boolean { const relative = path.relative(parent, child); return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative)); }
async function checkCwd(workspace: string, value: string | undefined, id: string): Promise<string> {
  if (!value) return workspace;
  if (path.isAbsolute(value) || value.includes("\0")) throw new Error(`Check cwd must be relative: ${id}`);
  const resolved = await realpath(path.resolve(workspace, value)).catch(() => { throw new Error(`Check cwd must exist within worktree: ${id}`); });
  if (!inside(workspace, resolved)) throw new Error(`Check cwd escapes worktree: ${id}`);
  return resolved;
}
async function gitInvariant(workspacePath: string, expectedHead: string): Promise<string | undefined> {
  try {
    const [head, dirty] = await Promise.all([git(workspacePath, ["rev-parse", "HEAD"]), git(workspacePath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"])]);
    if (head.trim() !== expectedHead) return `HEAD changed: expected ${expectedHead}, got ${head.trim()}.`;
    if (dirty) return "Worktree changed while running checks.";
  } catch (error) { return `Git guard failed: ${error instanceof Error ? error.message : String(error)}`; }
  return undefined;
}
function statusFor(process: TestProcessResult): CheckStatus {
  if (process.runnerError) return "RUNNER_ERROR";
  if (process.timedOut) return "TIMEOUT";
  if (process.signal) return "SIGNAL";
  return process.exitCode === 0 ? "PASS" : "FAIL";
}

/** Runs only Task Package argv metadata and checks Git invariants after every check and after the complete set. */
export async function runTaskChecks(input: { task: TaskPackage; workspacePath: string; artifactDir: string; phase: CheckPhase; expectedHead?: string; stepId?: string; timeoutMs?: number; environment?: NodeJS.ProcessEnv }): Promise<CheckRunReport> {
  const workspacePath = await realpath(input.workspacePath); const expectedHead = input.expectedHead ?? (await git(workspacePath, ["rev-parse", "HEAD"])).trim();
  const startedAt = new Date().toISOString(); const results: CheckResult[] = []; const selected = input.phase === "BASELINE" || !input.stepId ? input.task.checks : input.task.checks.filter((check) => input.task.steps.find((step) => step.id === input.stepId)?.checks.includes(check.id));
  await mkdir(input.artifactDir, { recursive: true });
  let processFailure = await gitInvariant(workspacePath, expectedHead);
  for (const check of selected) {
    if (processFailure) break;
    const cwd = await checkCwd(workspacePath, check.cwd, check.id);
    const root = path.join(input.artifactDir, input.phase.toLowerCase(), check.id);
    const process = await runTestProcess({ argv: check.argv, cwd, timeoutMs: input.timeoutMs ?? check.timeoutSeconds * 1_000, environment: input.environment, logPaths: { stdout: path.join(root, "stdout.log"), stderr: path.join(root, "stderr.log") } });
    const violation = await gitInvariant(workspacePath, expectedHead);
    results.push(Object.freeze({ id: check.id, argv: check.argv, required: check.required, blocking: check.blocking, mustPassAtBaseline: check.mustPassAtBaseline, cwd, timeoutSeconds: check.timeoutSeconds, status: violation ? "GIT_MUTATION" : statusFor(process), process, ...(violation ? { gitViolation: violation } : {}) }));
    processFailure = violation ?? (process.runnerError || process.timedOut || process.signal ? `Test process failure: ${check.id}` : undefined);
  }
  const finalInvariant = await gitInvariant(workspacePath, expectedHead); processFailure ??= finalInvariant;
  const blockingFailure = results.some((result) => result.blocking && result.status === "FAIL" && (input.phase !== "BASELINE" || result.mustPassAtBaseline));
  const status = processFailure || results.some((result) => ["TIMEOUT", "SIGNAL", "RUNNER_ERROR", "GIT_MUTATION"].includes(result.status)) ? "FAILED_TEST_PROCESS" : blockingFailure ? "REWORK_TESTS" : "PASS";
  const report = Object.freeze({ schemaVersion: 2 as const, phase: input.phase, status, expectedHead, results: Object.freeze(results), startedAt, finishedAt: new Date().toISOString() });
  await atomicWriteJson(path.join(input.artifactDir, input.phase.toLowerCase(), "test-report.json"), report);
  return report;
}

export const runChecks = runTaskChecks;
export const runBaselineChecks = (input: Omit<Parameters<typeof runTaskChecks>[0], "phase">) => runTaskChecks({ ...input, phase: "BASELINE" });
