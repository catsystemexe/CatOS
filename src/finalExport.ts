import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { buildUiTimeline, getUiRunStatus } from "./uiViewModel.js";
import { extractExpectedFiles, sanitizeUserVisibleText } from "./reportConsistency.js";

async function readJson(file: string): Promise<any> { try { return JSON.parse(await readFile(file, "utf8")); } catch { return undefined; } }
async function readText(file: string): Promise<string> { try { return await readFile(file, "utf8"); } catch { return ""; } }
function duration(start?: string, end?: string) { if (!start) return "-"; const a=Date.parse(start), b=end?Date.parse(end):Date.now(); return Number.isFinite(a)&&Number.isFinite(b)?`${Math.max(0,b-a)}ms`:"-"; }
function rel(runDir: string, p?: string) { if (!p) return undefined; return path.isAbsolute(p) ? path.relative(runDir, p) : p; }
function safeList(items?: string[], empty="- none") { return items?.length ? items.map(i=>`- ${i}`) : [empty]; }
function redact(s: unknown) {
  return sanitizeUserVisibleText(String(s ?? "").replace(/(?:OPENAI|CODEX|GITHUB|GH)_[A-Z0-9_]*=\S+/g, "SECRET=<redacted>"));
}
function clip(s: unknown, n=1200) { const t=redact(s).trim(); return t ? (t.length>n ? `${t.slice(0,n)}…` : t) : "-"; }
function githubFullName(remote?: string) { const m = String(remote ?? "").match(/github\.com[:\/]([^\s/]+\/[^\s/.]+)(?:\.git)?$/i); return m?.[1] ?? "-"; }
function statusSummary(status: string) { return status.split(/\n/).filter(Boolean).slice(0,20); }
const STEP_REPORTS = ["01_CODEX_REPORT.md", "02_VALIDATION_REPORT.md", "03_REVIEW_REPORT.md"] as const;

async function latestAttemptDir(runDir: string) {
  const rows = await buildUiTimeline(runDir, { includeFinal: false });
  const codex = rows[0];
  const codingPath = rel(runDir, codex?.output?.path);
  return codingPath ? path.dirname(path.join(runDir, codingPath)) : runDir;
}
async function artifactBundle(runDir: string) {
  const dir = await latestAttemptDir(runDir);
  const coding = await readJson(path.join(dir, "coding-result.json")) ?? await readJson(path.join(runDir, "coding-result.json"));
  const validation = await readJson(path.join(dir, "validation-report.json")) ?? await readJson(path.join(runDir, "validation-report.json"));
  const review = await readJson(path.join(dir, "review-report.json")) ?? await readJson(path.join(runDir, "review-report.json"));
  const taskBrief = await readJson(path.join(dir, "task-brief.json")) ?? await readJson(path.join(runDir, "task-brief.json"));
  const diff = await readText(path.join(dir, "workspace.diff")) || await readText(path.join(runDir, "workspace.diff"));
  const wsStatus = await readText(path.join(dir, "workspace-status.txt")) || await readText(path.join(runDir, "workspace-status.txt"));
  const runtime = await readJson(path.join(path.dirname(String(coding?.workspacePath ?? "")), "runtime", "runtime.json"));
  const runtimeError = await readJson(path.join(path.dirname(String(coding?.workspacePath ?? "")), "runtime", "codex-runtime-error.json"));
  return { dir, coding, validation, review, taskBrief, diff, wsStatus, runtime, runtimeError };
}

export async function ensureStepResultArtifacts(runDir: string): Promise<Array<{label:string;path:string;kind:"step-report";readable:true}>> {
  await mkdir(runDir,{recursive:true});
  const rows = await buildUiTimeline(runDir, { includeFinal: false });
  const input = await readJson(path.join(runDir,"input.json"));
  const { coding, validation, review, taskBrief, diff, wsStatus, runtime, runtimeError } = await artifactBundle(runDir);
  const codex = rows.find(r=>r.name==="CODEX");
  const validationRow = rows.find(r=>r.name==="VALIDATION");
  const reviewRow = rows.find(r=>r.name==="REVIEW");
  const changed = coding?.changedFiles ?? codex?.filesModified ?? [];
  const diffCheck = coding?.diffCheck ?? validation?.results?.find((r:any)=>/diff.*check/i.test(`${r.name} ${r.command}`));
  const commandLines = [runtime?.sdkOptions?.command, ...(Array.isArray(coding?.commands)?coding.commands:[])].filter(Boolean);
  const actions = [
    ...(commandLines.length ? commandLines.map((c:any)=>`- command: ${c}`) : []),
    ...(changed.length ? changed.map((f:string)=>`- changed file: ${f}`) : []),
    ...(coding?.finalResponse ? [`- final response recorded (${String(coding.finalResponse).length} chars)`] : []),
  ];
  const codexMd = ["# CODEX Report","","## Status",`- status: ${codex?.status ?? "waiting"}`,`- duration: ${codex?.durationMs ?? duration(codex?.startedAt,codex?.finishedAt)}`,"","## Task",input?.goal ?? input?.task ?? "-","","## Runtime",`- requested sandbox mode: ${coding?.sandboxMode ?? runtime?.sandboxModeRequested ?? "-"}`,`- effective sandbox mode or unconfirmed: ${runtime?.sandboxModeEffective ?? "unconfirmed"}`,`- approval policy: ${runtime?.approvalPolicy ?? "never"}`,`- workspace write-probe result: ${runtime?.workspaceWriteProbe ?? "-"}`,`- child cwd indicator: ${runtime?.childCwd ? "confirmed" : "unconfirmed"}`,...(runtimeError?[`- runtime error: ${clip(runtimeError.reason)}`]:[]),"","## Actions",...(actions.length?actions:["No structured action trace was produced."]),"","## Commands",...(commandLines.length?commandLines.map((c:any)=>`- ${c}`):["No structured action trace was produced."]),"","## Files","Created:",...safeList(changed),"","Modified:",...safeList([], "- none"),"","Deleted:",...safeList([], "- none"),"","## Workspace result",`- changed file count: ${changed.length}`,`- workspace diff is empty: ${diff.trim()?"false":"true"}`,"- workspace status summary:",...safeList(statusSummary(wsStatus)),`- diff-check result: ${diffCheck?.status ?? "not recorded"}`,"","## Final Codex response",sanitizeUserVisibleText(coding?.finalResponse ?? "-"),"","## Error",codex?.status === "failed" || runtimeError ? clip(JSON.stringify(runtimeError ?? { message: codex?.message }, null, 2), 2000) : "- none",""] .join("\n");
  await writeFile(path.join(runDir, STEP_REPORTS[0]), codexMd, "utf8");

  const checks = Array.isArray(validation?.results) ? validation.results : [];
  const checkMd = checks.length ? checks.flatMap((r:any)=>[`### ${r.name ?? "check"}`,`- state: ${r.status ?? "SKIPPED"}`,`- command: ${r.command ?? "-"}`,`- exit code: ${r.exitCode ?? "null"}`,`- duration: ${r.durationMs ?? "-"}`,`- concise stdout summary: ${clip(r.stdout,400)}`,`- concise stderr summary: ${clip(r.stderr,400)}`,""]) : ["No validation checks were recorded.",""];
  const validationMd = ["# VALIDATION Report","","## Status",`- status: ${validationRow?.status ?? validation?.status ?? "waiting"}`,`- duration: ${validationRow?.durationMs ?? duration(validation?.startedAt,validation?.finishedAt)}`,"","## Inputs",`- workspace from CODEX: ${coding?.workspacePath ? "available" : "not recorded"}`,`- changed files: ${changed.join(", ") || "none"}`,`- coding result: ${coding ? "available" : "missing"}`,`- validation configuration: ${checks.map((r:any)=>r.name).join(", ") || "not recorded"}`,"","## Checks",...checkMd,"## Task-output checks",...(diffCheck?["- git diff --check passes: "+(diffCheck.status==="PASS"?"yes":"no")]:["Repository checks completed; task acceptance was not verified by this step."]),"","## Result",validation?.status === "SKIPPED" ? "Repository checks were unavailable or skipped; validation result is SKIPPED, not failed." : `Validation outcome: ${validation?.status ?? "not recorded"}.`,"","## Error",validation?.error ? clip(JSON.stringify(validation.error,null,2), 2000) : "- none",""] .join("\n");
  await writeFile(path.join(runDir, STEP_REPORTS[1]), validationMd, "utf8");

  const criteria = review?.reviewedAcceptanceCriteria?.map((c:any)=>c.criterion) ?? taskBrief?.acceptanceCriteria ?? [];
  const expectedFiles = Array.from(new Set<string>([...(Array.isArray(taskBrief?.expectedFiles) ? taskBrief.expectedFiles.filter((f: unknown): f is string => typeof f === "string") : []), ...extractExpectedFiles(input?.goal ?? input?.task ?? taskBrief?.codexInstruction ?? "")]));
  const decision = review?.verdict === "REWORK" ? "REWORK" : review?.verdict === "HUMAN_REQUIRED" ? "HUMAN_REQUIRED" : review?.verdict === "ACCEPT" ? "ACCEPT" : "HUMAN_REQUIRED";
  const findings = [...(review?.blockingFindings?.map((f:any)=>`- ${f.title}: ${f.evidence}. Required: ${f.requiredChange}`) ?? []), ...(review?.warnings?.map((w:string)=>`- warning: ${w}`) ?? [])];
  const reviewMd = ["# REVIEW Report","","## Status",`- status: ${reviewRow?.status ?? "waiting"}`,`- duration: ${reviewRow?.durationMs ?? duration(reviewRow?.startedAt,reviewRow?.finishedAt)}`,"","## Expected files",...safeList(expectedFiles),"","## Acceptance criteria",...safeList(criteria),"","## Evidence inspected",`- coding result: ${coding ? "available" : "missing"}`,`- validation report: ${validation ? "available" : "missing"}`,`- workspace diff: ${diff.trim()?"available":"empty or missing"}`,`- workspace status: ${wsStatus.trim()?"available":"empty or missing"}`,`- expected output files: ${expectedFiles.join(", ") || "not derived"}`,`- actual changed files: ${changed.join(", ") || "none"}`,"","## Findings",...(findings.length?findings:["- No specific findings were recorded."]),"","## Decision",decision,"","## Reason",sanitizeUserVisibleText(review?.summary ?? "Review did not record a reason."),...(decision==="REWORK"?["","## Rework instructions",...(review?.blockingFindings?.length?review.blockingFindings.map((f:any)=>`- ${f.requiredChange}`):["- Address the blocking review findings and rerun validation."])]:[]),""] .join("\n");
  await writeFile(path.join(runDir, STEP_REPORTS[2]), reviewMd, "utf8");
  return STEP_REPORTS.map(label=>({label,path:label,kind:"step-report" as const,readable:true}));
}
export async function writeSessionReport(runDir: string): Promise<string> { return writeFinalReport(runDir); }
export async function writeFinalReport(runDir: string): Promise<string> {
  await ensureStepResultArtifacts(runDir);
  const [input, session, finalResult] = await Promise.all([readJson(path.join(runDir,"input.json")), readJson(path.join(runDir,"session.json")), readJson(path.join(runDir,"final-result.json"))]);
  const rows = await buildUiTimeline(runDir, { includeFinal: false });
  const status = finalResult?.status ?? await getUiRunStatus(runDir);
  const changed = finalResult?.finalChangedFiles ?? finalResult?.changedFiles?.map((f:any)=>f.path) ?? [];
  const md=["# AutoCodex Final Report","","## Run",`- run ID: ${session?.runId ?? input?.runId ?? finalResult?.runId ?? path.basename(runDir)}`,`- repository: ${session?.git?.remoteUrl ? githubFullName(session.git.remoteUrl) : input?.repositoryFullName ?? session?.git?.repositoryFullName ?? "-"}`,`- selected base branch: ${session?.git?.baseBranch ?? input?.baseBranch ?? "-"}`,`- run branch: ${session?.git?.runBranch ?? session?.branch ?? "-"}`,`- terminal status: ${status}`,`- duration: ${rows.reduce((a,r)=>a+(r.durationMs??0),0) || "-"}`,"","## Task",input?.goal ?? input?.task ?? session?.goal ?? "-","","## Steps",...rows.map(r=>[`### ${r.name}`,`- status: ${r.status}`,`- duration: ${r.durationMs ?? "-"}`,`- report: ${r.report?.path ?? "-"}`].join("\n")),"","## Changed files",...safeList(changed,"- none recorded"),"","## Result",finalResult?.terminalMessage ?? `Run ended with ${status}.`,"","## Error",finalResult?.error?clip(JSON.stringify(finalResult.error,null,2), 2000):"- none","","## Final response",sanitizeUserVisibleText(finalResult?.finalResponse ?? "-"),""] .join("\n");
  const out=path.join(runDir,"FINAL_REPORT.md"); await writeFile(out,md,"utf8"); return out;
}
