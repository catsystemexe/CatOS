import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { createSession, appendTimelineEvent } from "../src/runs/sessionModel.js";
import { resolveGitContext, sanitizeRemoteUrl, writePrHandoff, assertWorkspaceBranch } from "../src/gitSession.js";

const execFileAsync = promisify(execFile);
async function git(cwd:string,args:string[]) { const {stdout}=await execFileAsync("git",args,{cwd,encoding:"utf8"}); return stdout.trimEnd(); }
async function repo() { const dir=await mkdtemp(path.join(os.tmpdir(),"catos-git-session-")); await git(dir,["init","-b","main"]); await git(dir,["config","user.email","a@b.test"]); await git(dir,["config","user.name","A"]); await writeFile(path.join(dir,"README.md"),"one\n"); await git(dir,["add","."]); await git(dir,["commit","-m","one"]); return dir; }

describe("git session workflow", () => {
  it("resolves exact base commit, defaults PR direction, redacts remote credentials, and writes pre/post commit handoffs", async () => {
    const r=await repo(); await git(r,["remote","add","origin","https://user:token@github.com/org/repo.git"]);
    const baseCommit=await git(r,["rev-parse","main^{commit}"]); const root=await mkdtemp(path.join(os.tmpdir(),"catos-run-")); const ws=path.join(root,"ws");
    const ctx=await resolveGitContext({projectId:"demo",repositoryPath:r,baseBranch:"main",prTargetBranch:"main",runBranch:"catos/run",workspacePath:ws,remoteName:"origin"});
    expect(ctx.baseCommit).toBe(baseCommit); expect(ctx.remoteUrl).toBe("https://github.com/org/repo.git");
    await git(r,["worktree","add","-b",ctx.runBranch,ws,ctx.baseCommit]);
    await createSession({runDir:root,runId:"run",goal:"g",branch:ctx.runBranch,workspacePath:ws,git:ctx});
    const before=await writePrHandoff(root, new Date("2026-01-01T00:00:00Z"));
    expect(before.handoff.pushStatus).toBe("not-committed"); expect(before.handoff.prDirection).toEqual({head:"catos/run",base:"main"});
    await writeFile(path.join(ws,"README.md"),"two\n"); await git(ws,["add","."]); await git(ws,["commit","-m","two"]); const head=await git(ws,["rev-parse","HEAD"]);
    await writeFile(path.join(root,"commit-result.json"), JSON.stringify({schemaVersion:1,runId:"run",workspacePath:ws,branch:ctx.runBranch,commitSha:head,commitMessage:"two",committedAt:"2026-01-01T00:00:00.000Z",changedFiles:["README.md"],parentCommitSha:baseCommit,approvedEvidence:{diffSha256:"x",validationReportSha256:"y",reviewReportSha256:"z"}},null,2));
    const after=await writePrHandoff(root, new Date("2026-01-01T00:00:00Z"));
    expect(after.handoff.pushStatus).toBe("ready"); expect(after.handoff.pushCommand).toContain(`push -u "origin" "catos/run"`);
    const md=await readFile(after.markdownPath,"utf8"); expect(md).toContain("catos/run → main"); expect(md).not.toContain("token");
  });

  it("rejects continuation on a wrong workspace branch and handles missing remote", async () => {
    const r=await repo(); const root=await mkdtemp(path.join(os.tmpdir(),"catos-run-")); const ws=path.join(root,"ws");
    const ctx=await resolveGitContext({projectId:"demo",repositoryPath:r,baseBranch:"main",prTargetBranch:"main",runBranch:"catos/run2",workspacePath:ws,remoteName:"missing"});
    expect(ctx.remoteUrl).toBeUndefined(); await git(r,["worktree","add","-b",ctx.runBranch,ws,ctx.baseCommit]); await createSession({runDir:root,runId:"run",goal:"g",branch:ctx.runBranch,workspacePath:ws,git:ctx});
    await git(ws,["switch","-c","other-branch"]); await expect(assertWorkspaceBranch(root)).rejects.toThrow(/Session expects branch catos\/run2, but workspace is on branch other-branch/);
  });

  it("sanitizes credential-bearing URLs", () => { expect(sanitizeRemoteUrl("https://u:p@github.com/o/r.git")).toBe("https://github.com/o/r.git"); });

  it("keeps git timeline append-only events", async () => { const root=await mkdtemp(path.join(os.tmpdir(),"catos-timeline-")); await appendTimelineEvent(root,{type:"git.base_resolved",sessionId:"s",metadata:{baseBranch:"main",baseCommit:"a",runBranch:"catos/s",prTargetBranch:"main"}}); await appendTimelineEvent(root,{type:"git.run_branch_created",sessionId:"s",metadata:{baseBranch:"main",baseCommit:"a",runBranch:"catos/s",prTargetBranch:"main"}}); const lines=(await readFile(path.join(root,"timeline.jsonl"),"utf8")).trim().split("\n"); expect(lines).toHaveLength(2); });
});
