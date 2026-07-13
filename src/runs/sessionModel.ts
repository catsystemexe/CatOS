import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export type SessionStatus = "active" | "ready_for_review" | "committed" | "aborted";
export type StepStatus = "open" | "running" | "awaiting_decision" | "accepted" | "rejected" | "superseded";
export type AttemptStatus = "running" | "succeeded" | "failed" | "timed_out" | "cancelled";
export type DecisionType = "accept" | "retry" | "revise" | "reject" | "abort" | "commit";
export type DecisionActor = "human" | "system";

export type ArtifactRefs = {
  codingResultPath?: string;
  diffPath?: string;
  statusPath?: string;
  taskBriefPath?: string;
  validationReportPath?: string;
  reviewReportPath?: string;
  runtimeDir?: string;
  runtimeManifestPath?: string;
  runtimeStdoutPath?: string;
  runtimeStderrPath?: string;
  runtimeErrorPath?: string;
};

export type Session = { schemaVersion: 1; sessionId: string; runId: string; goal: string; status: SessionStatus; createdAt: string; updatedAt: string; branch: string; workspacePath?: string; steps: string[] };
export type Step = { schemaVersion: 1; stepId: string; order: number; title: string; request: string; status: StepStatus; createdAt: string; completedAt?: string; attempts: string[]; decisionIds: string[]; decisionId?: string };
export type Attempt = { schemaVersion: 1; attemptId: string; stepId: string; order: number; startedAt: string; completedAt?: string; prompt: string; codexThreadId?: string; runtimeMode?: string; status: AttemptStatus; resultStatus?: string; artifacts: ArtifactRefs; changedFiles: string[]; validationSummary?: string; errorSummary?: string };
export type Decision = { schemaVersion: 1; decisionId: string; createdAt: string; actor: DecisionActor; type: DecisionType; reason?: string; stepId: string; attemptId?: string };

function nowIso(now = new Date()): string { return now.toISOString(); }
function newId(prefix: string): string { return `${prefix}_${randomUUID()}`; }
function rel(runDir: string, p: string | undefined): string | undefined { return p ? path.relative(runDir, p) || path.basename(p) : undefined; }
function stepDir(runDir: string, step: Pick<Step, "order" | "stepId">): string { return path.join(runDir, "steps", `${String(step.order).padStart(3, "0")}-${step.stepId}`); }
function attemptDir(runDir: string, step: Pick<Step, "order" | "stepId">, attempt: Pick<Attempt, "order" | "attemptId">): string { return path.join(stepDir(runDir, step), "attempts", `${String(attempt.order).padStart(3, "0")}-${attempt.attemptId}`); }
async function writeJson(filePath: string, value: unknown): Promise<void> { await mkdir(path.dirname(filePath), { recursive: true }); await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, "utf8"); }
export async function readJson<T>(filePath: string): Promise<T> { return JSON.parse(await readFile(filePath, "utf8")) as T; }
async function appendTimeline(runDir: string, event: { type: string; sessionId: string; stepId?: string; attemptId?: string; metadata?: Record<string, unknown> }, timestamp = nowIso()): Promise<void> {
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "timeline.jsonl"), `${JSON.stringify({ timestamp, event: event.type, sessionId: event.sessionId, stepId: event.stepId, attemptId: event.attemptId, metadata: event.metadata ?? {} })}\n`, { encoding: "utf8", flag: "a" });
}
export async function createSession(input: { runDir: string; runId: string; goal: string; branch: string; workspacePath?: string; requestTitle?: string; request?: string; now?: Date }): Promise<{ session: Session; step: Step }> {
  const createdAt = nowIso(input.now); const stepId = newId("step");
  const session: Session = { schemaVersion: 1, sessionId: input.runId, runId: input.runId, goal: input.goal, status: "active", createdAt, updatedAt: createdAt, branch: input.branch, workspacePath: input.workspacePath, steps: [stepId] };
  const step: Step = { schemaVersion: 1, stepId, order: 1, title: input.requestTitle ?? "Initial run", request: input.request ?? input.goal, status: "open", createdAt, attempts: [], decisionIds: [] };
  await writeJson(path.join(input.runDir, "session.json"), session); await writeJson(path.join(stepDir(input.runDir, step), "step.json"), step); await writeFile(path.join(stepDir(input.runDir, step), "request.md"), `${step.request}\n`, "utf8");
  await appendTimeline(input.runDir, { type: "session.created", sessionId: session.sessionId, metadata: { runId: input.runId, branch: input.branch } }, createdAt);
  await appendTimeline(input.runDir, { type: "step.created", sessionId: session.sessionId, stepId, metadata: { order: step.order, title: step.title } }, createdAt);
  return { session, step };
}
export async function loadSession(runDir: string): Promise<Session> { return readJson<Session>(path.join(runDir, "session.json")); }
export async function loadStep(runDir: string, stepId?: string): Promise<Step> { const session = await loadSession(runDir); const id = stepId ?? session.steps[session.steps.length - 1]; const dirs = await import("node:fs/promises").then(fs => fs.readdir(path.join(runDir, "steps"))); const match = dirs.find(d => d.endsWith(`-${id}`)); if (!match) throw new Error(`Step not found: ${id}`); return readJson<Step>(path.join(runDir, "steps", match, "step.json")); }
async function persistSession(runDir: string, session: Session): Promise<void> { session.updatedAt = nowIso(); await writeJson(path.join(runDir, "session.json"), session); }
async function persistStep(runDir: string, step: Step): Promise<void> { await writeJson(path.join(stepDir(runDir, step), "step.json"), step); }
export async function startAttempt(input: { runDir: string; step: Step; prompt: string; runtimeMode?: string; now?: Date }): Promise<Attempt> {
  const attempt: Attempt = { schemaVersion: 1, attemptId: newId("attempt"), stepId: input.step.stepId, order: input.step.attempts.length + 1, startedAt: nowIso(input.now), prompt: input.prompt, runtimeMode: input.runtimeMode, status: "running", artifacts: {}, changedFiles: [] };
  input.step.status = "running"; input.step.attempts.push(attempt.attemptId); await persistStep(input.runDir, input.step);
  await writeJson(path.join(attemptDir(input.runDir, input.step, attempt), "attempt.json"), attempt); await writeFile(path.join(attemptDir(input.runDir, input.step, attempt), "prompt.md"), `${input.prompt}\n`, "utf8");
  const session = await loadSession(input.runDir); await appendTimeline(input.runDir, { type: "attempt.started", sessionId: session.sessionId, stepId: input.step.stepId, attemptId: attempt.attemptId, metadata: { order: attempt.order, runtimeMode: attempt.runtimeMode } }, attempt.startedAt);
  return attempt;
}
export async function completeAttempt(input: { runDir: string; step: Step; attempt: Attempt; status: AttemptStatus; codexThreadId?: string; resultStatus?: string; changedFiles?: string[]; validationSummary?: string; errorSummary?: string; artifacts?: ArtifactRefs; workspacePath?: string; now?: Date }): Promise<Attempt> {
  const completedAt = nowIso(input.now); const updated: Attempt = { ...input.attempt, completedAt, status: input.status, codexThreadId: input.codexThreadId, resultStatus: input.resultStatus, changedFiles: input.changedFiles ?? [], validationSummary: input.validationSummary, errorSummary: input.errorSummary, artifacts: input.artifacts ?? input.attempt.artifacts };
  input.step.status = "awaiting_decision"; await persistStep(input.runDir, input.step); await writeJson(path.join(attemptDir(input.runDir, input.step, updated), "attempt.json"), updated);
  const session = await loadSession(input.runDir); await persistSession(input.runDir, { ...session, workspacePath: input.workspacePath ?? session.workspacePath });
  await appendTimeline(input.runDir, { type: input.status === "failed" ? "attempt.failed" : "attempt.completed", sessionId: session.sessionId, stepId: input.step.stepId, attemptId: updated.attemptId, metadata: { status: updated.status, changedFiles: updated.changedFiles, validationSummary: updated.validationSummary } }, completedAt);
  return updated;
}
export function artifactRefs(runDir: string, paths: ArtifactRefs): ArtifactRefs { return Object.fromEntries(Object.entries(paths).map(([k, v]) => [k, rel(runDir, v)]).filter(([, v]) => v)) as ArtifactRefs; }
export async function recordDecision(input: { runDir: string; step?: Step; type: DecisionType; reason?: string; actor?: DecisionActor; attemptId?: string; now?: Date }): Promise<Decision> {
  const session = await loadSession(input.runDir); const step = input.step ?? await loadStep(input.runDir); const createdAt = nowIso(input.now); const decision: Decision = { schemaVersion: 1, decisionId: newId("decision"), createdAt, actor: input.actor ?? "human", type: input.type, reason: input.reason, stepId: step.stepId, attemptId: input.attemptId };
  const dir = stepDir(input.runDir, step); await writeJson(path.join(dir, "decisions", `${decision.createdAt.replace(/[:.]/g, "-")}-${decision.decisionId}.json`), decision); await writeJson(path.join(dir, "decision.json"), decision);
  step.decisionIds.push(decision.decisionId); step.decisionId = decision.decisionId; step.status = input.type === "accept" || input.type === "commit" ? "accepted" : input.type === "reject" || input.type === "abort" ? "rejected" : "open"; if (["accept","reject","abort","commit"].includes(input.type)) step.completedAt = createdAt; await persistStep(input.runDir, step);
  const nextStatus: SessionStatus = input.type === "accept" ? "ready_for_review" : input.type === "commit" ? "committed" : input.type === "abort" ? "aborted" : session.status; await persistSession(input.runDir, { ...session, status: nextStatus });
  await appendTimeline(input.runDir, { type: "decision.recorded", sessionId: session.sessionId, stepId: step.stepId, attemptId: input.attemptId, metadata: { decision: input.type, actor: decision.actor } }, createdAt);
  await appendTimeline(input.runDir, { type: "step.completed", sessionId: session.sessionId, stepId: step.stepId, metadata: { status: step.status } }, createdAt);
  if (nextStatus !== session.status) await appendTimeline(input.runDir, { type: "session.status_changed", sessionId: session.sessionId, metadata: { from: session.status, to: nextStatus } }, createdAt);
  await writeStepSummary(input.runDir, step, decision); return decision;
}
export async function writeStepSummary(runDir: string, step: Step, decision?: Decision): Promise<void> {
  const dir = stepDir(runDir, step); const attempts = await Promise.all(step.attempts.map(async id => { const attemptDirs = await import("node:fs/promises").then(fs => fs.readdir(path.join(dir, "attempts")).catch(() => [])); const match = attemptDirs.find(d => d.endsWith(`-${id}`)); return match ? readJson<Attempt>(path.join(dir, "attempts", match, "attempt.json")) : undefined; }));
  const lines = [`# Step ${step.order}: ${step.title}`, "", "## Goal", step.request, "", "## Attempts", ...attempts.filter(Boolean).map(a => `- Attempt ${a!.order} (${a!.attemptId}): ${a!.status}; changed files: ${a!.changedFiles.length ? a!.changedFiles.join(", ") : "none"}; validation: ${a!.validationSummary ?? "not recorded"}; error: ${a!.errorSummary ?? "none"}.`), "", "## Final decision", decision ? `${decision.type} by ${decision.actor}${decision.reason ? `: ${decision.reason}` : ""}` : "No decision recorded.", "", "## Known limitations", "- Summary is derived from JSON artifacts and timeline; JSON files remain authoritative.", ""];
  await writeFile(path.join(dir, "summary.md"), lines.join("\n"), "utf8");
}
export async function recordCommitEvent(runDir: string, metadata: Record<string, unknown>): Promise<void> { const s = await loadSession(runDir).catch(() => undefined); if (!s) return; await persistSession(runDir, { ...s, status: "committed" }); await appendTimeline(runDir, { type: "commit.created", sessionId: s.sessionId, metadata }); }
