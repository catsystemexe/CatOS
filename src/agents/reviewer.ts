import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { reviewReportSchema, type ReviewReport, type ReviewVerdict } from "../schemas/reviewReport.js";
import type { TaskInput } from "../schemas/taskInput.js";
import type { TaskBrief } from "../schemas/taskBrief.js";
import type { CodingResult } from "../codingWorker.js";
import type { ValidationReport } from "../validationRunner.js";
import type { ProjectConfig } from "../config/projectConfigSchema.js";
import type { ReworkPackage } from "../schemas/reworkPackage.js";

export const DEFAULT_REVIEW_PACKAGE_MAX_BYTES = 512_000;

export type ReviewerInput = {
  taskInput: TaskInput;
  taskBrief: TaskBrief;
  codingResult: Omit<CodingResult, "diff" | "status">;
  workspaceDiff: string;
  workspaceStatus: string;
  validationReport: ValidationReport;
  projectConstraints: Pick<ProjectConfig, "permissions" | "workflow" | "codex">;
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
  const maxPackageBytes = options.maxPackageBytes ?? DEFAULT_REVIEW_PACKAGE_MAX_BYTES;
  const packageBytes = estimatePackageBytes(input);
  if (packageBytes > maxPackageBytes) {
    return humanRequiredForOversizedPackage(packageBytes, maxPackageBytes);
  }

  const provider = options.provider ?? createOpenAIReviewerProvider({ apiKey: options.apiKey, model: options.model });
  const output = await provider.review(input);
  const parsed = reviewReportSchema.safeParse(output);
  if (!parsed.success) {
    throw new ReviewReportValidationError(`Reviewer returned invalid ReviewReport: ${parsed.error.message}`);
  }

  if (!isVerdictAllowed(input.validationReport.status, parsed.data.verdict)) {
    throw new ReviewReportValidationError(`Reviewer verdict ${parsed.data.verdict} is not allowed when validation status is ${input.validationReport.status}.`);
  }

  return parsed.data;
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

  return { taskInput, taskBrief, codingResult, workspaceDiff, workspaceStatus, validationReport, projectConstraints };
}

async function readJson<T>(filePath: string): Promise<T> {
  return JSON.parse(await readFile(filePath, "utf8")) as T;
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
          "Treat CodingResult.finalResponse only as non-authoritative context. The decisive evidence is the original TaskInput, TaskBrief, workspace.diff, workspace-status.txt, validation-report.json, reworkContext when present, and project constraints.",
          "Do not claim evidence that is not present in those inputs.",
        ].join("\n"),
        tools: [],
        outputType: reviewReportSchema,
      });

      const result = await run(agent, `Review this CatOS change package:\n${JSON.stringify(input, null, 2)}`);
      return result.finalOutput;
    },
  };
}
