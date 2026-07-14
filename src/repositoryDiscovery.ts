import { readdir, realpath, stat, readFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { parse } from "yaml";
const execFileAsync=promisify(execFile);
export type RepositorySummary={id:string;name:string;path:string;currentBranch?:string};
export type BranchSummary={name:string;current:boolean};
const ignored=new Set(["node_modules",".git","runs","build","dist","coverage",".catos","workspaces","workspace","tmp","runtime"]);
async function exists(p:string){try{await stat(p);return true;}catch{return false;}}
async function isWorkTree(p:string){try{return (await execFileAsync("git",["-C",p,"rev-parse","--is-inside-work-tree"],{timeout:5000})).stdout.trim()==="true";}catch{return false;}}
async function topLevel(p:string){try{return (await execFileAsync("git",["-C",p,"rev-parse","--show-toplevel"],{timeout:5000})).stdout.trim();}catch{return p;}}
export async function listRepositoryBranches(repositoryPath:string):Promise<BranchSummary[]>{
 const repo=await realpath(repositoryPath); const cur=await currentBranch(repo);
 const {stdout}=await execFileAsync("git",["-C",repo,"for-each-ref","--format=%(refname:short)","refs/heads"],{timeout:5000});
 return stdout.split(/\r?\n/).map(s=>s.trim()).filter(Boolean).sort().map(name=>({name,current:name===cur}));
}
export async function currentBranch(repositoryPath:string):Promise<string|undefined>{try{const {stdout}=await execFileAsync("git",["-C",repositoryPath,"branch","--show-current"],{timeout:5000});return stdout.trim()||undefined;}catch{return undefined;}}
export function defaultBaseBranch(branches:BranchSummary[]):string{ return branches.find(b=>b.current)?.name ?? branches.find(b=>b.name==="main")?.name ?? branches.find(b=>b.name==="master")?.name ?? branches[0]?.name ?? ""; }
export function defaultPrTarget(baseBranch:string,current:string|undefined,manuallyChanged:boolean){ return manuallyChanged ? current ?? baseBranch : baseBranch; }
export async function validateManualRepository(repositoryPath:string):Promise<RepositorySummary>{ const real=await realpath(repositoryPath).catch(()=>{throw new Error("Repository not found.")}); if(!(await isWorkTree(real))) throw new Error("Not a Git repository."); const top=await realpath(await topLevel(real)); return {id:top,name:path.basename(top),path:top,currentBranch:await currentBranch(top)}; }
export async function scanRepositories(roots:string[],maxDepth=3):Promise<RepositorySummary[]>{ const seen=new Set<string>(); const out:RepositorySummary[]=[]; async function add(dir:string){const top=await realpath(await topLevel(dir)); if(seen.has(top))return; seen.add(top); out.push({id:top,name:path.basename(top),path:top,currentBranch:await currentBranch(top)});} async function walk(dir:string,depth:number){ let real:string; try{real=await realpath(dir);}catch{return;} if(seen.has(real))return; if(await isWorkTree(real)){await add(real); return;} if(depth>=maxDepth)return; let entries; try{entries=await readdir(real,{withFileTypes:true});}catch{return;} for(const e of entries){ if(!e.isDirectory()&& !e.isSymbolicLink()) continue; if(ignored.has(e.name)||e.name.startsWith("catos-runtime")) continue; await walk(path.join(real,e.name),depth+1);} }
 for(const root of roots){await walk(root,0);} return out.sort((a,b)=>a.name.localeCompare(b.name)||a.path.localeCompare(b.path)); }
export async function loadRepositoryRoots(cwd=process.cwd()):Promise<string[]>{ for(const name of ["catos.config.yaml","catos.config.yml"]){ const file=path.join(cwd,name); if(await exists(file)){ try{const parsed=parse(await readFile(file,"utf8")); const roots=parsed?.repositoryRoots; if(Array.isArray(roots)&&roots.every((r:unknown)=>typeof r==="string")) return roots.map((r:string)=>path.resolve(cwd,r));}catch{}} } return [cwd]; }
