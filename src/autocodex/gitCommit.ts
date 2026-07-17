import path from "node:path";
import { atomicWriteJson } from "./persistence.js";
import { git } from "./git.js";
import { validateChanges, type ChangeValidationInput, type ChangeValidationReport } from "./changeValidation.js";

export type V2Commit = { schemaVersion: 2; taskId: string; stepId: string; attemptId: string; runId: string; parentSha: string; resultSha: string; branch: string; changedFiles: string[]; message: string; committedAt: string };
export type GitCommitInput = ChangeValidationInput & { validation?: ChangeValidationReport; /** The model's Coding result; BLOCKED is never committable. */ codingStatus?: "COMPLETED" | "BLOCKED"; message?: string; authorName?: string; authorEmail?: string };

/** Validates first, then and only then stages the complete verified change set and commits it. */
export async function commitValidatedChanges(input: GitCommitInput): Promise<V2Commit> {
  if (input.codingStatus === "BLOCKED") throw new Error("Refusing commit: Coding is BLOCKED.");
  // Re-read the repository even if a caller retained an earlier report: that report
  // is evidence, not permission to stage a subsequently changed worktree.
  const validation = await validateChanges(input);
  if (input.validation?.status === "FAIL") throw new Error("Refusing commit: supplied change validation failed.");
  if (validation.status !== "PASS") throw new Error(`Refusing commit: change validation ${validation.status}.`);
  const parentSha = (await git(input.workspacePath, ["rev-parse", "HEAD"])).trim();
  if (parentSha !== input.attemptBaseCommit) throw new Error("Refusing commit: HEAD changed after validation.");
  await git(input.workspacePath, ["add", "--all"]);
  const message = input.message?.trim() || `catos: ${input.taskId}/${input.stepId} (${input.attemptId})`;
  const env = { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_EDITOR: "true" };
  await git(input.workspacePath, ["-c", `user.name=${input.authorName ?? "CatOS"}`, "-c", `user.email=${input.authorEmail ?? "catos@local.invalid"}`, "commit", "--no-verify", "-m", message], { env });
  const resultSha = (await git(input.workspacePath, ["rev-parse", "HEAD"])).trim();
  const dirty = await git(input.workspacePath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]);
  if (dirty) throw new Error("Commit was created but the workspace is not clean.");
  const result: V2Commit = { schemaVersion: 2, taskId: input.taskId, stepId: input.stepId, attemptId: input.attemptId, runId: input.runId, parentSha, resultSha, branch: (await git(input.workspacePath, ["branch", "--show-current"])).trim(), changedFiles: validation.changedFiles.map((entry) => entry.path), message, committedAt: new Date().toISOString() };
  await atomicWriteJson(path.join(input.artifactDir, "commit.json"), result);
  return result;
}
export const gitCommit = commitValidatedChanges;
