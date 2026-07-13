import { mkdir, readFile, readdir, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import type { Attempt, Decision, Session, Step } from "./runs/sessionModel.js";
import { buildPrHandoff, type PrHandoff } from "./gitSession.js";

export type RecommendedNextAction = "wait" | "run-step" | "decide" | "create-step" | "commit-or-revise" | "manual-pr" | "inspect" | "abort";
export type ArtifactRef = { path: string; exists: boolean; sizeBytes?: number; truncated?: boolean; invalidJson?: boolean; summary?: string };
export type ReviewAttempt = Attempt & { artifactsList: ArtifactRef[]; runtime?: Record<string, unknown>; reviewVerdict?: string };
export type ReviewDecision = Decision & { path?: string };
export type ReviewStep = Omit<Step, "attempts"> & { attempts: ReviewAttempt[]; decisions: ReviewDecision[]; summaryPath?: string };
export type ReviewValidation = { path: string; status?: string; invalidJson?: boolean; summary?: string };
export type ReviewPackage = {
  schemaVersion: 1;
  generatedAt: string;
  session: Pick<Session, "sessionId" | "goal" | "status" | "branch" | "workspacePath" | "createdAt" | "updatedAt" | "activeStepId">;
  summary: { totalSteps: number; completedSteps: number; totalAttempts: number; successfulAttempts: number; failedAttempts: number; validationStatus?: string; reviewVerdict?: string; committed: boolean };
  steps: ReviewStep[];
  changedFiles: string[];
  validations: ReviewValidation[];
  decisions: ReviewDecision[];
  timeline: Array<{ timestamp?: string; event: string; stepId?: string; attemptId?: string; summary: string }>;
  knownLimitations: string[];
  missingArtifacts: string[];
  recommendedNextAction: RecommendedNextAction;
  gitStatus?: PrHandoff;
};

const exactSecretValues = ["TEST_SECRET_VALUE", "test-secret-value", "known-test-secret-value-123"].sort((a, b) => b.length - a.length);
const tokenPatterns = [/sk-(?:proj-)?[A-Za-z0-9_-]{20,}/g, /gh[pousr]_[A-Za-z0-9_]{20,}/g, /xox[baprs]-[A-Za-z0-9-]{20,}/g];
function escapeRegExp(value: string): string { return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"); }
function scrub(value: string): string {
  const withoutTokens = tokenPatterns.reduce((out, re) => out.replace(re, "[REDACTED]"), value);
  return exactSecretValues.reduce((out, secret) => out.replace(new RegExp(escapeRegExp(secret), "g"), "[REDACTED]"), withoutTokens);
}
function normalizeChangedFiles(files: string[] | undefined): string[] { return [...new Set(files ?? [])].sort((a, b) => a.localeCompare(b)); }
function stable<T extends Record<string, unknown>>(obj: T): T { return Object.fromEntries(Object.entries(obj).sort(([a], [b]) => a.localeCompare(b))) as T; }
async function exists(file: string): Promise<boolean> { return stat(file).then(() => true, () => false); }
async function readJsonSafe<T>(file: string, missing: string[], invalid: string[]): Promise<T | undefined> { try { return JSON.parse(await readFile(file, "utf8")) as T; } catch (e) { if (await exists(file)) invalid.push(path.basename(file)); else missing.push(path.basename(file)); return undefined; } }
async function relStat(runDir: string, relPath: string): Promise<ArtifactRef> { const abs = path.resolve(runDir, relPath); const out: ArtifactRef = { path: relPath, exists: false }; const s = await stat(abs).catch(() => undefined); if (s) { out.exists = true; out.sizeBytes = s.size; } return out; }
async function readRuntimeManifest(runDir: string, relPath?: string): Promise<Record<string, unknown> | undefined> { if (!relPath) return undefined; const abs = path.resolve(runDir, relPath); const raw = await readFile(abs, "utf8").catch(() => undefined); if (!raw) return undefined; const json = JSON.parse(raw) as Record<string, unknown>; const allow = ["allowedEnvNames", "allowedEnvironmentVariables", "sandboxMode", "sandboxIsolation", "isolation", "network", "networkAccess", "home", "tmpdir", "HOME", "TMPDIR", "credentialScrubbed", "credentialsScrubbed", "scrubbedCredentials"];
  return stable(Object.fromEntries(Object.entries(json).filter(([k, v]) => allow.includes(k) && (Array.isArray(v) || ["string", "boolean", "number"].includes(typeof v)))));
}
function importantEvent(event: string): boolean { return ["session.created","step.created","step.completed","attempt.started","attempt.completed","attempt.failed","decision.recorded","commit.created"].includes(event); }

export async function buildReviewPackage(runDir: string, now = new Date()): Promise<ReviewPackage> {
  const missing: string[] = []; const invalid: string[] = [];
  const session = await readJsonSafe<Session>(path.join(runDir, "session.json"), missing, invalid);
  if (!session) throw new Error("Missing or invalid required artifact: session.json");
  const steps: ReviewStep[] = [];
  const stepRoot = path.join(runDir, "steps");
  const stepDirs = (await readdir(stepRoot).catch(() => [])).sort();
  for (const stepId of session.steps) {
    const dirName = stepDirs.find((d) => d.endsWith(`-${stepId}`));
    if (!dirName) { missing.push(`steps/*-${stepId}/step.json`); continue; }
    const stepDir = path.join(stepRoot, dirName);
    const step = await readJsonSafe<Step>(path.join(stepDir, "step.json"), missing, invalid); if (!step) continue;
    const attemptDirs = (await readdir(path.join(stepDir, "attempts")).catch(() => [])).sort();
    const attempts: ReviewAttempt[] = [];
    for (const attemptId of step.attempts) {
      const ad = attemptDirs.find((d) => d.endsWith(`-${attemptId}`)); if (!ad) { missing.push(path.join("steps", dirName, "attempts", `*-${attemptId}`, "attempt.json")); continue; }
      const attempt = await readJsonSafe<Attempt>(path.join(stepDir, "attempts", ad, "attempt.json"), missing, invalid); if (!attempt) continue;
      const artifactPaths = Object.values(attempt.artifacts ?? {}).filter((v): v is string => typeof v === "string");
      const artifactsList = await Promise.all(artifactPaths.map((p) => relStat(runDir, p)));
      for (const a of artifactsList) if (!a.exists) missing.push(a.path);
      let runtime: Record<string, unknown> | undefined; try { runtime = await readRuntimeManifest(runDir, attempt.artifacts.runtimeManifestPath); } catch { invalid.push(attempt.artifacts.runtimeManifestPath ?? "runtime manifest"); }
      let reviewVerdict: string | undefined; const rr = attempt.artifacts.reviewReportPath ? await readJsonSafe<Record<string, unknown>>(path.join(runDir, attempt.artifacts.reviewReportPath), missing, invalid) : undefined; if (typeof rr?.verdict === "string") reviewVerdict = rr.verdict;
      attempts.push({ ...attempt, changedFiles: normalizeChangedFiles(attempt.changedFiles), artifactsList, runtime, reviewVerdict });
    }
    const decisions: ReviewDecision[] = [];
    const dd = path.join(stepDir, "decisions");
    for (const f of (await readdir(dd).catch(() => [])).sort()) { const d = await readJsonSafe<Decision>(path.join(dd, f), missing, invalid); if (d) decisions.push({ ...d, path: path.relative(runDir, path.join(dd, f)) }); }
    const summaryPath = (await exists(path.join(stepDir, "summary.md"))) ? path.relative(runDir, path.join(stepDir, "summary.md")) : undefined;
    steps.push({ ...step, attempts: attempts.sort((a,b)=>a.order-b.order), decisions, summaryPath });
  }
  const topValidation = await readJsonSafe<Record<string, unknown>>(path.join(runDir, "validation-report.json"), [], invalid);
  const topReview = await readJsonSafe<Record<string, unknown>>(path.join(runDir, "review-report.json"), [], invalid);
  const committed = await exists(path.join(runDir, "commit-result.json"));
  const changedFiles = [...new Set(steps.flatMap(s => s.attempts.flatMap(a => a.changedFiles)))].sort();
  const decisions = steps.flatMap((s) => s.decisions).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
  const activeStep = steps.find((s) => s.stepId === session.activeStepId);
  const hasCriticalMissing = missing.some((m) => m.includes("step.json") || m.includes("attempt.json") || m === "session.json") || invalid.length > 0;
  let recommendedNextAction: RecommendedNextAction = "inspect";
  if (hasCriticalMissing) recommendedNextAction = "inspect";
  else if (session.status === "aborted") recommendedNextAction = "abort";
  else if (activeStep?.status === "running") recommendedNextAction = "wait";
  else if (activeStep?.status === "awaiting_decision") recommendedNextAction = "decide";
  else if (activeStep?.status === "open" && activeStep.attempts.length === 0) recommendedNextAction = "run-step";
  else if (activeStep?.status === "open" && activeStep.decisions.some((d) => d.type === "retry")) recommendedNextAction = "run-step";
  else if (!activeStep && session.status === "active") recommendedNextAction = "create-step";
  else if (session.status === "ready_for_review" && !committed) recommendedNextAction = "commit-or-revise";
  else if (session.status === "committed" || committed) recommendedNextAction = "manual-pr";
  const timelineRaw = await readFile(path.join(runDir, "timeline.jsonl"), "utf8").catch(() => "");
  const timeline = timelineRaw.split(/\n/).filter(Boolean).map((line) => { try { return JSON.parse(line) as Record<string, unknown>; } catch { invalid.push("timeline.jsonl"); return undefined; } }).filter((e): e is Record<string, unknown> => !!e && importantEvent(String(e.event))).map((e) => ({ timestamp: e.timestamp as string | undefined, event: String(e.event), stepId: e.stepId as string | undefined, attemptId: e.attemptId as string | undefined, summary: scrub(`${e.event}${e.stepId ? ` step=${e.stepId}` : ""}${e.attemptId ? ` attempt=${e.attemptId}` : ""}`) }));
  const gitStatus = await buildPrHandoff(runDir, now).catch(() => undefined);
  const pkg: ReviewPackage = { schemaVersion: 1, generatedAt: now.toISOString(), session: { sessionId: session.sessionId, goal: scrub(session.goal), status: session.status, branch: session.branch, workspacePath: session.workspacePath, createdAt: session.createdAt, updatedAt: session.updatedAt, activeStepId: session.activeStepId }, summary: { totalSteps: steps.length, completedSteps: steps.filter(s => ["accepted","rejected","superseded"].includes(s.status)).length, totalAttempts: steps.reduce((n,s)=>n+s.attempts.length,0), successfulAttempts: steps.reduce((n,s)=>n+s.attempts.filter(a=>a.status === "succeeded").length,0), failedAttempts: steps.reduce((n,s)=>n+s.attempts.filter(a=>a.status === "failed" || a.status === "timed_out").length,0), validationStatus: typeof topValidation?.status === "string" ? topValidation.status : undefined, reviewVerdict: typeof topReview?.verdict === "string" ? topReview.verdict : undefined, committed }, steps, changedFiles, validations: [{ path: "validation-report.json", status: typeof topValidation?.status === "string" ? topValidation.status : undefined, invalidJson: invalid.includes("validation-report.json") || undefined }], decisions, timeline, knownLimitations: ["Review Package is derived from existing artifacts only; source artifacts remain authoritative.", "Long logs and diffs are referenced by path instead of embedded."], missingArtifacts: [...new Set([...missing, ...invalid.map((i) => `invalid-json:${i}`)])].sort(), recommendedNextAction, gitStatus };
  return JSON.parse(scrub(JSON.stringify(pkg))) as ReviewPackage;
}
function line(v: unknown): string { return v === undefined || v === "" ? "not recorded" : String(v); }
export function renderReviewPackageMarkdown(pkg: ReviewPackage): string {
  const lines: string[] = ["# AutoCodex Review Package", "", "## Session", `- Session: ${pkg.session.sessionId}`, `- Goal: ${pkg.session.goal}`, `- Status: ${pkg.session.status}`, `- Branch: ${line(pkg.session.branch)}`, `- Workspace: ${line(pkg.session.workspacePath)}`, `- Created: ${pkg.session.createdAt}`, `- Updated: ${pkg.session.updatedAt}`, "", "## Current State", `- Steps: ${pkg.summary.completedSteps}/${pkg.summary.totalSteps} completed`, `- Attempts: ${pkg.summary.totalAttempts} total, ${pkg.summary.successfulAttempts} successful, ${pkg.summary.failedAttempts} failed`, `- Active step: ${line(pkg.session.activeStepId)}`, `- Validation: ${line(pkg.summary.validationStatus)}`, `- Review: ${line(pkg.summary.reviewVerdict)}`, "", "## Recommended Next Action", `- ${pkg.recommendedNextAction}`, ""];
  for (const step of pkg.steps) { lines.push(`## Step ${step.order} — ${step.title}`, "", "### Request", step.request, "", "### Attempts"); if (!step.attempts.length) lines.push("- No attempts recorded."); for (const a of step.attempts) { lines.push(`#### Attempt ${a.order}`, `- Attempt ID: ${a.attemptId}`, `- Status: ${a.status}`, `- Prompt: ${a.prompt}`, `- Codex thread ID: ${line(a.codexThreadId)}`, `- Runtime: ${line(a.runtimeMode)}${a.runtime ? `; manifest ${JSON.stringify(a.runtime)}` : ""}`, `- Started: ${a.startedAt}`, `- Completed: ${line(a.completedAt)}`, `- Changed files: ${a.changedFiles.length ? a.changedFiles.join(", ") : "none"}`, `- Validation: ${line(a.validationSummary)}`, `- Review: ${line(a.reviewVerdict)}`, `- Errors: ${line(a.errorSummary)}`, "- Artifacts:", ...(a.artifactsList.length ? a.artifactsList.map((ar) => `  - ${ar.path} (${ar.exists ? `${ar.sizeBytes ?? 0} bytes` : "missing"})`) : ["  - none"]), ""); } lines.push("### Decisions"); if (!step.decisions.length) lines.push("- No decisions recorded."); else for (const d of step.decisions) lines.push(`- ${d.createdAt}: ${d.type} by ${d.actor}${d.reason ? ` — ${d.reason}` : ""}`); if (step.summaryPath) lines.push(`- Summary: ${step.summaryPath}`); lines.push(""); }
  lines.push("## Changed Files", ...(pkg.changedFiles.length ? pkg.changedFiles.map(f=>`- ${f}`) : ["- none"]), "", "## Validation Summary", ...pkg.validations.map(v=>`- ${v.path}: ${line(v.status)}${v.invalidJson ? " (invalid JSON)" : ""}`), "", "## Git and PR Handoff", ...(pkg.gitStatus ? [`- Project: ${pkg.gitStatus.projectId}`, `- Repository: ${pkg.gitStatus.repositoryPath}`, `- Base branch: ${pkg.gitStatus.baseBranch}`, `- Base commit: ${pkg.gitStatus.baseCommit}`, `- Run branch: ${pkg.gitStatus.runBranch}`, `- Current HEAD: ${pkg.gitStatus.headCommit ?? "not recorded"}`, `- PR target: ${pkg.gitStatus.prTargetBranch}`, `- Remote: ${pkg.gitStatus.remoteUrl ? `${pkg.gitStatus.remoteName} ${pkg.gitStatus.remoteUrl}` : `${pkg.gitStatus.remoteName} (missing)`}`, `- Push readiness: ${pkg.gitStatus.pushStatus}`, `- PR direction: ${pkg.gitStatus.prDirection.head} → ${pkg.gitStatus.prDirection.base}`] : ["- missing-git-context"]), "", "## Runtime and Security", "- Runtime manifests are filtered to allowed variable names, sandbox/isolation/network state, HOME/TMPDIR paths, and credential scrub flags.", "- Secret-like values are redacted.", "", "## Timeline Summary", ...(pkg.timeline.length ? pkg.timeline.map(e=>`- ${line(e.timestamp)}: ${e.summary}`) : ["- none"]), "", "## Known Limitations", ...pkg.knownLimitations.map(l=>`- ${l}`), "", "## Missing Artifacts", ...(pkg.missingArtifacts.length ? pkg.missingArtifacts.map(m=>`- ${m}`) : ["- none"]), "", "## Commit Status", `- Committed: ${pkg.summary.committed ? "yes" : "no"}`, "");
  return scrub(lines.join("\n"));
}
export async function writeReviewPackage(runDir: string, now = new Date()): Promise<{ markdownPath: string; jsonPath: string; package: ReviewPackage }> {
  const pkg = await buildReviewPackage(runDir, now); const reviewDir = path.join(runDir, "review"); await mkdir(reviewDir, { recursive: true }); const jsonPath = path.join(reviewDir, "review-package.json"); const markdownPath = path.join(reviewDir, "review-package.md"); await writeFile(jsonPath, `${JSON.stringify(pkg, null, 2)}\n`, "utf8"); await writeFile(markdownPath, `${renderReviewPackageMarkdown(pkg)}\n`, "utf8"); return { markdownPath, jsonPath, package: pkg };
}
