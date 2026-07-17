import { createHash } from "node:crypto";
import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { runArtifactPath } from "./artifactPaths.js";
import { assertCodexCapabilities, createCodexCli, type CodexCli } from "./codexCliAdapter.js";
import { acquireRepositoryLock, acquireTaskLock, type HeldLock } from "./lock.js";
import { atomicWriteJson } from "./persistence.js";
import { createCodexChildEnvironment } from "./runtimePolicy.js";
import { parseTaskPackage, readTaskPackage, type TaskPackage } from "./taskPackage.js";
import { realpathWithinPackage } from "./taskPackagePaths.js";
import { createExternalWorktree, type GitCommand } from "./worktree.js";
import { runBaselineChecks } from "./checks.js";

export type BaselineResult = { id: string; required: boolean; mustPassAtBaseline: boolean; exitCode: number; passed: boolean };
export type PreflightResult = { task: TaskPackage; workspacePath: string; baseCommitSha: string; baseline: BaselineResult[]; runtimeMetadata: { policy: string; allowedNames: string[]; deniedNames: string[] }; release(): Promise<void> };

function taskLockDirectory(artifactDir: string, packageDir: string): string {
  return path.join(path.dirname(artifactDir), ".task-locks", createHash("sha256").update(packageDir).digest("hex"));
}

/**
 * Performs all non-model checks before an attempt exists.  Call release() after
 * the run ends; locks intentionally span worktree creation and its owner run.
 */
export async function runPreflight(input: { packageDir: string; artifactDir: string; repositoryPath: string; workspaceRoot: string; runId: string; git: GitCommand; cli?: CodexCli; catosRoot?: string; minimumCodexVersion?: string; environment?: NodeJS.ProcessEnv }): Promise<PreflightResult> {
  const packageDir = await realpath(input.packageDir);
  const repositoryPath = await realpath(input.repositoryPath);
  const artifactDir = path.resolve(input.artifactDir);
  if (artifactDir === packageDir || artifactDir.startsWith(`${packageDir}${path.sep}`)) throw new Error("Run artifacts must be outside the immutable Task Package.");
  // Schema validation intentionally precedes locking so malformed v2 packages
  // cannot reserve either shared resource.
  await realpathWithinPackage(packageDir, "task.json");
  const task = parseTaskPackage(await readTaskPackage(packageDir));
  // The package is an input snapshot, including its directory entries.  Keep
  // coordination metadata alongside Run data rather than creating .task.lock
  // inside the frozen package.
  const taskLock = await acquireTaskLock(taskLockDirectory(artifactDir, packageDir));
  let repositoryLock: HeldLock | undefined;
  try {
    repositoryLock = await acquireRepositoryLock(repositoryPath);
    await input.git(["--version"], repositoryPath);
    const isRepository = (await input.git(["rev-parse", "--is-inside-work-tree"], repositoryPath)).stdout.trim();
    if (isRepository !== "true") throw new Error("Target path is not a Git worktree.");
    const resolved = (await input.git(["rev-parse", "--verify", `${task.baseCommitSha}^{commit}`], repositoryPath)).stdout.trim();
    if (resolved.toLowerCase() !== task.baseCommitSha.toLowerCase()) throw new Error("Task baseCommitSha is not an immutable reachable commit.");
    const cliResult = await assertCodexCapabilities(input.cli ?? createCodexCli(), input.minimumCodexVersion, input.environment);
    const worktree = await createExternalWorktree({ repositoryPath, workspaceRoot: input.workspaceRoot, runId: input.runId, baseCommitSha: task.baseCommitSha, git: input.git, catosRoot: input.catosRoot });
    const runtime = createCodexChildEnvironment(input.environment);
    await mkdir(artifactDir, { recursive: true });
    // Baselines use the same no-shell runner as post-commit tests.  This means no
    // project YAML command string or inherited process environment can enter v2.
    const baselineReport = await runBaselineChecks({ task, workspacePath: worktree.workspacePath, artifactDir, expectedHead: worktree.baseCommitSha, environment: input.environment });
    const baseline: BaselineResult[] = baselineReport.results.map((result) => ({ id: result.id, required: result.required, mustPassAtBaseline: result.mustPassAtBaseline, exitCode: result.process.exitCode ?? -1, passed: result.status === "PASS" }));
    if (baselineReport.status !== "PASS") throw new Error(`Baseline check failed: ${baselineReport.results.find((result) => result.status !== "PASS")?.id ?? "test process"}`);
    // Names-only metadata: do not persist environment values, command output, or credentials.
    await atomicWriteJson(runArtifactPath(artifactDir, "runtime"), { auth: cliResult.capabilities.auth, codexVersion: cliResult.capabilities.version, environment: runtime.metadata });
    await atomicWriteJson(runArtifactPath(artifactDir, "worktree"), { workspacePath: worktree.workspacePath, baseCommitSha: worktree.baseCommitSha });
    await atomicWriteJson(runArtifactPath(artifactDir, "baselineTests"), baseline);
    let released = false;
    return { task, workspacePath: worktree.workspacePath, baseCommitSha: worktree.baseCommitSha, baseline, runtimeMetadata: runtime.metadata, async release() { if (!released) { released = true; await repositoryLock!.release(); await taskLock.release(); } } };
  } catch (error) { await repositoryLock?.release().catch(() => undefined); await taskLock.release().catch(() => undefined); throw error; }
}
