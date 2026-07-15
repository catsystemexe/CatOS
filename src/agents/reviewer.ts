import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { reviewReportSchema, type ReviewReport, type ReviewVerdict } from "../schemas/reviewReport.js";
import type { TaskInput } from "../schemas/taskInput.js";
import type { TaskBrief } from "../schemas/taskBrief.js";
import type { CodingResult } from "../codingWorker.js";
import type { WorkspaceDiffCheck } from "../gitWorkspaceState.js";
import type { ValidationReport } from "../validationRunner.js";
import type { ProjectConfig } from "../config/projectConfigSchema.js";
import type { ReworkPackage } from "../schemas/reworkPackage.js";

export const DEFAULT_REVIEW_PACKAGE_MAX_BYTES = 512_000;

export type SafeReviewCodingResult = Pick<CodingResult, "threadId" | "finalResponse" | "workspacePath" | "changedFiles" | "sandboxMode" | "sandboxIsolation"> & {
  diffCheck?: WorkspaceDiffCheck;
};

export type NormalizedDiffCheckEvidence = {
  kind: "git-diff-check";
  command: "git diff --check";
  normalizedState: "SATISFIED" | "NOT_SATISFIED" | "UNCERTAIN";
  status: "PASS" | "FAIL" | "BLOCKED" | "MISSING";
  commandRan: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs?: number;
  limitation?: string;
  evidence: string;
};

export type ReviewerInput = {
  taskInput: TaskInput;
  taskBrief: TaskBrief;
  codingResult: SafeReviewCodingResult;
  workspaceDiff: string;
  workspaceStatus: string;
  validationReport: ValidationReport;
  projectConstraints: Pick<ProjectConfig, "permissions" | "workflow" | "codex">;
  structuredEvidence?: {
    diffCheck: NormalizedDiffCheckEvidence;
    evidencePrecedence: string[];
  };
  reworkContext?: {
    reworkPackage: ReworkPackage;
    previousBlockingFindings: ReworkPackage["blockingFindings"];
    requiredChanges: string[];
    reworkReason: string;
  };
};

export interface ReviewerProvider {
  review(input: ReviewerInput): Promise<unknown>;
}

export type ReviewTaskOptions = {
  provider?: ReviewerProvider;
  apiKey?: string;
  model?: string;
  maxPackageBytes?: number;
};

export class ReviewReportValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReviewReportValidationError";
  }
}


export function safeReviewCodingResult(codingResult: CodingResult): SafeReviewCodingResult {
  return {
    threadId: codingResult.threadId,
    finalResponse: codingResult.finalResponse,
    workspacePath: codingResult.workspacePath,
    changedFiles: codingResult.changedFiles,
    sandboxMode: codingResult.sandboxMode,
    sandboxIsolation: codingResult.sandboxIsolation,
    diffCheck: codingResult.diffCheck,
  };
}

export function normalizeDiffCheckEvidence(diffCheck?: WorkspaceDiffCheck): NormalizedDiffCheckEvidence {
  if (!diffCheck) {
    return {
      kind: "git-diff-check",
      command: "git diff --check",
      normalizedState: "UNCERTAIN",
      status: "MISSING",
      commandRan: false,
      exitCode: null,
      stdout: "",
      stderr: "",
      evidence: "No structured coordinator diffCheck result is present; do not invent PASS.",
    };
  }
  const stdout = diffCheck.stdout ?? "";
  const stderr = diffCheck.stderr ?? "";
  if (diffCheck.status === "PASS") {
    return {
      kind: "git-diff-check",
      command: diffCheck.command,
      normalizedState: "SATISFIED",
      status: "PASS",
      commandRan: true,
      exitCode: diffCheck.exitCode,
      stdout,
      stderr,
      durationMs: diffCheck.durationMs,
      limitation: diffCheck.limitation,
      evidence: `Coordinator diffCheck status PASS, command ${diffCheck.command}, exit code ${diffCheck.exitCode}.`,
    };
  }
  if (diffCheck.status === "FAIL") {
    const detail = [stderr, stdout].filter(Boolean).join("\n").trim();
    return {
      kind: "git-diff-check",
      command: diffCheck.command,
      normalizedState: "NOT_SATISFIED",
      status: "FAIL",
      commandRan: true,
      exitCode: diffCheck.exitCode,
      stdout,
      stderr,
      durationMs: diffCheck.durationMs,
      limitation: diffCheck.limitation,
      evidence: `Coordinator diffCheck status FAIL, command ${diffCheck.command}, exit code ${diffCheck.exitCode}${detail ? `: ${detail}` : "."}`,
    };
  }
  return {
    kind: "git-diff-check",
    command: diffCheck.command,
    normalizedState: "UNCERTAIN",
    status: "BLOCKED",
    commandRan: false,
    exitCode: diffCheck.exitCode,
    stdout,
    stderr,
    durationMs: diffCheck.durationMs,
    limitation: diffCheck.limitation,
    evidence: `Coordinator diffCheck status BLOCKED, command ${diffCheck.command}; success was not established${stderr ? `: ${stderr}` : "."}`,
  };
}

function withStructuredEvidence(input: ReviewerInput): ReviewerInput {
  const diffCheck = input.structuredEvidence?.diffCheck ?? normalizeDiffCheckEvidence(input.codingResult.diffCheck);
  return {
    ...input,
    structuredEvidence: {
      diffCheck,
      evidencePrecedence: [
        "Structured coordinator evidence (codingResult.diffCheck, changed-file list, workspace/runtime metadata).",
        "Validation evidence (validation-report.json, configured command results, task-output checks).",
        "Workspace evidence (workspace.diff, workspace-status.txt, actual changed files).",
        "Coding natural-language claims (codingResult.finalResponse).",
      ],
    },
  };
}

function isDiffCheckCriterion(criterion: string): boolean {
  return /git\s+diff\s+--check|diff[- ]check|no whitespace errors|clean patch/i.test(criterion);
}

export function reconcileDiffCheckReview(report: ReviewReport, diffCheck?: WorkspaceDiffCheck): ReviewReport {
  const normalized = normalizeDiffCheckEvidence(diffCheck);
  if (normalized.status === "MISSING") return report;
  let changed = false;
  const hasBlockingDiffFinding = report.blockingFindings.some((f) => /git\s+diff\s+--check|diff[- ]check|whitespace/i.test(`${f.id} ${f.title} ${f.evidence}`));
  const reviewedAcceptanceCriteria = report.reviewedAcceptanceCriteria.map((criterion) => {
    if (!isDiffCheckCriterion(criterion.criterion)) return criterion;
    if (normalized.status === "PASS" && criterion.status !== "SATISFIED") {
      changed = true;
      return { ...criterion, status: "SATISFIED" as const, evidence: `${normalized.evidence}${normalized.limitation ? ` Limitation: ${normalized.limitation}` : ""}` };
    }
    if (normalized.status === "FAIL" && criterion.status === "SATISFIED") {
      changed = true;
      return { ...criterion, status: "NOT_SATISFIED" as const, evidence: normalized.evidence };
    }
    if (normalized.status === "BLOCKED" && criterion.status === "SATISFIED") {
      changed = true;
      return { ...criterion, status: "UNCERTAIN" as const, evidence: normalized.evidence };
    }
    return criterion;
  });
  const blockingFindings = [...report.blockingFindings];
  if (normalized.status === "FAIL" && reviewedAcceptanceCriteria.some((c) => isDiffCheckCriterion(c.criterion)) && !hasBlockingDiffFinding) {
    changed = true;
    blockingFindings.push({
      id: "structured-diff-check-failed",
      title: "Structured git diff --check failed",
      evidence: normalized.evidence,
      requiredChange: "Fix whitespace or patch errors reported by git diff --check before final acceptance.",
    });
  }
  if (!changed) return report;
  const verdict = report.verdict === "ACCEPT" && blockingFindings.length > 0 ? "REWORK" : report.verdict;
  return { ...report, verdict, reviewedAcceptanceCriteria, blockingFindings };
}

function estimatePackageBytes(input: ReviewerInput): number {
  return Buffer.byteLength(JSON.stringify(input), "utf8");
}

function humanRequiredForOversizedPackage(size: number, limit: number): ReviewReport {
  return {
    schemaVersion: 1,
    verdict: "HUMAN_REQUIRED",
    summary: `Review package is too large for MVP Reviewer (${size} bytes > ${limit} bytes). Human review is required instead of silently truncating context.`,
    reviewedAcceptanceCriteria: [],
    blockingFindings: [
      {
        id: "review-package-too-large",
        title: "Review package exceeds configured size limit",
        evidence: `The assembled review package is ${size} bytes, exceeding the ${limit} byte limit.`,
        requiredChange: "Reduce the diff size or add a future Context Assembler before automated review.",
      },
    ],
    warnings: [],
  };
}

function isVerdictAllowed(validationStatus: ValidationReport["status"], verdict: ReviewVerdict): boolean {
  if ((validationStatus === "FAIL" || validationStatus === "BLOCKED") && verdict === "ACCEPT") return false;
  return true;
}

export async function reviewChange(input: ReviewerInput, options: ReviewTaskOptions = {}): Promise<ReviewReport> {
  const reviewInput = withStructuredEvidence(input);
  const maxPackageBytes = options.maxPackageBytes ?? DEFAULT_REVIEW_PACKAGE_MAX_BYTES;
  const packageBytes = estimatePackageBytes(reviewInput);
  if (packageBytes > maxPackageBytes) {
    return humanRequiredForOversizedPackage(packageBytes, maxPackageBytes);
  }

  const provider = options.provider ?? createOpenAIReviewerProvider({ apiKey: options.apiKey, model: options.model });
  const output = await provider.review(reviewInput);
  const parsed = reviewReportSchema.safeParse(output);
  if (!parsed.success) {
    throw new ReviewReportValidationError(`Reviewer returned invalid ReviewReport: ${parsed.error.message}`);
  }

  const reconciled = reconcileDiffCheckReview(parsed.data, reviewInput.codingResult.diffCheck);

  if (!isVerdictAllowed(reviewInput.validationReport.status, reconciled.verdict)) {
    throw new ReviewReportValidationError(`Reviewer verdict ${reconciled.verdict} is not allowed when validation status is ${reviewInput.validationReport.status}.`);
  }

  return reconciled;
}

export async function buildReviewerInputFromRunArtifacts(runDir: string, projectConstraints: ReviewerInput["projectConstraints"]): Promise<ReviewerInput> {
  const [taskInput, taskBrief, codingResult, workspaceDiff, workspaceStatus, validationReport] = await Promise.all([
    readJson<TaskInput>(path.join(runDir, "input.json")),
    readJson<TaskBrief>(path.join(runDir, "task-brief.json")),
    readJson<Omit<CodingResult, "diff" | "status"> & { schemaVersion?: 1 }>(path.join(runDir, "coding-result.json")),
    readFile(path.join(runDir, "workspace.diff"), "utf8"),
    readFile(path.join(runDir, "workspace-status.txt"), "utf8"),
    readJson<ValidationReport>(path.join(runDir, "validation-report.json")),
  ]);

  return withStructuredEvidence({ taskInput, taskBrief, codingResult, workspaceDiff, workspaceStatus, validationReport, projectConstraints });
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
}



function redactPromptSecrets(value: string): string {
  return value
    .replace(/sk-[A-Za-z0-9_-]{12,}/g, "[REDACTED]")
    .replace(/(authorization\s*[:=]\s*bearer\s+)[^\s"']+/gi, "$1[REDACTED]")
    .replace(/(api[_-]?key\s*[:=]\s*)[^\s"']+/gi, "$1[REDACTED]");
}

export function buildReviewPrompt(input: ReviewerInput): string {
  const reviewInput = withStructuredEvidence(input);
  const d = reviewInput.structuredEvidence!.diffCheck;
  const stdout = d.stdout.trim() ? d.stdout : "empty";
  const stderr = d.stderr.trim() ? d.stderr : "empty";
  return [
    "Review this CatOS change package.",
    "",
    "# Structured coordinator evidence",
    "",
    "## Git diff check",
    "",
    `- command: ${d.command}`,
    `- status: ${d.status}`,
    `- normalized state: ${d.normalizedState}`,
    `- command ran: ${d.commandRan ? "yes" : "no"}`,
    `- exit code: ${d.exitCode ?? "null"}`,
    `- stdout: ${stdout}`,
    `- stderr: ${stderr}`,
    ...(d.limitation ? [`- limitation: ${d.limitation}`] : []),
    "",
    "This evidence was produced by the coordinator, not by Coding prose.",
    "It is authoritative for whether git diff --check ran and for its exit status.",
    "Validation being SKIPPED does not erase this independent coordinator evidence.",
    "The limitation must still be considered when evaluating untracked files or content not covered by git diff --check.",
    "",
    "## Evidence precedence",
    "",
    "When evidence conflicts, use this order:",
    "1. Structured coordinator evidence.",
    "2. Validation evidence.",
    "3. Workspace diff/status evidence.",
    "4. Coding natural-language claims.",
    "",
    "Natural-language claims must never override contradictory structured evidence.",
    "A structured PASS may satisfy a git diff --check criterion even when the command is not duplicated as a configured Validation script.",
    "A Validation status of SKIPPED must not invalidate an independent coordinator diff-check PASS.",
    "",
    "# Full review package",
    "",
    redactPromptSecrets(JSON.stringify(reviewInput, null, 2)),
  ].join("\n");
}

export async function writeReviewReport(runDir: string, report: ReviewReport): Promise<string> {
  const parsed = reviewReportSchema.parse(report);
  await mkdir(runDir, { recursive: true });
  const reportPath = path.join(runDir, "review-report.json");
  await writeFile(reportPath, `${JSON.stringify(parsed, null, 2)}\n`, "utf8");
  return reportPath;
}

export function createOpenAIReviewerProvider(options: { apiKey?: string; model?: string } = {}): ReviewerProvider {
  const apiKey = options.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("Chybí OPENAI_API_KEY pro Reviewer agenta.");
  }

  return {
    async review(input: ReviewerInput): Promise<unknown> {
      const { Agent, run, setDefaultOpenAIKey } = await import("@openai/agents");
      setDefaultOpenAIKey(apiKey);

      const agent = new Agent({
        name: "CatOS Reviewer",
        model: options.model ?? process.env.CATOS_REVIEWER_MODEL ?? process.env.CATOS_TASK_ANALYST_MODEL ?? "gpt-5.5",
        instructions: [
          "You are the CatOS Reviewer. Qualitatively review the submitted code change after deterministic validation.",
          "You have no shell access, no filesystem tools, and no ability to modify the repository. Use only the provided review package.",
          "Return only structured output matching the ReviewReport schema.",
          "Review verdicts are ACCEPT, REWORK, or HUMAN_REQUIRED. Never return FAIL; FAIL is a Validation Runner status, not a review verdict.",
          "Validation status PASS/FAIL/BLOCKED is evidence, but the final review must also consider the task, acceptance criteria, diff, workspace status, and validation report.",
          "If validation status is FAIL or BLOCKED, ACCEPT is forbidden. Use REWORK for clear implementation or validation failures, or HUMAN_REQUIRED when a human decision/environment intervention is needed.",
          "When reviewing scope, compare TaskBrief, prior validation failure evidence when this is a rework, the current validation report, the current diff, and explicit nonGoals. Do not compare only changed file names against the literal original task text.",
          "A supporting file or other supporting change required by acceptance criteria, validation output, existing project configuration, or existing tests can be a legitimate part of the solution even if the original task did not name that file explicitly.",
          "If validationReport.status is PASS, all acceptance criteria are satisfied, a change fixes a concrete previous validation failure or previous blocking finding, no explicit TaskBrief.nonGoals are violated, and there are no other blocking findings, return ACCEPT rather than REWORK.",
          "For rework reviews, use reworkContext when present: it contains previous blocking findings, required changes, and the reason for the current rework. Treat changes made in direct response to that context as in scope unless they violate nonGoals or create another blocking issue.",
          "You may flag a new file as a scope violation only when it lacks a defensible link to acceptance criteria, validation output, existing project configuration/tests, or the reworkContext, or when it violates an explicit nonGoal.",
          "Treat CodingResult.finalResponse only as non-authoritative context. Natural-language claims never override contradictory structured coordinator evidence.",
          "Structured coordinator evidence has highest precedence. A coordinator diffCheck PASS can satisfy git diff --check even when Validation is SKIPPED; a FAIL is blocking when a clean diff is required; BLOCKED or missing evidence is never PASS.",
          "Do not claim evidence that is not present in those inputs.",
        ].join("\n"),
        tools: [],
        outputType: reviewReportSchema,
      });

      const result = await run(agent, buildReviewPrompt(input));
      return result.finalOutput;
    },
  };
}
