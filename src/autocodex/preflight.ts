import { mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { artifactPath } from "./artifactPaths.js";
import { assertCodexCapabilities, createCodexCli, type CodexCli } from "./codexCliAdapter.js";
import { acquireRepositoryLock, acquireTaskLock, type HeldLock } from "./lock.js";
import { atomicWriteJson } from "./persistence.js";
import { createCodexChildEnvironment } from "./runtimePolicy.js";
import { parseTaskPackage, readTaskPackage, type TaskPackage } from "./taskPackage.js";
import { realpathWithinPackage } from "./taskPackagePaths.js";
import { createExternalWorktree, type GitCommand } from "./worktree.js";

export type BaselineResult = { id: string; required: boolean; mustPassAtBaseline: boolean; exitCode: number; passed: boolean };
export type BaselineRunner = (argv: string[], cwd: string, env: NodeJS.ProcessEnv) => Promise<{ exitCode: number }>;
export type PreflightResult = { task: TaskPackage; workspacePath: string; baseCommitSha: string; baseline: BaselineResult[]; runtimeMetadata: { policy: string; allowedNames: string[]; deniedNames: string[] }; release(): Promise<void> };

/**
 * Performs all non-model checks before an attempt exists.  Call release() after
 * the run ends; locks intentionally span worktree creation and its owner run.
 */
export async function runPreflight(input: { packageDir: string; repositoryPath: string; workspaceRoot: string; runId: string; git: GitCommand; baselineRunner: BaselineRunner; cli?: CodexCli; catosRoot?: string; minimumCodexVersion?: string; environment?: NodeJS.ProcessEnv }): Promise<PreflightResult> {
  const packageDir = await realpath(input.packageDir);
  const repositoryPath = await realpath(input.repositoryPath);
  // Schema validation intentionally precedes locking so malformed v2 packages
  // cannot reserve either shared resource.
  await realpathWithinPackage(packageDir, "task.json");
  const task = parseTaskPackage(await readTaskPackage(packageDir));
  const taskLock = await acquireTaskLock(packageDir);
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
    const baseline: BaselineResult[] = [];
    for (const check of task.checks) {
      const cwd = check.cwd ? await resolveCheckCwd(worktree.workspacePath, check.cwd, check.id) : worktree.workspacePath;
      const result = await input.baselineRunner(check.argv, cwd, runtime.env);
      const record = { id: check.id, required: check.required, mustPassAtBaseline: check.mustPassAtBaseline, exitCode: result.exitCode, passed: result.exitCode === 0 };
      baseline.push(record);
      if (check.mustPassAtBaseline && !record.passed) throw new Error(`Baseline check failed: ${check.id}`);
    }
    const artifacts = path.join(packageDir, "artifacts"); await mkdir(artifacts, { recursive: true });
    // Names-only metadata: do not persist environment values, command output, or credentials.
    await atomicWriteJson(artifactPath(packageDir, "runtime.json"), { auth: cliResult.capabilities.auth, codexVersion: cliResult.capabilities.version, environment: runtime.metadata });
    await atomicWriteJson(artifactPath(packageDir, "worktree.json"), { workspacePath: worktree.workspacePath, baseCommitSha: worktree.baseCommitSha });
    await atomicWriteJson(artifactPath(packageDir, "baseline/test-results.json"), baseline);
    let released = false;
    return { task, workspacePath: worktree.workspacePath, baseCommitSha: worktree.baseCommitSha, baseline, runtimeMetadata: runtime.metadata, async release() { if (!released) { released = true; await repositoryLock!.release(); await taskLock.release(); } } };
  } catch (error) { await repositoryLock?.release().catch(() => undefined); await taskLock.release().catch(() => undefined); throw error; }
}

async function resolveCheckCwd(workspacePath: string, relativePath: string, checkId: string): Promise<string> {
  if (path.isAbsolute(relativePath) || relativePath.includes("\0")) throw new Error(`Baseline check cwd must be relative: ${checkId}`);
  const resolved = await realpath(path.resolve(workspacePath, relativePath)).catch(() => { throw new Error(`Baseline check cwd must exist within worktree: ${checkId}`); });
  const relative = path.relative(workspacePath, resolved);
  if (relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error(`Baseline check cwd escapes worktree: ${checkId}`);
  return resolved;
}
