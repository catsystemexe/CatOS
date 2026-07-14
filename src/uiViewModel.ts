import { access, constants, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Attempt, Session } from "./runs/sessionModel.js";

export type UiRunStatus = "idle" | "running" | "human_required" | "completed" | "failed" | "stopped";
export type UiTimelineStatus = "completed" | "failed" | "rework" | "running" | "waiting" | "stopped";
export type UiTimelineRow = { id:string; index: number; name: "CODEX"|"VALIDATION"|"REVIEW"; label: string; status: UiTimelineStatus; startedAt?: string; finishedAt?: string; durationMs?: number; message?: string; summary?: string; errorDetails?: string; filesCreated?: string[]; filesModified?: string[]; filesDeleted?: string[]; output?: { label: string; path: string; type?: "file"; contentAvailable?: boolean }; artifactPath?: string; resultFile?: { label:string; path:string; exists:boolean; readable:boolean } };
export type UiRunError = { code:string; message:string; stepId?:string; details?:string };
export type UiChangedFile = { path:string; changeType:"created"|"modified"|"deleted"; exists:boolean };
export type UiOutput = { label:string; path:string; type?:"file"; contentAvailable?:boolean; kind?:string; readable?:boolean; downloadable?:boolean };
export type UiSystemState = { humanReview: boolean; terminalMessage?: "TASK COMPLETE" | "TASK FAILED" | "TASK STOPPED" | "HUMAN REVIEW REQUIRED"; error: UiRunError|null; workspacePath?: string; changedFiles: UiChangedFile[]; outputs: UiOutput[]; steps: UiTimelineRow[]; finalReport: { label:string; path:string; readable:boolean; downloadable:boolean }; finalResponse?: string };

async function exists(file: string): Promise<boolean> { try { await stat(file); return true; } catch { return false; } }
async function fileAvailability(file:string): Promise<{exists:boolean;readable:boolean;downloadable:boolean}> { try { const st=await stat(file); if(!st.isFile()) return {exists:true,readable:false,downloadable:false}; await access(file, constants.R_OK); return {exists:true,readable:true,downloadable:true}; } catch (e:any) { return e?.code === "ENOENT" ? {exists:false,readable:false,downloadable:false} : {exists: await exists(file), readable:false,downloadable:false}; } }
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
  const session = await readJson<Session>(path.join(runDir, "session.json"));
  if (!session) return [];
  const attempts = (await findFiles(path.join(runDir, "steps"), "attempt.json")).concat(await findFiles(path.join(runDir, "attempts"), "attempt.json"));
  const parsed = (await Promise.all(attempts.map(async f => ({ file: f, attempt: await readJson<Attempt>(f) })))).filter((x): x is { file: string; attempt: Attempt } => !!x.attempt).sort((a,b) => a.attempt.order - b.attempt.order || a.file.localeCompare(b.file));
  const latest = parsed.at(-1);
  if (!latest) return [];
  const { file, attempt } = latest; const dir = path.dirname(file);
  const coding = await firstExisting(runDir, dir, [attempt.artifacts.codingResultPath, "coding-result.json"]);
  const validation = await firstExisting(runDir, dir, [attempt.artifacts.validationReportPath, "validation-report.json"]);
  const vr = validation ? await readJson<{ status?: string; results?: Array<{name?:string;status?:string;summary?:string}> }>(path.join(runDir, validation)) : undefined;
  const review = await firstExisting(runDir, dir, [attempt.artifacts.reviewReportPath, "review-report.json", "review-package.md"]);
  const rr = review?.endsWith(".json") ? await readJson<{ verdict?: string; summary?:string; blockingFindings?: unknown[] }>(path.join(runDir, review)) : undefined;
  const changed = attempt.changedFiles ?? [];
  const rows: UiTimelineRow[] = [
    { id:`${attempt.attemptId}:codex`, index:1, name:"CODEX", label:"CODEX", status: attempt.status === "running" ? "running" : attempt.status === "cancelled" ? "stopped" : attempt.status === "failed" ? "failed" : "completed", startedAt:attempt.startedAt, finishedAt:attempt.completedAt, durationMs:durMs(attempt.startedAt, attempt.completedAt), message: attempt.errorSummary || (changed.length ? `Changed files: ${changed.join(", ")}` : "Codex attempt completed."), filesModified: changed, output: relToRun(runDir, coding) },
    { id:`${attempt.attemptId}:validation`, index:2, name:"VALIDATION", label:"VALIDATION", status: validation ? (vr?.status === "PASS" ? "completed" : "failed") : "waiting", message: validation ? (vr?.status === "PASS" ? "Repository checks passed; task output not yet verified." : `Repository checks failed: ${vr?.status ?? "unknown"}.`) : undefined, output: relToRun(runDir, validation) },
    { id:`${attempt.attemptId}:review`, index:3, name:"REVIEW", label:"REVIEW", status: review ? (rr?.verdict === "ACCEPT" ? "completed" : rr?.verdict === "REWORK" || rr?.verdict === "HUMAN_REQUIRED" ? "rework" : rr ? "failed" : "completed") : "waiting", message: review ? (rr?.summary || reviewMessage(rr?.verdict, vr?.status)) : undefined, output: relToRun(runDir, review) }
  ];
  return Promise.all(rows.map(async (r) => { const rel=`${String(r.index).padStart(2,"0")}_${r.name}.md`; const availability=await fileAvailability(path.join(runDir,rel)); return { ...r, resultFile: { label: rel, path: rel, exists: availability.exists, readable: availability.readable }, artifactPath: rel }; }));
}

async function deriveError(runDir:string, status:UiRunStatus): Promise<UiRunError|null> { if(status !== "failed") return null; const final=await readJson<any>(path.join(runDir,"final-result.json")); if(final?.error) return final.error; const rows=await buildUiTimeline(runDir); const bad=[...rows].reverse().find(r=>r.status === "failed" || r.status === "rework"); return { code: final?.status === "REWORK_LIMIT_REACHED" ? "attempt_exhaustion" : "run_failed", message: bad?.message || "Run failed.", stepId: bad?.id, details: final ? JSON.stringify(final,null,2) : undefined } }
export async function getUiRunStatus(runDir?: string): Promise<UiRunStatus> { if (!runDir) return "idle"; if (await exists(path.join(runDir, ".ui-stopped"))) return "stopped"; const final = await readJson<{ status?: string }>(path.join(runDir, "final-result.json")); if(final?.status) return legacyStatus(final.status); const rows = await buildUiTimeline(runDir); return rows.some(r => r.status === "running") || rows.length ? "running" : "idle"; }
export async function buildUiSystemState(runDir: string): Promise<UiSystemState> { const status=await getUiRunStatus(runDir); const final=await readJson<any>(path.join(runDir,"final-result.json")); const workspacePath=final?.workspacePath ?? final?.finalWorkspacePath; let changedFiles:UiChangedFile[] = Array.isArray(final?.changedFiles) ? final.changedFiles : [];
  if(!changedFiles.length && Array.isArray(final?.finalChangedFiles)) changedFiles=await Promise.all(final.finalChangedFiles.map(async (f:string)=>({path:f,changeType:"modified" as const,exists:workspacePath?await exists(path.join(workspacePath,f)):false})));
  if(!changedFiles.length && workspacePath) changedFiles=await gitChangedFiles(workspacePath);
  const steps=await buildUiTimeline(runDir);
  const reportAvailability=await fileAvailability(path.join(runDir,"FINAL_REPORT.md"));
  const finalReport={label:"FINAL_REPORT.md",path:"FINAL_REPORT.md",readable:reportAvailability.readable,downloadable:reportAvailability.downloadable};
  const outputs:UiOutput[] = [finalReport];
  return { humanReview: status === "human_required", terminalMessage: status === "completed" ? "TASK COMPLETE" : status === "failed" ? "TASK FAILED" : status === "stopped" ? "TASK STOPPED" : status === "human_required" ? "HUMAN REVIEW REQUIRED" : undefined, error: await deriveError(runDir,status), workspacePath: workspacePath ? "<run-workspace>" : undefined, changedFiles, outputs, steps, finalReport, finalResponse: final?.finalResponse } }
