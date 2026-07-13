import { test, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import os from "node:os";
import { execFileSync } from "node:child_process";
import { getFinalExport, getRunStatus, getRunTimeline, listProjects, readRunOutput, startRun, stopRun } from "../src/uiApi.js";

async function root(){ const cwd=await mkdtemp(path.join(os.tmpdir(),"catos-api-")); await mkdir(path.join(cwd,"projects"),{recursive:true}); return cwd; }
function git(repo:string, args:string[]){ execFileSync("git",args,{cwd:repo,stdio:"ignore"}); }
async function makeRepo(cwd:string, name="repo", branch="main"){ const repo=path.join(cwd,name); await mkdir(repo); git(repo,["init","-b",branch]); git(repo,["config","user.email","a@b.c"]); git(repo,["config","user.name","A"]); await writeFile(path.join(repo,"README.md"),"x"); git(repo,["add","."]); git(repo,["commit","-m","init"]); return repo; }
async function config(cwd:string, id:string, repoPath:string, baseBranch="main"){ await writeFile(path.join(cwd,`projects/${id}.yaml`),`project:\n  id: ${id}\n  name: ${id} project\n  repoPath: ${repoPath}\n  baseBranch: ${baseBranch}\ncommands:\n  typecheck: npm run typecheck\n  test: npm test\n  build: npm run build\nworkflow:\n  maxReworkAttempts: 0\n  createCommit: false\npermissions:\n  allowNetwork: false\n  allowPush: false\n  allowMerge: false\n`); }

test("config exists but repository is missing is listed as unavailable", async()=>{ const cwd=await root(); await config(cwd,"demo","/tmp/does-not-exist-catos-test"); const [project]=await listProjects({cwd}); expect(project).toMatchObject({id:"demo",status:"unavailable",blockingReason:"repository missing",repositoryPath:"/tmp/does-not-exist-catos-test"}); });

test("valid config is ready", async()=>{ const cwd=await root(); const repo=await makeRepo(cwd); await config(cwd,"demo",repo); const [project]=await listProjects({cwd}); expect(project).toMatchObject({id:"demo",status:"ready",repositoryPath:repo,baseBranch:"main"}); });

test("non-Git directory is unavailable", async()=>{ const cwd=await root(); const repo=path.join(cwd,"notgit"); await mkdir(repo); await config(cwd,"demo",repo); const [project]=await listProjects({cwd}); expect(project).toMatchObject({status:"unavailable",blockingReason:"not a Git repository"}); });

test("missing base branch is unavailable", async()=>{ const cwd=await root(); const repo=await makeRepo(cwd,"repo","main"); await config(cwd,"demo",repo,"missing"); const [project]=await listProjects({cwd}); expect(project).toMatchObject({status:"unavailable",blockingReason:"base branch not found: missing"}); });

test("invalid YAML/schema is invalid when id can be identified", async()=>{ const cwd=await root(); await writeFile(path.join(cwd,"projects/demo.yaml"),"project:\n  id: demo\n  name: Demo\n"); const [project]=await listProjects({cwd}); expect(project).toMatchObject({id:"demo",status:"invalid",blockingReason:"invalid project config"}); });

test("one invalid project does not block a valid project", async()=>{ const cwd=await root(); const repo=await makeRepo(cwd); await config(cwd,"ready",repo); await writeFile(path.join(cwd,"projects/bad.yaml"),"project: ["); const projects=await listProjects({cwd}); expect(projects).toHaveLength(2); expect(projects.find(p=>p.id==="ready")?.status).toBe("ready"); expect(projects.find(p=>p.id==="bad")?.status).toBe("invalid"); });

test("start run refuses unavailable projects", async()=>{ const cwd=await root(); await config(cwd,"demo","/tmp/does-not-exist-catos-test"); await expect(startRun({projectId:"demo",task:"x",baseBranch:"main",prTarget:"main"},{cwd,runsDir:path.join(cwd,"runs")})).rejects.toThrow("repository missing"); });

test("refresh-style relisting changes unavailable to ready after repository appears", async()=>{ const cwd=await root(); const repo=path.join(cwd,"repo"); await config(cwd,"demo",repo); expect((await listProjects({cwd}))[0]).toMatchObject({status:"unavailable",blockingReason:"repository missing"}); await makeRepo(cwd,"repo"); expect((await listProjects({cwd}))[0]).toMatchObject({status:"ready"}); });


test("run status, timeline, safe output, final export and unsupported stop", async()=>{ const cwd=await root(); const runsDir=path.join(cwd,"runs"); const rd=path.join(runsDir,"r1"); await mkdir(rd,{recursive:true}); await writeFile(path.join(rd,"input.json"),JSON.stringify({runId:"r1",projectId:"demo",goal:"task",createdAt:new Date().toISOString()})); await writeFile(path.join(rd,"note.md"),"hello"); const ctx={cwd,runsDir}; expect((await getRunStatus("r1",ctx)).status).toBe("idle"); expect(await getRunTimeline("r1",ctx)).toEqual([]); expect((await readRunOutput("r1","note.md",ctx)).content).toBe("hello"); await expect(readRunOutput("r1","../x.md",ctx)).rejects.toThrow(/Path traversal/); expect((await getFinalExport("r1",ctx)).path).toBe("AUTOCODEX_SESSION_REPORT.md"); expect((await stopRun("r1",ctx)).supported).toBe(false); });
