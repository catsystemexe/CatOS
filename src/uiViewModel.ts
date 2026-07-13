import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import type { Attempt, Session } from "./runs/sessionModel.js";

export type UiRunStatus = "idle" | "running" | "human_required" | "completed" | "failed" | "stopped";
export type UiTimelineStatus = "completed" | "failed" | "rework" | "running" | "pending" | "cancelled";
export type UiTimelineRow = { order: number; type: string; label: string; status: UiTimelineStatus; output?: { label: string; path: string }; durationSeconds?: number };
export type UiSystemState = { humanReview: boolean; finalExport?: { label: string; path: string }; terminalMessage?: "TASK COMPLETE" | "TASK FAILED" | "TASK STOPPED" | "HUMAN REVIEW REQUIRED" };

async function exists(file: string): Promise<boolean> { try { await stat(file); return true; } catch { return false; } }
async function readJson<T>(file: string): Promise<T | undefined> { try { return JSON.parse(await readFile(file, "utf8")) as T; } catch { return undefined; } }
function dur(start?: string, end?: string): number | undefined { if (!start) return undefined; const e = end ? Date.parse(end) : Date.now(); const s = Date.parse(start); return Number.isFinite(e) && Number.isFinite(s) ? Math.max(0, Math.round((e - s) / 1000)) : undefined; }
async function findFiles(dir: string, name: string): Promise<string[]> { const out: string[] = []; async function walk(d: string): Promise<void> { let entries; try { entries = await readdir(d, { withFileTypes: true }); } catch { return; } for (const e of entries) { const p = path.join(d, e.name); if (e.isDirectory()) await walk(p); else if (e.name === name) out.push(p); } } await walk(dir); return out; }
function rel(runDir: string, file: string | undefined): { label: string; path: string } | undefined { if (!file) return undefined; const r = path.relative(runDir, path.isAbsolute(file) ? file : path.join(runDir, file)); return { label: path.basename(r), path: r }; }

export async function buildUiTimeline(runDir: string): Promise<UiTimelineRow[]> {
  const rows: UiTimelineRow[] = [];
  const taskBrief = (await exists(path.join(runDir, "task-brief.json"))) ? "task-brief.json" : undefined;
  const session = await readJson<Session>(path.join(runDir, "session.json"));
  if (taskBrief || session) rows.push({ order: rows.length + 1, type: "analysis", label: "ANALYSIS", status: taskBrief ? "completed" : "running", output: rel(runDir, taskBrief) });
  const attempts = (await findFiles(path.join(runDir, "steps"), "attempt.json"))
    .concat(await findFiles(path.join(runDir, "attempts"), "attempt.json"));
  const parsed = (await Promise.all(attempts.map(async f => ({ file: f, attempt: await readJson<Attempt>(f) })))).filter((x): x is { file: string; attempt: Attempt } => !!x.attempt).sort((a,b) => a.attempt.order - b.attempt.order || a.file.localeCompare(b.file));
  for (const { file, attempt } of parsed) {
    const dir = path.dirname(file);
    const isRework = attempt.order > 1 || path.relative(runDir, dir).startsWith("attempts");
    const coding = attempt.artifacts.codingResultPath ?? (await exists(path.join(dir, "coding-result.json")) ? path.relative(runDir, path.join(dir, "coding-result.json")) : undefined);
    rows.push({ order: rows.length + 1, type: "codex", label: isRework ? `CODEX (REWORK #${Math.max(1, attempt.order - 1)})` : "CODEX", status: attempt.status === "running" ? "running" : attempt.status === "cancelled" ? "cancelled" : attempt.status === "failed" ? "failed" : "completed", output: rel(runDir, coding), durationSeconds: dur(attempt.startedAt, attempt.completedAt) });
    const validation = attempt.artifacts.validationReportPath ?? (await exists(path.join(dir, "validation-report.json")) ? path.relative(runDir, path.join(dir, "validation-report.json")) : undefined);
    if (validation) {
      const vr = await readJson<{ status?: string }>(path.join(runDir, validation));
      rows.push({ order: rows.length + 1, type: "validation", label: "VALIDATION", status: vr?.status === "PASS" ? "completed" : "failed", output: rel(runDir, validation) });
    }
    const review = attempt.artifacts.reviewReportPath ?? (await exists(path.join(dir, "review-report.json")) ? path.relative(runDir, path.join(dir, "review-report.json")) : undefined);
    if (review) {
      const rr = await readJson<{ verdict?: string }>(path.join(runDir, review));
      rows.push({ order: rows.length + 1, type: "review", label: "REVIEW", status: rr?.verdict === "ACCEPT" ? "completed" : rr?.verdict === "REWORK" ? "rework" : rr?.verdict === "HUMAN_REQUIRED" ? "rework" : "failed", output: rel(runDir, review) });
    }
  }
  return rows.map((r, i) => ({ ...r, order: i + 1 }));
}

export async function finalExportPath(runDir: string): Promise<string | undefined> { return (await exists(path.join(runDir, "AUTOCODEX_SESSION_REPORT.md"))) ? "AUTOCODEX_SESSION_REPORT.md" : undefined; }
export async function getUiRunStatus(runDir?: string): Promise<UiRunStatus> { if (!runDir) return "idle"; const stopped = await exists(path.join(runDir, ".ui-stopped")); if (stopped) return "stopped"; const final = await readJson<{ status?: string }>(path.join(runDir, "final-result.json")); if (final?.status === "ACCEPTED") return "completed"; if (final?.status === "HUMAN_REQUIRED") return "human_required"; if (final?.status) return "failed"; const rows = await buildUiTimeline(runDir); return rows.some(r => r.status === "running") ? "running" : rows.length ? "running" : "idle"; }
export async function buildUiSystemState(runDir: string): Promise<UiSystemState> { const status = await getUiRunStatus(runDir); const fe = await finalExportPath(runDir); return { humanReview: status === "human_required", finalExport: fe ? { label: path.basename(fe), path: fe } : undefined, terminalMessage: status === "completed" ? "TASK COMPLETE" : status === "failed" ? "TASK FAILED" : status === "stopped" ? "TASK STOPPED" : status === "human_required" ? "HUMAN REVIEW REQUIRED" : undefined }; }
