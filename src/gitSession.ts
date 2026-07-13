import { execFile } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";
import { loadSession, readJson, appendTimelineEvent, type SessionGitContext } from "./runs/sessionModel.js";
import type { CommitResult } from "./commitWorker.js";

const execFileAsync = promisify(execFile);
async function git(cwd: string, args: string[]): Promise<string> { const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8", maxBuffer: 20*1024*1024 }); return stdout.trimEnd(); }
export function sanitizeRemoteUrl(url: string): string { return url.replace(/^(https?:\/\/)([^/@\s]+)@/i, "$1"); }
export function shellQuote(v: string): string { return `"${v.replace(/(["\\$`])/g, "\\$1")}"`; }

export async function resolveGitContext(input: { projectId:string; repositoryPath:string; baseBranch:string; prTargetBranch:string; runBranch:string; workspacePath:string; remoteName?:string }): Promise<SessionGitContext> {
  await git(input.repositoryPath, ["rev-parse", "--is-inside-work-tree"]).catch(() => { throw new Error(`Target repository is not a Git repository: ${input.repositoryPath}`); });
  await git(input.repositoryPath, ["rev-parse", "--verify", `${input.baseBranch}^{commit}`]).catch(() => { throw new Error(`Base branch does not exist or is not a commit: ${input.baseBranch}`); });
  await git(input.repositoryPath, ["rev-parse", "--verify", `${input.prTargetBranch}^{commit}`]).catch(() => { throw new Error(`PR target branch does not exist or is not a commit: ${input.prTargetBranch}`); });
  const baseCommit = await git(input.repositoryPath, ["rev-parse", `${input.baseBranch}^{commit}`]);
  const remoteName = input.remoteName ?? "origin";
  const remoteRaw = await git(input.repositoryPath, ["remote", "get-url", remoteName]).catch(() => "");
  return { projectId: input.projectId, repositoryPath: path.resolve(input.repositoryPath), remoteName, remoteUrl: remoteRaw ? sanitizeRemoteUrl(remoteRaw) : undefined, baseBranch: input.baseBranch, baseCommit, runBranch: input.runBranch, prTargetBranch: input.prTargetBranch, workspacePath: input.workspacePath };
}

export async function createWorktreeFromBase(ctx: SessionGitContext): Promise<void> {
  await git(ctx.repositoryPath, ["worktree", "add", "-b", ctx.runBranch, ctx.workspacePath, ctx.baseCommit]);
}
export async function currentBranch(workspacePath: string): Promise<string> { const b = await git(workspacePath, ["branch", "--show-current"]); if (!b) throw new Error("Workspace is in detached HEAD."); return b; }
export async function assertWorkspaceBranch(runDir: string): Promise<SessionGitContext> { const session = await loadSession(runDir); if (!session.git) throw new Error("Session is missing git context (missing-git-context)."); const actual = await currentBranch(session.git.workspacePath); if (actual !== session.git.runBranch) throw new Error(`Session expects branch ${session.git.runBranch}, but workspace is on branch ${actual}.`); return session.git; }

export type PrHandoff = { schemaVersion:1; generatedAt:string; sessionId:string; projectId:string; repositoryPath:string; workspacePath:string; remoteName:string; remoteUrl?:string; baseBranch:string; baseCommit:string; runBranch:string; headCommit?:string; prTargetBranch:string; validationStatus?:string; reviewVerdict?:string; committed:boolean; pushStatus:"ready"|"remote-missing"|"not-committed"|"blocked"; pushCommand?:string; prDirection:{head:string;base:string}; manualSteps:string[]; blockingReasons:string[] };
export type SessionGitStatus = PrHandoff;
async function readOptionalJson<T>(file:string): Promise<T|undefined> { return readFile(file,"utf8").then(s=>JSON.parse(s) as T,()=>undefined); }
export async function buildPrHandoff(runDir:string, now=new Date()): Promise<PrHandoff> {
  const session = await loadSession(runDir); if (!session.git) throw new Error("Session is missing git context (missing-git-context).");
  const ctx = session.git; let blockingReasons:string[]=[]; let headCommit:string|undefined; let committed=false;
  const commit = await readOptionalJson<CommitResult>(path.join(runDir,"commit-result.json"));
  if (commit) { committed=true; headCommit=commit.commitSha; }
  else headCommit = await git(ctx.workspacePath,["rev-parse","HEAD"]).catch(()=>undefined);
  const branch = await currentBranch(ctx.workspacePath).catch(e=>{ blockingReasons.push(String(e instanceof Error?e.message:e)); return undefined; });
  if (branch && branch !== ctx.runBranch) blockingReasons.push(`Session expects branch ${ctx.runBranch}, but workspace is on branch ${branch}.`);
  const validation = await readOptionalJson<{status?:string}>(path.join(runDir,"validation-report.json"));
  const review = await readOptionalJson<{verdict?:string}>(path.join(runDir,"review-report.json"));
  let pushStatus:PrHandoff["pushStatus"] = !committed ? "not-committed" : !ctx.remoteUrl ? "remote-missing" : blockingReasons.length ? "blocked" : "ready";
  const pushCommand = pushStatus === "ready" ? `git -C ${shellQuote(ctx.workspacePath)} push -u ${shellQuote(ctx.remoteName)} ${shellQuote(ctx.runBranch)}` : undefined;
  return { schemaVersion:1, generatedAt:now.toISOString(), sessionId:session.sessionId, projectId:ctx.projectId, repositoryPath:ctx.repositoryPath, workspacePath:ctx.workspacePath, remoteName:ctx.remoteName, remoteUrl:ctx.remoteUrl, baseBranch:ctx.baseBranch, baseCommit:ctx.baseCommit, runBranch:ctx.runBranch, headCommit, prTargetBranch:ctx.prTargetBranch, validationStatus:validation?.status, reviewVerdict:review?.verdict, committed, pushStatus, pushCommand, prDirection:{head:ctx.runBranch, base:ctx.prTargetBranch}, manualSteps:["Review pr-handoff.md.", ...(pushCommand?[`Run: ${pushCommand}`]:["Configure a remote before pushing."]), `Open a pull request from ${ctx.runBranch} to ${ctx.prTargetBranch}.`, "Merge manually after review."], blockingReasons };
}
export async function writePrHandoff(runDir:string, now=new Date()): Promise<{jsonPath:string; markdownPath:string; handoff:PrHandoff}> { const handoff=await buildPrHandoff(runDir,now); const dir=path.join(runDir,"handoff"); await mkdir(dir,{recursive:true}); const jsonPath=path.join(dir,"pr-handoff.json"); const markdownPath=path.join(dir,"pr-handoff.md"); await writeFile(jsonPath, JSON.stringify(handoff,null,2)+"\n"); await writeFile(markdownPath, renderPrHandoffMarkdown(handoff)+"\n"); await appendTimelineEvent(runDir,{type:"pr_handoff.generated",sessionId:handoff.sessionId,metadata:{baseBranch:handoff.baseBranch,baseCommit:handoff.baseCommit,runBranch:handoff.runBranch,prTargetBranch:handoff.prTargetBranch,headCommit:handoff.headCommit,pushStatus:handoff.pushStatus}}); return {jsonPath,markdownPath,handoff}; }
export async function getPrHandoff(runDir:string): Promise<PrHandoff> { return readJson<PrHandoff>(path.join(runDir,"handoff","pr-handoff.json")); }
export async function getSessionGitStatus(runDir:string): Promise<SessionGitStatus> { return buildPrHandoff(runDir); }
export function renderPrHandoffMarkdown(h:PrHandoff): string { return [`# AutoCodex PR Handoff`,"",`- Project: ${h.projectId}`,`- Repository: ${h.repositoryPath}`,`- Workspace: ${h.workspacePath}`,`- Base branch: ${h.baseBranch}`,`- Base commit: ${h.baseCommit}`,`- Run branch: ${h.runBranch}`,`- Head commit: ${h.headCommit ?? "not recorded"}`,`- PR target: ${h.prTargetBranch}`,`- Remote: ${h.remoteUrl ? `${h.remoteName} ${h.remoteUrl}` : `${h.remoteName} (missing)`}`,`- Push status: ${h.pushStatus}`,`- PR direction: ${h.prDirection.head} → ${h.prDirection.base}`,"","## Manual steps",...h.manualSteps.map(s=>`- ${s}`),"","## Blocking reasons",...(h.blockingReasons.length?h.blockingReasons.map(r=>`- ${r}`):["- none"]),""].join("\n"); }
