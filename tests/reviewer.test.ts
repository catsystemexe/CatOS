import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { reviewReportSchema, type ReviewReport } from "../src/schemas/reviewReport.js";
import { reviewChange, writeReviewReport, createOpenAIReviewerProvider, type ReviewerInput } from "../src/agents/reviewer.js";
import type { TaskBrief } from "../src/schemas/taskBrief.js";
import type { ValidationReport } from "../src/validationRunner.js";

const hoisted = vi.hoisted(() => ({
  agentConstructions: [] as unknown[],
  finalOutput: undefined as unknown,
  runPrompts: [] as string[],
}));

vi.mock("@openai/agents", () => ({
  setDefaultOpenAIKey: vi.fn(),
  Agent: class FakeAgent {
    constructor(options: unknown) {
      hoisted.agentConstructions.push(options);
    }
  },
  run: vi.fn(async (_agent, prompt: string) => { hoisted.runPrompts.push(prompt); return { finalOutput: hoisted.finalOutput }; }),
}));

const taskBrief: TaskBrief = {
  objective: "Add reviewer.",
  acceptanceCriteria: ["Review report is written."],
  nonGoals: ["No rework loop."],
  codexInstruction: "Implement reviewer only.",
  riskLevel: "standard",
};

const acceptReport: ReviewReport = {
  schemaVersion: 1,
  verdict: "ACCEPT",
  summary: "Change satisfies the requested scope.",
  reviewedAcceptanceCriteria: [{ criterion: "Review report is written.", status: "SATISFIED", evidence: "Diff adds review-report writing." }],
  blockingFindings: [],
  warnings: [],
};

function validation(status: ValidationReport["status"]): ValidationReport {
  return {
    schemaVersion: 1,
    status,
    workspacePath: "/tmp/workspace",
    startedAt: new Date(0).toISOString(),
    finishedAt: new Date(1).toISOString(),
    results: [],
  };
}

function input(status: ValidationReport["status"] = "PASS"): ReviewerInput {
  return {
    taskInput: { schemaVersion: 1, runId: "run-1", projectId: "demo", goal: "Add reviewer.", createdAt: new Date(0).toISOString(), configPath: "projects/demo.yaml" },
    taskBrief,
    codingResult: {
      threadId: "thread-1",
      finalResponse: "I implemented it.",
      workspacePath: "/tmp/workspace",
      changedFiles: ["src/agents/reviewer.ts"],
      sandboxMode: "workspace-write",
      sandboxIsolation: "enabled",
    },
    workspaceDiff: "diff --git a/src/agents/reviewer.ts b/src/agents/reviewer.ts\n",
    workspaceStatus: " M src/agents/reviewer.ts\n",
    validationReport: validation(status),
    projectConstraints: {
      permissions: { allowNetwork: false, allowPush: false, allowMerge: false },
      workflow: { maxReworkAttempts: 2, createCommit: false },
      codex: { sandboxMode: "workspace-write", acknowledgeNoSandbox: false },
    },
  };
}

describe("Reviewer", () => {
  beforeEach(() => {
    hoisted.agentConstructions.length = 0;
    hoisted.finalOutput = acceptReport;
    hoisted.runPrompts.length = 0;
  });

  it("accepts valid ACCEPT when validation passed", async () => {
    await expect(reviewChange(input(), { provider: { review: async () => acceptReport } })).resolves.toEqual(acceptReport);
  });

  it("accepts valid REWORK", async () => {
    const report = { ...acceptReport, verdict: "REWORK" as const, blockingFindings: [{ id: "r1", title: "Missing test", evidence: "Diff has no test update.", requiredChange: "Add a test." }] };
    await expect(reviewChange(input(), { provider: { review: async () => report } })).resolves.toEqual(report);
  });

  it("accepts valid HUMAN_REQUIRED", async () => {
    const report = { ...acceptReport, verdict: "HUMAN_REQUIRED" as const, summary: "Needs product decision." };
    await expect(reviewChange(input(), { provider: { review: async () => report } })).resolves.toEqual(report);
  });

  it("rejects ACCEPT when validation status is FAIL", async () => {
    await expect(reviewChange(input("FAIL"), { provider: { review: async () => acceptReport } })).rejects.toThrow(/not allowed/);
  });

  it("rejects ACCEPT when validation status is BLOCKED", async () => {
    await expect(reviewChange(input("BLOCKED"), { provider: { review: async () => acceptReport } })).rejects.toThrow(/not allowed/);
  });

  it("rejects invalid structured output", async () => {
    await expect(reviewChange(input(), { provider: { review: async () => ({ verdict: "FAIL" }) } })).rejects.toThrow(/invalid ReviewReport/);
  });

  it("writes review-report.json containing only a valid ReviewReport", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "catos-review-"));
    const reportPath = await writeReviewReport(dir, acceptReport);
    const parsed = JSON.parse(await readFile(reportPath, "utf8"));
    expect(reviewReportSchema.parse(parsed)).toEqual(acceptReport);
    expect(parsed).not.toHaveProperty("workspaceDiff");
  });

  it("passes TaskBrief, diff, and ValidationReport to provider", async () => {
    let received: ReviewerInput | undefined;
    await reviewChange(input(), { provider: { review: async (reviewInput) => { received = reviewInput; return acceptReport; } } });
    expect(received?.taskBrief).toEqual(taskBrief);
    expect(received?.workspaceDiff).toContain("diff --git");
    expect(received?.validationReport.status).toBe("PASS");
  });


  it("instructs the OpenAI Reviewer to accept validation-required support files after successful rework", async () => {
    const reworkInput: ReviewerInput = {
      ...input("PASS"),
      taskBrief: {
        ...taskBrief,
        acceptanceCriteria: ["All project validation commands pass."],
      },
      codingResult: {
        ...input().codingResult,
        changedFiles: ["README.md", ".support-marker"],
      },
      workspaceDiff: "diff --git a/.support-marker b/.support-marker\nnew file mode 100644\n+fixed\n",
      workspaceStatus: " M README.md\n?? .support-marker\n",
      validationReport: {
        ...validation("PASS"),
        results: [{
          name: "test",
          command: "npm run test",
          required: true,
          status: "PASS",
          exitCode: 0,
          signal: null,
          stdout: "All tests passed after creating .support-marker",
          stderr: "",
          durationMs: 10,
          timedOut: false,
        }],
      },
      reworkContext: {
        reworkPackage: {
          schemaVersion: 1,
          attempt: 1,
          originalObjective: "Make validation pass.",
          acceptanceCriteria: ["All project validation commands pass."],
          blockingFindings: [{
            id: "validation-failed",
            title: "Validation requires a support marker file",
            evidence: "npm run test failed with: Create a file named .support-marker containing exactly: fixed",
            requiredChange: "Create the support marker file required by validation.",
          }],
          preserve: ["README.md changes"],
          mustChange: ["Create the support marker file required by validation."],
          mustNotChange: ["No unrelated files."],
          previousAttemptSummary: "Previous validation failed because the required support marker file was missing.",
        },
        previousBlockingFindings: [{
          id: "validation-failed",
          title: "Validation requires a support marker file",
          evidence: "npm run test failed with: Create a file named .support-marker containing exactly: fixed",
          requiredChange: "Create the support marker file required by validation.",
        }],
        requiredChanges: ["Create the support marker file required by validation."],
        reworkReason: "Previous validation failed because the required support marker file was missing.",
      },
    };

    const provider = createOpenAIReviewerProvider({ apiKey: "test-key", model: "test-model" });
    await provider.review(reworkInput);

    const instructions = String((hoisted.agentConstructions[0] as { instructions?: unknown }).instructions);
    expect(instructions).toContain("supporting file");
    expect(instructions).toContain("return ACCEPT rather than REWORK");
    expect(instructions).toContain("reworkContext");
    expect(hoisted.runPrompts[0]).toContain('"reworkContext"');
    expect(hoisted.runPrompts[0]).toContain("Create the support marker file required by validation.");
  });

  it("instructs the OpenAI Reviewer that an unsupported new file may be a scope violation", async () => {
    const provider = createOpenAIReviewerProvider({ apiKey: "test-key", model: "test-model" });
    await provider.review({
      ...input("PASS"),
      codingResult: { ...input().codingResult, changedFiles: ["src/agents/reviewer.ts", "notes/random.txt"] },
      workspaceDiff: "diff --git a/notes/random.txt b/notes/random.txt\nnew file mode 100644\n+unrelated notes\n",
      workspaceStatus: " M src/agents/reviewer.ts\n?? notes/random.txt\n",
    });

    const instructions = String((hoisted.agentConstructions[0] as { instructions?: unknown }).instructions);
    expect(instructions).toContain("You may flag a new file as a scope violation");
    expect(instructions).toContain("lacks a defensible link to acceptance criteria, validation output, existing project configuration/tests, or the reworkContext");
  });

  it("creates an OpenAI Reviewer agent without tools", async () => {
    const provider = createOpenAIReviewerProvider({ apiKey: "test-key", model: "test-model" });
    await provider.review(input());
    expect(hoisted.agentConstructions).toHaveLength(1);
    expect(hoisted.agentConstructions[0]).toMatchObject({ tools: [] });
  });

  it("returns HUMAN_REQUIRED instead of truncating oversized review packages", async () => {
    const large = { ...input(), workspaceDiff: "x".repeat(100) };
    const report = await reviewChange(large, { provider: { review: async () => { throw new Error("should not call provider"); } }, maxPackageBytes: 10 });
    expect(report.verdict).toBe("HUMAN_REQUIRED");
    expect(report.blockingFindings[0]?.id).toBe("review-package-too-large");
  });
});
