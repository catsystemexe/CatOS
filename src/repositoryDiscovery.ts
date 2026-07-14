import { readdir, realpath, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "yaml";
const execFileAsync=promisify(execFile);
export type RepositorySource="local"|"github";
export type RepositoryOption={id:string;source:RepositorySource;name:string;fullName?:string;localPath?:string;path?:string;cloneUrl?:string;defaultBranch?:string;currentBranch?:string;isPrivate?:boolean;isAvailableLocally:boolean};
export type RepositorySummary=RepositoryOption & {source:"local";path:string;localPath:string;isAvailableLocally:true};
export type BranchSummary={name:string;current:boolean};
const ignored=new Set(["node_modules",".git","runs","build","dist","coverage",".catos","workspaces","tmp","runtime"]);
const tempPrefixes=["catos-api-","catos-repo-","catos-git-","catos-git-session-","catos-validation-workspace-","catos-cli-","catos-rework-cli-","catos-run-","catos-fork-runtime-errors-"];
async function exists(p:string){try{await stat(p);return true;}catch{return false;}}
async function isWorkTree(p:string){try{return (await execFileAsync("git",["-C",p,"rev-parse","--is-inside-work-tree"],{timeout:5000})).stdout.trim()==="true";}catch{return false;}}
async function topLevel(p:string){try{return (await execFileAsync("git",["-C",p,"rev-parse","--show-toplevel"],{timeout:5000})).stdout.trim();}catch{return p;}}
function isTempRoot(p:string){return path.resolve(p)===path.resolve(process.env.TMPDIR||"/tmp") || path.basename(path.resolve(p))==="tmp";}
function isIgnoredTempName(name:string){return tempPrefixes.some(prefix=>name.startsWith(prefix));}
function titleName(name:string){return name.toLowerCase()==="catos"?"CatOS":name;}
async function remoteBasename(repo:string){try{const {stdout}=await execFileAsync("git",["-C",repo,"config","--get","remote.origin.url"],{timeout:5000}); const raw=stdout.trim(); if(!raw)return undefined; const last=raw.replace(/\/$/,"").split(/[/:]/).pop()?.replace(/\.git$/i,""); return last?titleName(last):undefined;}catch{return undefined;}}
async function repositoryName(repo:string){for(const file of ["catos.config.yaml","catos.config.yml"]){try{const cfg=parse(await readFile(path.join(repo,file),"utf8")); if(typeof cfg?.name==="string"&&cfg.name.trim())return titleName(cfg.name.trim());}catch{}} try{const pkg=JSON.parse(await readFile(path.join(repo,"package.json"),"utf8")); if(typeof pkg?.name==="string"&&pkg.name.trim())return titleName(pkg.name.trim());}catch{} return await remoteBasename(repo) ?? titleName(path.basename(repo));}
export async function listRepositoryBranches(repositoryPath:string):Promise<BranchSummary[]>{
 const repo=await realpath(repositoryPath); const cur=await currentBranch(repo);
 const {stdout}=await execFileAsync("git",["-C",repo,"for-each-ref","--format=%(refname:short)","refs/heads"],{timeout:5000});
 return stdout.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).sort().map(name=>({name,current:name===cur}));
}
export async function currentBranch(repositoryPath:string):Promise<string|undefined>{try{const {stdout}=await execFileAsync("git",["-C",repositoryPath,"branch","--show-current"],{timeout:5000});return stdout.trim()||undefined;}catch{return undefined;}}
export function defaultBaseBranch(branches:BranchSummary[]):string{ return branches.find(b=>b.current)?.name ?? branches.find(b=>b.name==="main")?.name ?? branches.find(b=>b.name==="master")?.name ?? branches[0]?.name ?? ""; }
export function defaultPrTarget(baseBranch:string,current:string|undefined,manuallyChanged:boolean){ return manuallyChanged ? current ?? baseBranch : baseBranch; }
export async function validateManualRepository(repositoryPath:string):Promise<RepositorySummary>{ const real=await realpath(repositoryPath).catch(()=>{throw new Error("Repository not found.")}); if(!(await isWorkTree(real))) throw new Error("Not a Git repository."); const top=await realpath(await topLevel(real)); return {id:top,source:"local",name:await repositoryName(top),path:top,localPath:top,currentBranch:await currentBranch(top),isAvailableLocally:true} }
export async function scanRepositories(roots:string[],maxDepth=3):Promise<RepositorySummary[]>{ const seen=new Set<string>(); const out:RepositorySummary[]=[]; async function add(dir:string){const top=await realpath(await topLevel(dir)); if(seen.has(top))return; seen.add(top); out.push({id:top,source:"local",name:await repositoryName(top),path:top,localPath:top,currentBranch:await currentBranch(top),isAvailableLocally:true});} async function walk(dir:string,depth:number,scanTemp:boolean){ let real:string; try{real=await realpath(dir);}catch{return;} if(seen.has(real))return; if(await isWorkTree(real)){await add(real); return;} if(depth>=maxDepth)return; let entries; try{entries=await readdir(real,{withFileTypes:true});}catch{return;} for(const e of entries){ if(!e.isDirectory()&& !e.isSymbolicLink()) continue; if(ignored.has(e.name)||e.name.startsWith("catos-runtime")||(scanTemp&&isIgnoredTempName(e.name))) continue; await walk(path.join(real,e.name),depth+1,scanTemp);} }
 for(const root of roots){await walk(root,0,isTempRoot(root));} return out.sort((a,b)=>a.name.localeCompare(b.name)||a.path.localeCompare(b.path)); }
export async function discoverRepositories(roots:string[],cwd=process.cwd(),maxDepth=3):Promise<RepositorySummary[]>{ const current=(await isWorkTree(cwd))?await validateManualRepository(cwd).catch(()=>undefined):undefined; const repos=await scanRepositories(roots,maxDepth); const byPath=new Map(repos.map(r=>[r.path,r])); if(current)byPath.set(current.path,current); return [...byPath.values()].sort((a,b)=>{ if(current){ if(a.path===current.path)return -1; if(b.path===current.path)return 1;} return a.name.localeCompare(b.name)||a.path.localeCompare(b.path);}); }
export async function loadRepositoryRoots(cwd=process.cwd()):Promise<string[]>{ for(const name of ["catos.config.yaml","catos.config.yml"]){ const file=path.join(cwd,name); if(await exists(file)){ try{const parsed=parse(await readFile(file,"utf8")); const roots=parsed?.repositoryRoots; if(Array.isArray(roots)&&roots.every((r:unknown)=>typeof r==="string")) return roots.map((r:string)=>path.resolve(cwd,r));}catch{}} } return [cwd]; }
