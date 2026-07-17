import { access, lstat, mkdir, realpath } from "node:fs/promises";
import path from "node:path";
import { guardCodexWorkspace } from "../codingWorker.js";

export type GitCommand = (args: string[], cwd: string) => Promise<{ stdout: string; stderr?: string }>;
const inside = (parent: string, child: string) => { const relative = path.relative(parent, child); return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative); };

/** Creates a detached, external worktree; no moving branch name is accepted. */
export async function createExternalWorktree(input: { repositoryPath: string; workspaceRoot: string; runId: string; baseCommitSha: string; git: GitCommand; catosRoot?: string }): Promise<{ workspacePath: string; baseCommitSha: string }> {
  if (!/^[a-f0-9]{40}$/i.test(input.baseCommitSha)) throw new Error("Worktree base must be an immutable SHA.");
  const repositoryPath = await realpath(input.repositoryPath);
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const workspacePath = path.resolve(workspaceRoot, input.runId, "workspace");
  if (!inside(workspaceRoot, workspacePath) || inside(repositoryPath, workspacePath)) throw new Error("Worktree path must be external to the source repository.");
  await access(repositoryPath); await mkdir(path.dirname(workspacePath), { recursive: true });
  await lstat(workspacePath).then(() => { throw new Error("Worktree path already exists."); }, error => { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; });
  await input.git(["cat-file", "-e", `${input.baseCommitSha}^{commit}`], repositoryPath);
  await input.git(["worktree", "add", "--detach", workspacePath, input.baseCommitSha], repositoryPath);
  const guarded = await guardCodexWorkspace({ workspacePath, workspaceRoot, repositoryPath, catosRoot: input.catosRoot });
  if (inside(repositoryPath, guarded.workspacePath)) throw new Error("Resolved worktree path must be external to the source repository.");
  const head = (await input.git(["rev-parse", "HEAD"], guarded.workspacePath)).stdout.trim();
  if (head.toLowerCase() !== input.baseCommitSha.toLowerCase()) throw new Error("Worktree HEAD does not match immutable base SHA.");
  const status = (await input.git(["status", "--porcelain=v1", "--untracked-files=all"], guarded.workspacePath)).stdout;
  if (status.trim()) throw new Error("New worktree is not clean.");
  return { workspacePath: guarded.workspacePath, baseCommitSha: head };
}
