import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { buildCodexInstruction, buildReworkCodexInstruction } from "../src/codingWorker.js";
import { normalizeExecutionPlan, persistExecutionPlan, type ExecutionPlan, type StepResult } from "../src/executionPlan.js";
import type { TaskBrief } from "../src/schemas/taskBrief.js";

const plan: ExecutionPlan = {
  schemaVersion: 1,
  objective: "Audit and repair authentication architecture",
  originalTask: "Complete the supplied four-step plan.",
  steps: [
    { id: "audit", sequence: 1, title: "Audit", instruction: "Audit the authentication architecture and create docs/auth-audit.md.", acceptanceCriteria: ["docs/auth-audit.md exists"], expectedArtifacts: ["docs/auth-audit.md"], validationPolicy: "optional", dependsOn: [] },
    { id: "findings", sequence: 2, title: "Main findings", instruction: "Identify and prioritize the main problems from the accepted audit.", acceptanceCriteria: ["Every problem references evidence from the accepted audit"], expectedArtifacts: ["docs/auth-findings.md"], validationPolicy: "optional", dependsOn: ["audit"] },
    { id: "solution", sequence: 3, title: "Solution design", instruction: "Propose a solution for the accepted findings.", acceptanceCriteria: ["The proposal addresses every accepted high-severity finding"], expectedArtifacts: ["docs/auth-solution.md"], validationPolicy: "not-applicable", dependsOn: ["audit", "findings"] },
    { id: "implementation", sequence: 4, title: "Implementation", instruction: "Implement the accepted solution design.", acceptanceCriteria: ["git diff --check passes"], expectedArtifacts: [], validationPolicy: "required", dependsOn: ["solution"] },
  ],
};

const brief: TaskBrief = { objective: "Complete plan", acceptanceCriteria: ["complete"], nonGoals: [], codexInstruction: "Use the plan", riskLevel: "standard" };

describe("ExecutionPlan contract", () => {
  it("normalizes and persists an explicit four-step plan without changing order or instructions", async () => {
    const normalized = normalizeExecutionPlan(plan);
    const runDir = await mkdtemp(path.join(os.tmpdir(), "catos-plan-"));
    await persistExecutionPlan(runDir, normalized);
    const json = JSON.parse(await readFile(path.join(runDir, "execution-plan.json"), "utf8"));
    const md = await readFile(path.join(runDir, "EXECUTION_PLAN.md"), "utf8");
    expect(json.steps.map((step: { id: string }) => step.id)).toEqual(["audit", "findings", "solution", "implementation"]);
    expect(json.steps[1].instruction).toBe(plan.steps[1]!.instruction);
    expect(json.steps[3].validationPolicy).toBe("required");
    expect(md).toContain("### Step 1: Audit");
    expect(md).toContain("Identify and prioritize the main problems from the accepted audit.");
  });

  it.each([
    ["empty steps", { ...plan, steps: [] }],
    ["duplicate id", { ...plan, steps: [plan.steps[0]!, { ...plan.steps[1]!, id: "audit" }] }],
    ["missing instruction", { ...plan, steps: [{ ...plan.steps[0]!, instruction: "" }] }],
    ["empty criteria", { ...plan, steps: [{ ...plan.steps[0]!, acceptanceCriteria: [] }] }],
    ["unknown dependency", { ...plan, steps: [{ ...plan.steps[0]!, dependsOn: ["missing"] }] }],
    ["later dependency", { ...plan, steps: [{ ...plan.steps[0]!, dependsOn: ["findings"] }, plan.steps[1]!] }],
  ])("rejects invalid plan: %s", (_name, invalid) => {
    expect(() => normalizeExecutionPlan(invalid)).toThrow();
  });

  it("renders current-step Coding context with approved dependencies and pending future steps", () => {
    const deps: StepResult[] = [{ schemaVersion: 1, stepId: "audit", sequence: 1, title: "Audit", status: "ACCEPTED", acceptedAttempt: 1, summary: "Audit accepted", acceptedArtifacts: ["docs/auth-audit.md"], codingReportPath: "steps/001-audit/attempts/001-attempt/coding-report.md", reviewReportPath: "steps/001-audit/attempts/001-attempt/review-report.md", acceptedAt: new Date(0).toISOString() }];
    const prompt = buildCodexInstruction({ originalTask: plan.originalTask, taskBrief: brief, executionPlan: plan, currentStep: plan.steps[1]!, dependencyResults: deps, stepStatuses: { audit: "ACCEPTED" } });
    expect(prompt).toContain("# Multi-step Coding task");
    expect(prompt).toContain("Complete the supplied four-step plan.");
    expect(prompt).toContain("- Step 1: Audit — accepted");
    expect(prompt).toContain("- Step 2: Main findings — current");
    expect(prompt).toContain("- Step 3: Solution design — pending");
    expect(prompt).toContain(plan.steps[1]!.instruction);
    expect(prompt).toContain("Audit accepted");
    expect(prompt).toContain("Complete only the current Planned Step");
  });

  it("keeps rework instructions scoped to the same Planned Step", () => {
    const prompt = buildReworkCodexInstruction({ originalTask: plan.originalTask, taskBrief: brief, executionPlan: plan, currentStep: plan.steps[1]!, stepStatuses: { audit: "ACCEPTED", findings: "REWORK" }, dependencyResults: [], previousAttemptResult: "Attempt 1 missed evidence.", reviewVerdict: "REWORK", reworkPackage: { schemaVersion: 1, attempt: 1, originalObjective: brief.objective, acceptanceCriteria: brief.acceptanceCriteria, blockingFindings: [{ id: "finding", title: "Missing evidence", evidence: "No audit citation", requiredChange: "Reference accepted audit evidence." }], preserve: [], mustChange: ["Reference accepted audit evidence."], mustNotChange: [], previousAttemptSummary: "Attempt 1 missed evidence." } });
    expect(prompt).toContain("## Rework instructions");
    expect(prompt).toContain("Reference accepted audit evidence.");
    expect(prompt).toContain("- Step 2: Main findings — current");
  });
});
