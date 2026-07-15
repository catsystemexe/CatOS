import { readFile, readdir, realpath } from "node:fs/promises";
import path from "node:path";
import { parse } from "yaml";
import { projectConfigSchema, type ProjectConfig } from "./config/projectConfigSchema.js";
export type RepositoryRunConfigSource="project-config"|"repo-config"|"inferred"|"default";
export async function resolveRepositoryRunConfig(repositoryPath:string,cwd=process.cwd()):Promise<{config:ProjectConfig;configSource:RepositoryRunConfigSource;configPath:string}>{
 const repo=await realpath(repositoryPath);
 for(const file of [path.join(repo,"catos.config.yaml"),path.join(repo,"catos.config.yml")]){try{const parsed=parse(await readFile(file,"utf8")); if(parsed?.project){const cfg=projectConfigSchema.parse(parsed); return {config:cfg,configSource:"repo-config",configPath:file};}}catch{}}
 const projects=path.join(cwd,"projects"); const files=await readdir(projects).catch(()=>[]);
 for(const f of files.filter(f=>/\.ya?ml$/.test(f))){try{const file=path.join(projects,f); const cfg=projectConfigSchema.parse(parse(await readFile(file,"utf8"))); if(await realpath(path.resolve(path.dirname(file),cfg.project.repoPath))===repo) return {config:cfg,configSource:"project-config",configPath:file};}catch{}}
 let pkg:any; try{pkg=JSON.parse(await readFile(path.join(repo,"package.json"),"utf8"));}catch{}
 const scripts=pkg?.scripts??{}; const cmd=(name:string,fallback:string)=> typeof scripts[name]==="string"?fallback:`catos:skip:no npm script named ${name}`;
 const inferred=!!pkg;
 return {config:{project:{id:path.basename(repo).replace(/[^a-zA-Z0-9_-]/g,"-"),name:path.basename(repo),repoPath:repo},commands:{typecheck:cmd("typecheck","npm run typecheck"),test:cmd("test","npm test"),build:cmd("build","npm run build")},workflow:{maxReworkAttempts:0,createCommit:false},permissions:{allowNetwork:false,allowPush:false,allowMerge:false},execution:{},codex:{sandboxMode:"workspace-write",acknowledgeNoSandbox:false},git:{remoteName:"origin"},validation:{timeoutMs:120000}},configSource:inferred?"inferred":"default",configPath:"<repository-fallback>"};
}
