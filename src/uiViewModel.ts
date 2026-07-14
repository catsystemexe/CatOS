import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Attempt, Session } from "./runs/sessionModel.js";

export type UiRunStatus = "idle" | "running" | "human_required" | "completed" | "failed" | "stopped";
export type UiTimelineStatus = "completed" | "failed" | "rework" | "running" | "waiting" | "stopped";
export type UiTimelineRow = { id:string; index: number; label: string; status: UiTimelineStatus; startedAt?: string; finishedAt?: string; durationMs?: number; message?: string; output?: { label: string; path: string; type?: "file"; contentAvailable?: boolean }; artifactPath?: string };
export type UiRunError = { code:string; message:string; stepId?:string; details?:string };
export type UiChangedFile = { path:string; changeType:"created"|"modified"|"deleted"; exists:boolean };
export type UiOutput = { label:string; path:string; type?:"file"; contentAvailable?:boolean; kind?:string; readable?:boolean };
export type UiSystemState = { humanReview: boolean; terminalMessage?: "TASK COMPLETE" | "TASK FAILED" | "TASK STOPPED" | "HUMAN REVIEW REQUIRED"; error: UiRunError|null; workspacePath?: string; changedFiles: UiChangedFile[]; outputs: UiOutput[]; finalResponse?: string; raw?: unknown };

async function exists(file: string): Promise<boolean> { try { await stat(file); return true; } catch { return false; } }
async function readJson<T>(file: string): Promise<T | undefined> { try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return undefined; } }
function durMs(start?: string, end?: string): number | undefined { if (!start) return undefined; const e = end ? Date.parse(end) : Date.now(); const s = Date.parse(start); return Number.isFinite(e) && Number.isFinite(s) ? Math.max(0, e - s) : undefined; }
async function findFiles(dir: string, name: string): Promise<string[]> { const out: string[] = []; async function walk(d: string): Promise<void> { let entries; try { entries = await readdir(d, { withFileTypes: true }); } catch { return; } for (const e of entries) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else if (e.name === name) out.push(p); } } await walk(dir); return out; }
function relToRun(runDir: string, file: string | undefined) { if (!file) return undefined; const abs = path.isAbsolute(file) ? file : path.join(runDir, file); return { label: path.basename(abs), path: path.relative(runDir, abs), type:"file" as const, contentAvailable:true }; }
async function firstExisting(runDir: string, dir: string, candidates: Array<string | undefined>): Promise<string | undefined> { for (const c of candidates) { if (!c) continue; const abs = path.isAbsolute(c) ? c : path.join(runDir, c); if (await exists(abs)) return path.relative(runDir, abs); } for (const c of candidates) { if (!c) continue; const abs = path.join(dir, c); if (await exists(abs)) return path.relative(runDir, abs); } return undefined; }
function changeType(status:string): UiChangedFile["changeType"] { return status === "D" ? "deleted" : status === "??" || status === "A" ? "created" : "modified"; }
async function gitChangedFiles(workspacePath:string): Promise<UiChangedFile[]> { const { execFile } = await import("node:child_process"); const { promisify } = await import("node:util"); const execFileAsync = promisify(execFile); try { const { stdout } = await execFileAsync("git", ["-C", workspacePath, "status", "--porcelain=v1", "--untracked-files=all"]); return await Promise.all(stdout.split(/\n/).filter(Boolean).map(async line=>{ const status=line.slice(0,2).trim() || line.slice(0,2); const file=line.slice(3).replace(/^"|"$/g,""); const abs=path.join(workspacePath,file); return { path:file, changeType:changeType(status), exists: await exists(abs) }; })); } catch { return []; } }
function textish(file:string){ return [".md",".txt",".json",".diff",".log",".ts",".tsx",".js",".css",".html",".yaml",".yml"].includes(path.extname(file)); }
async function outputsFromChanged(workspacePath:string|undefined, changedFiles:UiChangedFile[]): Promise<UiOutput[]> { if(!workspacePath) return []; return changedFiles.filter(f=>f.exists && textish(f.path)).map(f=>({label:path.basename(f.path),path:f.path,type:"file",contentAvailable:true})); }
function legacyStatus(s?:string): UiRunStatus { if(s === "ACCEPTED" || s === "completed") return "completed"; if(s === "HUMAN_REQUIRED") return "human_required"; if(s === "stopped") return "stopped"; if(s) return "failed"; return "idle"; }
function reviewMessage(verdict?:string, validation?:string){ if(verdict === "REWORK") return validation && validation !== "PASS" ? `Validation failed: ${validation}.` : "Review requested rework, but no reason was recorded."; if(verdict === "HUMAN_REQUIRED") return "Human review required."; if(verdict === "ACCEPT") return "Review accepted changes."; return undefined; }

export async function buildUiTimeline(runDir: string): Promise<UiTimelineRow[]> {
  const rows: UiTimelineRow[] = [];
  const session = await readJson<Session>(path.join(runDir, "session.json"));
  if (!session) return rows;
  const attempts = (await findFiles(path.join(runDir, "steps"), "attempt.json")).concat(await findFiles(path.join(runDir, "attempts"), "attempt.json"));
  const parsed = (await Promise.all(attempts.map(async f => ({ file: f, attempt: await readJson<Attempt>(f) })))).filter((x): x is { file: string; attempt: Attempt } => !!x.attempt).sort((a,b) => a.attempt.order - b.attempt.order || a.file.localeCompare(b.file));
  for (const { file, attempt } of parsed) {
    const dir = path.dirname(file); const isRework = attempt.order > 1 || path.relative(runDir, dir).startsWith("attempts");
    const coding = await firstExisting(runDir, dir, [attempt.artifacts.codingResultPath, "coding-result.json"]);
    rows.push({ id:`${attempt.attemptId}:codex`, index: rows.length+1, label: isRework ? `Run Codex rework #${Math.max(1, attempt.order - 1)}` : "Run Codex task", status: attempt.status === "running" ? "running" : attempt.status === "cancelled" ? "stopped" : attempt.status === "failed" ? "failed" : "completed", startedAt:attempt.startedAt, finishedAt:attempt.completedAt, durationMs:durMs(attempt.startedAt, attempt.completedAt), message: attempt.errorSummary || (attempt.changedFiles?.length ? `Changed files: ${attempt.changedFiles.join(", ")}` : "Codex attempt completed."), output: relToRun(runDir, coding) });
    const validation = await firstExisting(runDir, dir, [attempt.artifacts.validationReportPath, "validation-report.json"]);
    const vr = validation ? await readJson<{ status?: string; results?: Array<{name?:string;status?:string;summary?:string}> }>(path.join(runDir, validation)) : undefined;
    if (validation) rows.push({ id:`${attempt.attemptId}:validation`, index: rows.length+1, label:"Run validation", status: vr?.status === "PASS" ? "completed" : "failed", message: vr?.status === "PASS" ? "Validation passed." : `Validation failed: ${vr?.status ?? "unknown"}.`, output: relToRun(runDir, validation) });
    const review = await firstExisting(runDir, dir, [attempt.artifacts.reviewReportPath, "review-report.json", "review-package.md"]);
    if (review) { const rr = review.endsWith(".json") ? await readJson<{ verdict?: string; summary?:string; blockingFindings?: unknown[] }>(path.join(runDir, review)) : undefined; rows.push({ id:`${attempt.attemptId}:review`, index: rows.length+1, label:"Review changes", status: rr?.verdict === "ACCEPT" ? "completed" : rr?.verdict === "REWORK" || rr?.verdict === "HUMAN_REQUIRED" ? "rework" : rr ? "failed" : "completed", message: rr?.summary || reviewMessage(rr?.verdict, vr?.status), output: relToRun(runDir, review) }); }
  }
  return rows.map((r, i) => { const index=i+1; const slug=r.label.toLowerCase().replace(/[^a-z0-9]+/g,"-").replace(/^-|-$/g,"").replace(/^run-/,"")||"step"; return { ...r, index, artifactPath: path.join("steps",`${String(index).padStart(2,"0")}-${slug}`,"result.md") }; });
}

async function deriveError(runDir:string, status:UiRunStatus): Promise<UiRunError|null> { if(status !== "failed") return null; const final=await readJson<any>(path.join(runDir,"final-result.json")); if(final?.error) return final.error; const rows=await buildUiTimeline(runDir); const bad=[...rows].reverse().find(r=>r.status === "failed" || r.status === "rework"); return { code: final?.status === "REWORK_LIMIT_REACHED" ? "attempt_exhaustion" : "run_failed", message: bad?.message || "Run failed.", stepId: bad?.id, details: final ? JSON.stringify(final,null,2) : undefined } }
export async function getUiRunStatus(runDir?: string): Promise<UiRunStatus> { if (!runDir) return "idle"; if (await exists(path.join(runDir, ".ui-stopped"))) return "stopped"; const final = await readJson<{ status?: string }>(path.join(runDir, "final-result.json")); if(final?.status) return legacyStatus(final.status); const rows = await buildUiTimeline(runDir); return rows.some(r => r.status === "running") || rows.length ? "running" : "idle"; }
export async function buildUiSystemState(runDir: string): Promise<UiSystemState> { const status=await getUiRunStatus(runDir); const final=await readJson<any>(path.join(runDir,"final-result.json")); const workspacePath=final?.workspacePath ?? final?.finalWorkspacePath; let changedFiles:UiChangedFile[] = Array.isArray(final?.changedFiles) ? final.changedFiles : [];
  if(!changedFiles.length && Array.isArray(final?.finalChangedFiles)) changedFiles=await Promise.all(final.finalChangedFiles.map(async (f:string)=>({path:f,changeType:"modified" as const,exists:workspacePath?await exists(path.join(workspacePath,f)):false})));
  if(!changedFiles.length && workspacePath) changedFiles=await gitChangedFiles(workspacePath);
  const userOutputs:UiOutput[] = Array.isArray(final?.outputs) ? final.outputs : await outputsFromChanged(workspacePath, changedFiles);
  const artifacts:UiOutput[] = Array.isArray(final?.runArtifacts) ? final.runArtifacts.map((a:any)=>({...a,type:"file",contentAvailable:a.readable})) : [];
  const report = artifacts.find(a=>a.kind==="session-report") || ((await exists(path.join(runDir,"AUTOCODEX_SESSION_REPORT.md"))) ? {label:"AutoCodex session report",path:"AUTOCODEX_SESSION_REPORT.md",type:"file" as const,contentAvailable:true,kind:"session-report",readable:true} : undefined);
  const steps = artifacts.filter(a=>a.kind!=="session-report");
  const outputs:UiOutput[] = [...userOutputs, ...(report && !userOutputs.some(o=>o.path===report.path) ? [report] : []), ...steps.filter(a=>!userOutputs.some(o=>o.path===a.path) && a.path!==report?.path)];
  return { humanReview: status === "human_required", terminalMessage: status === "completed" ? "TASK COMPLETE" : status === "failed" ? "TASK FAILED" : status === "stopped" ? "TASK STOPPED" : status === "human_required" ? "HUMAN REVIEW REQUIRED" : undefined, error: await deriveError(runDir,status), workspacePath: workspacePath ? "<run-workspace>" : undefined, changedFiles, outputs, finalResponse: final?.finalResponse, raw: final } }
