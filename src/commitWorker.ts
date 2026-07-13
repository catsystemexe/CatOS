import { execFile } from "node:child_process";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { z } from "zod";
import type { ProjectConfig } from "./config/projectConfigSchema.js";
import { sha256File, sha256Text, type ApprovedEvidence } from "./hashArtifacts.js";
import { resolveRunArtifact } from "./humanGate.js";
import { collectWorkspaceGitState } from "./gitWorkspaceState.js";
import type { FinalResult } from "./schemas/finalResult.js";
import type { HumanDecision } from "./schemas/humanDecision.js";
import type { TaskBrief } from "./schemas/taskBrief.js";

const execFileAsync = promisify(execFile);

export type CommitInput = { runId: string; runDir: string; finalResult: FinalResult; humanDecision: HumanDecision; taskBrief: TaskBrief; config?: ProjectConfig; message?: string };

export const commitResultSchema = z.object({
  schemaVersion: z.literal(1), runId: z.string(), workspacePath: z.string(), branch: z.string(), commitSha: z.string(), commitMessage: z.string(), committedAt: z.string().datetime(), changedFiles: z.array(z.string()), parentCommitSha: z.string(), approvedEvidence: z.object({ diffSha256: z.string(), validationReportSha256: z.string(), reviewReportSha256: z.string() }),
});

export type CommitResult = z.infer<typeof commitResultSchema>;
export interface CommitWorker { commit(input: CommitInput): Promise<CommitResult>; }

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
  return stdout.trimEnd();
}
async function gitBuffer(cwd: string, args: string[]): Promise<Buffer> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "buffer", maxBuffer: 50 * 1024 * 1024 });
  return stdout as Buffer;
}
async function gitExitCode(cwd: string, args: string[]): Promise<number> {
  try {
    await execFileAsync("git", args, { cwd, encoding: "buffer", maxBuffer: 50 * 1024 * 1024 });
    return 0;
  } catch (error) {
    const maybeError = error as { code?: number | string };
    return typeof maybeError.code === "number" ? maybeError.code : Number(maybeError.code ?? 1);
  }
}
function normPath(p: string): string { return p.replace(/\\/g, "/").replace(/^\.\//, ""); }
function sortUnique(xs: string[]): string[] { return [...new Set(xs.map(normPath).filter(Boolean))].sort(); }
function parseNulFields(out: Buffer): string[] { return out.toString("utf8").split("\0").filter(Boolean); }
function parseNameStatusZ(out: Buffer): Map<string, string> {
  const fields = parseNulFields(out);
  const result = new Map<string, string>();
  for (let index = 0; index < fields.length;) {
    const status = fields[index++]!;
    if (status.startsWith("R") || status.startsWith("C")) {
      index += 1;
      result.set(normPath(fields[index++] ?? ""), status[0]!);
    } else {
      result.set(normPath(fields[index++] ?? ""), status[0]!);
    }
  }
  return result;
}
function sameFiles(a: string[], b: string[]): boolean { return JSON.stringify(sortUnique(a)) === JSON.stringify(sortUnique(b)); }
function defaultMessage(input: CommitInput): string { return `catos: apply approved changes for ${input.runId}`; }
async function ensureFile(filePath: string, label: string): Promise<void> { const s = await stat(filePath).catch(() => undefined); if (!s?.isFile()) throw new Error(`Missing ${label}: ${filePath}`); }

export async function verifyStagedIndexMatchesWorkspace(workspace: string, approvedFiles: string[]): Promise<void> {
  const approved = sortUnique(approvedFiles);
  const stagedStatuses = parseNameStatusZ(await gitBuffer(workspace, ["diff", "--cached", "--name-status", "-z", "HEAD"]));
  const stagedFiles = sortUnique([...stagedStatuses.keys()]);

  if (!sameFiles(stagedFiles, approved)) throw new Error("Staged files do not match approved files.");
  if (await gitExitCode(workspace, ["diff", "--quiet"]) !== 0) throw new Error("Unstaged changes remain after staging.");
  if (parseNulFields(await gitBuffer(workspace, ["ls-files", "--others", "--exclude-standard", "-z"])).length > 0) throw new Error("Untracked files remain after staging.");

  for (const filePath of approved) {
    const status = stagedStatuses.get(filePath);
    if (!status) throw new Error(`Approved file is missing from staged index: ${filePath}`);

    if (status === "D") {
      const fileStat = await stat(path.join(workspace, filePath)).catch(() => undefined);
      if (fileStat) throw new Error(`Deleted file still exists in workspace: ${filePath}`);
      continue;
    }

    if (status !== "A" && status !== "M") throw new Error(`Unsupported staged status for approved file ${filePath}: ${status}`);
    const workspaceContent = await readFile(path.join(workspace, filePath));
    const stagedContent = await gitBuffer(workspace, ["show", `:${filePath}`]);
    if (!stagedContent.equals(workspaceContent)) throw new Error(`Staged content does not match workspace file: ${filePath}`);
  }
}

export class GitCommitWorker implements CommitWorker {
  async commit(input: CommitInput): Promise<CommitResult> {
    const resultPath = path.join(input.runDir, "commit-result.json");
    const existing = await readFile(resultPath, "utf8").then((r) => commitResultSchema.parse(JSON.parse(r) as unknown), () => undefined);
    if (existing) {
      await git(existing.workspacePath, ["cat-file", "-e", `${existing.commitSha}^{commit}`]).catch(() => { throw new Error(`commit-result.json exists but commit is missing from Git history: ${existing.commitSha}`); });
      return existing;
    }
    if (input.finalResult.runId !== input.runId || input.humanDecision.runId !== input.runId) throw new Error("Run id mismatch.");
    if (input.finalResult.status !== "ACCEPTED") throw new Error("Commit requires final-result.status ACCEPTED.");
    if (input.humanDecision.decision !== "APPROVE") throw new Error("Commit requires human decision APPROVE.");
    if (!input.humanDecision.approvedEvidence) throw new Error("APPROVE decision is missing approved evidence fingerprints; re-approve with the current Human Gate.");

    const workspace = input.finalResult.finalWorkspacePath;
    const diffPath = resolveRunArtifact(input.runDir, input.finalResult.finalDiffPath, "workspace.diff");
    const validationPath = resolveRunArtifact(input.runDir, input.finalResult.finalValidationReportPath, "validation-report.json");
    const reviewPath = resolveRunArtifact(input.runDir, input.finalResult.finalReviewReportPath, "review-report.json");
    await ensureFile(path.join(input.runDir, "input.json"), "input.json"); await ensureFile(path.join(input.runDir, "task-brief.json"), "task-brief.json"); await ensureFile(diffPath, "final diff"); await ensureFile(validationPath, "final validation report"); await ensureFile(reviewPath, "final review report");
    const evidence: ApprovedEvidence = { diffSha256: await sha256File(diffPath), validationReportSha256: await sha256File(validationPath), reviewReportSha256: await sha256File(reviewPath) };
    if (JSON.stringify(evidence) !== JSON.stringify(input.humanDecision.approvedEvidence)) throw new Error("Approved evidence fingerprints do not match current artifacts.");

    const top = path.resolve(await git(workspace, ["rev-parse", "--show-toplevel"]));
    if (top !== path.resolve(workspace)) throw new Error("Workspace is not the exact Git top-level.");
    const branch = await git(workspace, ["branch", "--show-current"]);
    if (!branch) throw new Error("Workspace is in detached HEAD.");
    if (!branch.startsWith("catos/")) throw new Error("Branch must start with catos/.");
    const workspaceState = await collectWorkspaceGitState(workspace);
    if (!workspaceState.status.trim()) throw new Error("No Git working tree changes to commit.");
    const changedFiles = workspaceState.changedFiles;
    if (!sameFiles(changedFiles, input.finalResult.finalChangedFiles)) throw new Error("Changed files do not match final-result.json.");
    const approvedDiff = await readFile(diffPath, "utf8");
    if (sha256Text(workspaceState.diff) !== sha256Text(approvedDiff)) throw new Error("Working diff changed after approval.");
    const parentCommitSha = await git(workspace, ["rev-parse", "HEAD"]);

    await git(workspace, ["add", "--all"]);
    try {
      await verifyStagedIndexMatchesWorkspace(workspace, input.finalResult.finalChangedFiles);
    } catch (error) {
      await git(workspace, ["reset"]);
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Staged index does not match approved workspace state; reset completed. ${message}`);
    }
    const name = input.config?.git?.commitName ?? process.env.CATOS_GIT_NAME ?? "CatOS";
    const email = input.config?.git?.commitEmail ?? process.env.CATOS_GIT_EMAIL ?? "catos@local.invalid";
    const commitMessage = input.message?.trim() || defaultMessage(input);
    await git(workspace, ["-c", `user.name=${name}`, "-c", `user.email=${email}`, "commit", "-m", commitMessage]);
    const commitSha = await git(workspace, ["rev-parse", "HEAD"]);
    const postStatus = await git(workspace, ["status", "--porcelain=v1"]);
    if (postStatus.trim()) throw new Error("Commit was created but working tree is not clean.");
    const result: CommitResult = { schemaVersion: 1, runId: input.runId, workspacePath: workspace, branch, commitSha, commitMessage, committedAt: new Date().toISOString(), changedFiles: sortUnique(input.finalResult.finalChangedFiles), parentCommitSha, approvedEvidence: evidence };
    await mkdir(input.runDir, { recursive: true });
    await writeFile(resultPath, `${JSON.stringify(result, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
    return result;
  }
}
