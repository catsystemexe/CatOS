import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";

export const EXECUTION_PLAN_SCHEMA_VERSION = 1 as const;
export const validationPolicies = ["required", "optional", "not-applicable"] as const;
export type ValidationPolicy = typeof validationPolicies[number];

export type PlannedStep = {
  id: string;
  sequence: number;
  title: string;
  instruction: string;
  acceptanceCriteria: string[];
  expectedArtifacts: string[];
  validationPolicy: ValidationPolicy;
  dependsOn: string[];
  constraints?: string[];
};

export type ExecutionPlan = {
  schemaVersion: 1;
  objective: string;
  originalTask: string;
  steps: PlannedStep[];
};

export type StepStatus = "PENDING" | "RUNNING" | "REWORK" | "ACCEPTED" | "HUMAN_REQUIRED" | "FAILED" | "STOPPED";
export type StepReviewVerdict = "ACCEPT_STEP" | "REWORK_STEP" | "HUMAN_REQUIRED" | "STOP";

export type StepState = {
  schemaVersion: 1;
  stepId: string;
  sequence: number;
  status: StepStatus;
  activeAttempt?: number;
  acceptedAttempt?: number;
  startedAt?: string;
  finishedAt?: string;
  lastReviewVerdict?: StepReviewVerdict;
  dependencies: Record<string, "PENDING" | "ACCEPTED" | "MISSING">;
  error?: string;
};

export type StepResult = {
  schemaVersion: 1;
  stepId: string;
  sequence: number;
  title: string;
  status: "ACCEPTED";
  acceptedAttempt: number;
  summary: string;
  acceptedArtifacts: string[];
  codingReportPath: string;
  validationReportPath?: string;
  reviewReportPath: string;
  acceptedAt: string;
  evidence?: { changedFiles: string[]; diffCheckStatus?: string };
};

export function sanitizeStepSlug(step: Pick<PlannedStep, "sequence" | "id" | "title">): string {
  const base = (step.id || step.title || `step-${step.sequence}`).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || `step-${step.sequence}`;
  return `${String(step.sequence).padStart(3, "0")}-${base}`;
}

function asStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array.`);
  const strings = value.map((item) => typeof item === "string" ? item.trim() : "").filter(Boolean);
  if (strings.length !== value.length) throw new Error(`${field} must contain only non-empty strings.`);
  return strings;
}

export function normalizeExecutionPlan(value: unknown, fallbackOriginalTask?: string): ExecutionPlan {
  if (!value || typeof value !== "object") throw new Error("ExecutionPlan must be an object.");
  const input = value as Record<string, unknown>;
  if (input.schemaVersion !== 1) throw new Error("ExecutionPlan.schemaVersion must be 1.");
  const objective = typeof input.objective === "string" ? input.objective.trim() : "";
  const originalTask = typeof input.originalTask === "string" ? input.originalTask : (fallbackOriginalTask ?? "");
  if (!objective) throw new Error("ExecutionPlan.objective must be non-empty.");
  if (!originalTask.trim()) throw new Error("ExecutionPlan.originalTask must be non-empty and independent from TaskBrief.");
  if (!Array.isArray(input.steps) || input.steps.length === 0) throw new Error("ExecutionPlan.steps must not be empty.");
  const steps = input.steps.map((raw, index): PlannedStep => {
    if (!raw || typeof raw !== "object") throw new Error(`Step ${index + 1} must be an object.`);
    const s = raw as Record<string, unknown>;
    const id = typeof s.id === "string" ? s.id.trim() : "";
    const title = typeof s.title === "string" ? s.title.trim() : "";
    const instruction = typeof s.instruction === "string" ? s.instruction.trim() : "";
    const sequence = typeof s.sequence === "number" && Number.isInteger(s.sequence) ? s.sequence : NaN;
    const validationPolicy = s.validationPolicy as ValidationPolicy;
    if (!id) throw new Error(`Step ${index + 1} id must be non-empty.`);
    if (!Number.isInteger(sequence) || sequence < 1) throw new Error(`Step ${id} sequence must be a positive integer.`);
    if (!title) throw new Error(`Step ${id} title must be non-empty.`);
    if (!instruction) throw new Error(`Step ${id} instruction must be non-empty.`);
    if (!validationPolicies.includes(validationPolicy)) throw new Error(`Step ${id} validationPolicy is not recognized.`);
    const acceptanceCriteria = asStringArray(s.acceptanceCriteria, `Step ${id} acceptanceCriteria`);
    if (acceptanceCriteria.length === 0) throw new Error(`Step ${id} acceptanceCriteria must be explicit.`);
    return {
      id,
      sequence,
      title,
      instruction,
      acceptanceCriteria,
      expectedArtifacts: Array.isArray(s.expectedArtifacts) ? asStringArray(s.expectedArtifacts, `Step ${id} expectedArtifacts`) : [],
      validationPolicy,
      dependsOn: Array.isArray(s.dependsOn) ? asStringArray(s.dependsOn, `Step ${id} dependsOn`) : [],
      ...(Array.isArray(s.constraints) ? { constraints: asStringArray(s.constraints, `Step ${id} constraints`) } : {}),
    };
  });
  validateExecutionPlan({ schemaVersion: 1, objective, originalTask, steps });
  return { schemaVersion: 1, objective, originalTask, steps: [...steps].sort((a, b) => a.sequence - b.sequence) };
}

export function singleStepExecutionPlan(originalTask: string): ExecutionPlan {
  return { schemaVersion: 1, objective: originalTask.trim() || "Single-step task", originalTask, steps: [{ id: "step", sequence: 1, title: "Initial run", instruction: originalTask, acceptanceCriteria: ["The original user task is completed."], expectedArtifacts: [], validationPolicy: "required", dependsOn: [] }] };
}

export function validateExecutionPlan(plan: ExecutionPlan): void {
  if (!plan.steps.length) throw new Error("ExecutionPlan.steps must not be empty.");
  const ids = new Set<string>();
  const sequences = new Set<number>();
  for (const step of plan.steps) {
    if (ids.has(step.id)) throw new Error(`Duplicate Step ID: ${step.id}`);
    ids.add(step.id);
    if (sequences.has(step.sequence)) throw new Error(`Duplicate Step sequence: ${step.sequence}`);
    sequences.add(step.sequence);
    if (!step.instruction.trim()) throw new Error(`Step ${step.id} instruction must be non-empty.`);
    if (!step.acceptanceCriteria.length) throw new Error(`Step ${step.id} acceptanceCriteria must be explicit.`);
  }
  const byId = new Map(plan.steps.map((s) => [s.id, s]));
  for (const step of plan.steps) {
    for (const dep of step.dependsOn) {
      const dependency = byId.get(dep);
      if (!dependency) throw new Error(`Step ${step.id} depends on unknown Step ${dep}.`);
      if (dependency.sequence >= step.sequence) throw new Error(`Step ${step.id} must not depend on later Step ${dep}.`);
    }
  }
}

export async function readExecutionPlanFile(filePath: string, fallbackOriginalTask?: string): Promise<ExecutionPlan> {
  return normalizeExecutionPlan(JSON.parse(await readFile(filePath, "utf8")), fallbackOriginalTask);
}

export function renderExecutionPlanMarkdown(plan: ExecutionPlan): string {
  return ["# Execution Plan", "", `## Objective`, "", plan.objective, "", "## Original task", "", plan.originalTask, "", "## Steps", "", ...plan.steps.flatMap((step) => [`### Step ${step.sequence}: ${step.title}`, "", `- id: ${step.id}`, `- validation policy: ${step.validationPolicy}`, `- dependencies: ${step.dependsOn.join(", ") || "none"}`, "", "#### Instruction", "", step.instruction, "", "#### Acceptance criteria", ...step.acceptanceCriteria.map((c) => `- ${c}`), "", "#### Expected artifacts", ...(step.expectedArtifacts.length ? step.expectedArtifacts.map((a) => `- ${a}`) : ["- none"]), "", ...(step.constraints?.length ? ["#### Constraints", ...step.constraints.map((c) => `- ${c}`), ""] : [])])].join("\n");
}

export async function persistExecutionPlan(runDir: string, plan: ExecutionPlan): Promise<void> {
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "execution-plan.json"), `${JSON.stringify({ ...plan, metadata: { persistedAt: new Date().toISOString(), artifactReferenceMode: "relative" } }, null, 2)}\n`, "utf8");
  await writeFile(path.join(runDir, "EXECUTION_PLAN.md"), renderExecutionPlanMarkdown(plan), "utf8");
}

export function mapReviewVerdict(verdict: string): StepReviewVerdict {
  if (verdict === "ACCEPT" || verdict === "ACCEPT_STEP") return "ACCEPT_STEP";
  if (verdict === "REWORK" || verdict === "REWORK_STEP") return "REWORK_STEP";
  if (verdict === "STOP") return "STOP";
  return "HUMAN_REQUIRED";
}
