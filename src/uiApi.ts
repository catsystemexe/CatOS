import { readdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcess } from "node:child_process";
import { parse } from "yaml";
import { ZodError } from "zod";
import { loadProjectConfig } from "./config/loadConfig.js";
import { loadRepositoryRoots, discoverRepositories, listRepositoryBranches, validateManualRepository } from "./repositoryDiscovery.js";
import { cloneGithubRepository, githubRepos, mergeRepositories, type ExecLike, type FetchLike, type GithubRepo, type GithubStatus } from "./githubRepositories.js";
import { projectConfigSchema } from "./config/projectConfigSchema.js";
import { buildUiSystemState, buildUiTimeline, getUiRunStatus } from "./uiViewModel.js";
import { writeSessionReport } from "./finalExport.js";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileAsync = promisify(execFile);
const active = new Map<string, ChildProcess>();
export type UiContext = { cwd?: string; runsDir?: string; env?: NodeJS.ProcessEnv; githubProvider?: () => Promise<{ repositories: GithubRepo[]; github: GithubStatus }>; githubExec?: ExecLike; githubFetch?: FetchLike };
export type UiProjectSummary = {
  id: string;
  projectId: string;
  name: string;
  configPath: string;
  repository?: string;
  repositoryPath?: string;
  baseBranch?: string;
  prTarget?: string;
  prTargetBranch?: string;
  sandbox?: string;
  status: "ready" | "unavailable" | "invalid";
  blockingReason?: string;
};
const cwdOf = (c?: UiContext) => c?.cwd ?? process.cwd(); const runsOf = (c?: UiContext) => c?.runsDir ?? path.join(cwdOf(c), "runs");
async function exists(p:string){try{await stat(p);return true;}catch{return false;}}
async function isGitRepo(repo:string){ try{ const { stdout } = await execFileAsync("git",["-C",repo,"rev-parse","--is-inside-work-tree"]); return stdout.trim()==="true";}catch{return false;} }
async function branchExists(repo:string, branch:string){ try{ await execFileAsync("git",["-C",repo,"rev-parse","--verify",`${branch}^{commit}`]); return true;}catch{return false;} }
function fallbackId(file:string){ return path.basename(file,path.extname(file)); }
function partialProject(parsed:unknown){ return parsed && typeof parsed === "object" && "project" in parsed && parsed.project && typeof parsed.project === "object" ? parsed.project as Record<string, unknown> : {}; }
function invalidSummary(file:string, reason="invalid project config", parsed?:unknown): UiProjectSummary { const partial=partialProject(parsed); const id=typeof partial.id==="string" && partial.id ? partial.id : fallbackId(file); return { id, projectId:id, name: typeof partial.name==="string" && partial.name ? partial.name : id, configPath:`projects/${file}`, repository: typeof partial.repoPath==="string" ? partial.repoPath : undefined, repositoryPath: typeof partial.repoPath==="string" ? partial.repoPath : undefined, baseBranch: typeof partial.baseBranch==="string" ? partial.baseBranch : undefined, status:"invalid", blockingReason:reason }; }
export async function listProjects(ctx: UiContext = {}): Promise<UiProjectSummary[]> { const dir=path.join(cwdOf(ctx),"projects"); const files=(await readdir(dir).catch(()=>[])).filter(f=>f.endsWith(".yaml")||f.endsWith(".yml")).sort(); return Promise.all(files.map(async f=>{ let raw=""; let parsed:unknown; try{ raw=await readFile(path.join(dir,f),"utf8"); parsed=parse(raw); }catch{ return invalidSummary(f,"invalid project config"); } try{ const config=projectConfigSchema.parse(parsed); const id=config.project.id; const absoluteRepoPath=path.resolve(path.join(dir),config.project.repoPath); const baseBranch=config.project.baseBranch; const prTarget=config.git.prTargetBranch ?? baseBranch ?? ""; const summary: UiProjectSummary={ id, projectId:id, name:config.project.name, configPath:`projects/${f}`, repository:absoluteRepoPath, repositoryPath:absoluteRepoPath, baseBranch, prTarget, prTargetBranch:prTarget, sandbox:config.codex.sandboxMode, status:"ready" };
      if(!(await exists(absoluteRepoPath))) return { ...summary, status:"unavailable", blockingReason:"repository missing" };
      if(!(await isGitRepo(absoluteRepoPath))) return { ...summary, status:"unavailable", blockingReason:"not a Git repository" };
      if(baseBranch && !(await branchExists(absoluteRepoPath,baseBranch))) return { ...summary, status:"unavailable", blockingReason:`base branch not found: ${baseBranch}` };
      return summary;
    }catch(error){ if(error instanceof ZodError) return invalidSummary(f,"invalid project config",parsed); return invalidSummary(f,"invalid project config",parsed); } })); }

export type UiStartRunInput = { repositoryPath: string; baseBranch: string; prTargetBranch: string; task: string };
export async function listRepositories(ctx:UiContext={}){ const local=await discoverRepositories(await loadRepositoryRoots(cwdOf(ctx)), cwdOf(ctx)); const noGithubExec:ExecLike=async()=>{throw new Error("GitHub CLI disabled by explicit UI context env.");}; const gh=ctx.githubProvider ? await ctx.githubProvider() : await githubRepos(ctx.githubExec ?? (ctx.env ? noGithubExec : undefined), ctx.env ?? process.env, ctx.githubFetch); return {repositories: await mergeRepositories(local,gh.repositories), github: gh.github}; }
export async function cloneRepository(repositoryId:string, ctx:UiContext={}){ const listed=await listRepositories(ctx); const repository=await cloneGithubRepository(repositoryId,listed.repositories,undefined,ctx.env ?? process.env); return {repository}; }
export async function loadManualRepository(repositoryPath:string){ return {repository: await validateManualRepository(repositoryPath), branches: await listRepositoryBranches(repositoryPath)}; }
export async function listBranches(repositoryPath:string){ return {branches: await listRepositoryBranches(repositoryPath)}; }
export async function getProjectConfig(projectId:string, ctx:UiContext={}) { return (await listProjects(ctx)).find(p=>p.id===projectId); }
export async function startRun(input:{projectId?:string; task:string; baseBranch:string; prTarget?:string; prTargetBranch?:string; repositoryPath?:string}, ctx:UiContext={}) { if(!input.task?.trim()) throw new Error("Task is required."); let repo=input.repositoryPath; let projectId=input.projectId; if(!repo){ if(!projectId) throw new Error("Repository not found."); const p=await getProjectConfig(projectId,ctx); if(!p) throw new Error("Unknown project"); if(p.status!=="ready") throw new Error(p.blockingReason || "Project is not ready"); const loaded=await loadProjectConfig(p.configPath, cwdOf(ctx)); repo=loaded.absoluteRepoPath; } repo=(await validateManualRepository(repo)).path; const prTarget=input.prTargetBranch ?? input.prTarget ?? input.baseBranch; if(!input.baseBranch || !(await branchExists(repo,input.baseBranch))) throw new Error("Base branch not found."); if(!prTarget || !(await branchExists(repo,prTarget))) throw new Error("PR target branch not found."); const args=["src/index.ts","run","--repo",repo,"--task",input.task,"--base-branch",input.baseBranch,"--pr-target",prTarget]; const child=spawn("npx",["tsx",...args],{cwd:cwdOf(ctx),stdio:"ignore",env:{...process.env}}); const started=Date.now(); let runId=""; const poll=async()=>{ const dirs=(await readdir(runsOf(ctx),{withFileTypes:true}).catch(()=>[])).filter(d=>d.isDirectory()).map(d=>d.name).sort().reverse(); for(const d of dirs){ const f=path.join(runsOf(ctx),d,"input.json"); try{ const j=JSON.parse(await readFile(f,"utf8")); if((j.repositoryPath===repo || j.goal===input.task) && Date.parse(j.createdAt)>=started-5000) return d;}catch{} } return "";}; for(let i=0;i<20 && !runId;i++){ await new Promise(r=>setTimeout(r,100)); runId=await poll(); } if(runId) active.set(runId, child); child.on("exit", async()=>{ if(runId){ active.delete(runId); await writeSessionReport(path.join(runsOf(ctx),runId)).catch(()=>undefined); }}); return { runId, status:"running" }; }
export async function getRunStatus(runId:string, ctx:UiContext={}) { const runDir=path.join(runsOf(ctx),runId); return { runId, status: await getUiRunStatus(runDir), system: await buildUiSystemState(runDir) }; }
export async function getRunTimeline(runId:string, ctx:UiContext={}) { return buildUiTimeline(path.join(runsOf(ctx),runId)); }
export async function readRunOutput(runId:string, requested:string, ctx:UiContext={}) { const root=path.resolve(runsOf(ctx),runId); const target=path.resolve(root,requested); if(!target.startsWith(root+path.sep) && target!==root) throw new Error("Path traversal rejected"); const ext=path.extname(target); if(![".md",".txt",".json",".diff",".log"].includes(ext)) throw new Error("Unsupported output type"); let content=await readFile(target,"utf8"); if(ext===".json") content=JSON.stringify(JSON.parse(content),null,2); if(content.length>200_000) content=content.slice(0,200_000)+"\n[truncated]"; return { path: path.relative(root,target), content }; }
export async function getFinalExport(runId:string, ctx:UiContext={}) { const runDir=path.join(runsOf(ctx),runId); const file=await writeSessionReport(runDir); return { path:path.basename(file) }; }
export async function stopRun(runId:string, ctx:UiContext={}) { const child=active.get(runId); if(!child) return { supported:false, status: await getUiRunStatus(path.join(runsOf(ctx),runId)) }; child.kill("SIGTERM"); const runDir=path.join(runsOf(ctx),runId); await writeFile(path.join(runDir,".ui-stopped"), new Date().toISOString(), "utf8").catch(()=>undefined); await writeSessionReport(runDir).catch(()=>undefined); return { supported:true, status:"stopped" }; }
export async function recordHumanDecision(){ throw new Error("Human Review decisions are read-only in MVP UI; use CLI Human Gate commands."); }
