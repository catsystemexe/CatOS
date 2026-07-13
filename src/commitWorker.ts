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
function normPath(p: string): string { return p.replace(/\\/g, "/").replace(/^\.\//, ""); }
function sortUnique(xs: string[]): string[] { return [...new Set(xs.map(normPath).filter(Boolean))].sort(); }
function nameOnlyFiles(out: string): string[] { return sortUnique(out.split("\n")); }
function sameFiles(a: string[], b: string[]): boolean { return JSON.stringify(sortUnique(a)) === JSON.stringify(sortUnique(b)); }
function defaultMessage(input: CommitInput): string { return `catos: apply approved changes for ${input.runId}`; }
async function ensureFile(filePath: string, label: string): Promise<void> { const s = await stat(filePath).catch(() => undefined); if (!s?.isFile()) throw new Error(`Missing ${label}: ${filePath}`); }

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
    const stagedDiff = await git(workspace, ["diff", "--cached", "--binary", "HEAD"]);
    const stagedFiles = nameOnlyFiles(await git(workspace, ["diff", "--cached", "--name-only"]));
    if (sha256Text(stagedDiff) !== sha256Text(approvedDiff) || !sameFiles(stagedFiles, input.finalResult.finalChangedFiles)) { await git(workspace, ["reset"]); throw new Error("Staged diff does not match approved diff; reset completed."); }
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
