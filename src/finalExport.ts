import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildUiTimeline, getUiRunStatus } from "./uiViewModel.js";

async function readJson(file: string): Promise<any> { try { return JSON.parse(await readFile(file, "utf8")); } catch { return undefined; } }
async function listChanged(runDir: string): Promise<string[]> { const final = await readJson(path.join(runDir, "final-result.json")); return final?.finalChangedFiles ?? final?.changedFiles?.map((f:any)=>f.path) ?? []; }
function duration(start?:string,end?:string){ if(!start)return "-"; const finish=end?Date.parse(end):Date.now(); const begin=Date.parse(start); return Number.isFinite(finish)&&Number.isFinite(begin)?`${Math.max(0,finish-begin)}ms`:"-"; }
function compact(v:unknown){ return typeof v === "string" && v.trim() ? v.trim() : "-"; }
const STEP_FILES = ["01_CODEX.md", "02_VALIDATION.md", "03_REVIEW.md"] as const;

export async function ensureStepResultArtifacts(runDir:string): Promise<Array<{label:string;path:string;kind:"step-report";readable:true}>>{
  const rows=await buildUiTimeline(runDir); const artifacts:Array<{label:string;path:string;kind:"step-report";readable:true}>=[];
  await mkdir(runDir,{recursive:true});
  for(const row of rows){ const rel=STEP_FILES[row.index-1]; if(!rel) continue; const abs=path.join(runDir,rel);
    const md=[`# ${row.name} Result`,"",`- status: ${row.status}`,`- duration: ${row.durationMs ?? duration(row.startedAt,row.finishedAt)}`,`- summary: ${compact(row.summary ?? row.message)}`,"","## Commands","- none recorded","","## Files created",...(row.filesCreated?.length?row.filesCreated.map(f=>`- ${f}`):["- none recorded"]),"","## Files modified",...(row.filesModified?.length?row.filesModified.map(f=>`- ${f}`):["- none recorded"]),"","## Files deleted",...(row.filesDeleted?.length?row.filesDeleted.map(f=>`- ${f}`):["- none recorded"]),"","## Validation details",row.name==="VALIDATION"?compact(row.message):"-","","## Review reason",row.name==="REVIEW"?compact(row.message):"-","","## Error details",compact(row.errorDetails),"","## Technical diagnostics",`- source artifact: ${row.output?.path ?? "-"}`,""].join("\n");
    await writeFile(abs,md,"utf8"); artifacts.push({label:rel,path:rel,kind:"step-report",readable:true}); }
  return artifacts;
}
export async function writeSessionReport(runDir: string): Promise<string> { return writeFinalReport(runDir); }
export async function writeFinalReport(runDir: string): Promise<string> {
  await ensureStepResultArtifacts(runDir); const [input, session, finalResult] = await Promise.all([readJson(path.join(runDir,"input.json")), readJson(path.join(runDir,"session.json")), readJson(path.join(runDir,"final-result.json"))]);
  const rows = await buildUiTimeline(runDir); const status = await getUiRunStatus(runDir); const changed = await listChanged(runDir);
  const repo=session?.git?.repositoryPath ?? input?.repositoryPath ?? "-"; const branch=session?.git?.runBranch ?? session?.branch ?? input?.baseBranch ?? "-";
  const md=["# AutoCodex Final Report","","## Run",`- run ID: ${session?.runId ?? input?.runId ?? finalResult?.runId ?? path.basename(runDir)}`,`- repository: ${repo}`,`- branch: ${branch}`,`- status: ${status}`,`- duration: ${rows.length ? rows.reduce((a,r)=>a+(r.durationMs??0),0) : "-"}`,"","## Task",input?.goal ?? input?.task ?? session?.goal ?? "-","","## Steps",...rows.map(r=>`- ${r.name}: ${r.status}; duration=${r.durationMs ?? "-"}; result file=${r.resultFile?.label ?? STEP_FILES[r.index-1] ?? "-"}`),"","## Changed files",...(changed.length?changed.map(f=>`- ${f}`):["- none recorded"]),"","## Final result",finalResult?.finalResponse ?? finalResult?.terminalMessage ?? status,"","## Error",finalResult?.error?JSON.stringify(finalResult.error,null,2):"- none",""].join("\n");
  const out = path.join(runDir, "FINAL_REPORT.md"); await writeFile(out, md, "utf8"); return out;
}
