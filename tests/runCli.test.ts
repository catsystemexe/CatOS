import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "../src/cli/run.js";
import type { TaskAnalystProvider } from "../src/agents/taskAnalyst.js";
import { taskBriefSchema, type TaskBrief } from "../src/schemas/taskBrief.js";
import type { CodingResult, CodingWorker, ReworkCodingTask } from "../src/codingWorker.js";
import type { ValidationRunner } from "../src/validationRunner.js";
import type { ReviewerProvider } from "../src/agents/reviewer.js";

const brief: TaskBrief = {
  objective: "Analyze a demo task.",
  acceptanceCriteria: ["task-brief.json exists."],
  nonGoals: ["Do not call Codex."],
  codexInstruction: "Prepare a minimal implementation plan for Codex.",
  riskLevel: "standard",
};

describe("runCommand", () => {
  it("runs Task Analyst, Coding Worker, Validation Runner, Reviewer, and writes review-report.json", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "catos-cli-"));
    const runsDir = path.join(cwd, "runs");
    await mkdir(path.join(cwd, "projects"));
    await mkdir(path.join(cwd, "demo-project"));
    await writeFile(
      path.join(cwd, "projects", "demo.yaml"),
      `project:\n  id: demo\n  name: Demo project\n  repoPath: ../demo-project\n  baseBranch: main\ncommands:\n  typecheck: npm run typecheck\n  test: npm run test\n  build: npm run build\nworkflow:\n  maxReworkAttempts: 2\n  createCommit: false\npermissions:\n  allowNetwork: false\n  allowPush: false\n  allowMerge: false\n`,
      "utf8",
    );

    const provider: TaskAnalystProvider = { analyze: async () => brief };
    const calls: string[] = [];
    const validationCalls: string[] = [];
    const codingWorker: CodingWorker = {
      executeTask: async (input) => {
        calls.push(`${input.instruction}|${input.sandboxMode}`);
        return {
          threadId: "thread-cli",
          finalResponse: "fake worker done",
          workspacePath: path.join(input.workspaceRoot, input.runId, "workspace"),
          changedFiles: ["README.md"],
          diff: "diff --git a/README.md b/README.md\n",
          status: " M README.md\n",
          sandboxMode: input.sandboxMode ?? "workspace-write",
          sandboxIsolation: input.sandboxMode === "danger-full-access" ? "disabled" : "enabled",
        };
      },
      continueTask: async () => { throw new Error("rework must not run"); },
    };
    const reviewerCalls: string[] = [];
    const validationRunner: ValidationRunner = {
      run: async (input) => {
        validationCalls.push(`${input.workspacePath}|${input.commands.map((command) => `${command.name}:${command.command}:${command.required}:${command.timeoutMs}`).join(",")}`);
        return {
          schemaVersion: 1,
          status: "PASS",
          workspacePath: input.workspacePath,
          startedAt: new Date(0).toISOString(),
          finishedAt: new Date(1).toISOString(),
          results: input.commands.map((command) => ({
            name: command.name,
            command: command.command,
            required: command.required,
            status: "PASS",
            exitCode: 0,
            signal: null,
            stdout: "",
            stderr: "",
            durationMs: 10,
            timedOut: false,
          })),
        };
      },
    };
    const reviewerProvider: ReviewerProvider = {
      review: async (input) => {
        reviewerCalls.push(`${input.taskBrief.objective}|${input.workspaceDiff}|${input.validationReport.status}`);
        return {
          schemaVersion: 1,
          verdict: "ACCEPT",
          summary: "Looks good.",
          reviewedAcceptanceCriteria: [{ criterion: brief.acceptanceCriteria[0]!, status: "SATISFIED", evidence: "Diff and validation support it." }],
          blockingFindings: [],
          warnings: ["Demo warning."],
        };
      },
    };

    await runCommand(["--project", "demo", "--task", "Test task"], { cwd, runsDir, taskAnalystProvider: provider, codingWorker, validationRunner, reviewerProvider });

    const runDirs = await import("node:fs/promises").then((fs) => fs.readdir(runsDir));
    expect(runDirs).toHaveLength(1);
    const taskBrief = JSON.parse(await readFile(path.join(runsDir, runDirs[0]!, "task-brief.json"), "utf8"));
    expect(taskBriefSchema.parse(taskBrief)).toEqual(brief);
    expect(calls).toEqual([`${brief.codexInstruction}|workspace-write`]);
    const codingResult = JSON.parse(await readFile(path.join(runsDir, runDirs[0]!, "coding-result.json"), "utf8"));
    expect(codingResult.changedFiles).toEqual(["README.md"]);
    expect(codingResult.sandboxMode).toBe("workspace-write");
    expect(codingResult.sandboxIsolation).toBe("enabled");
    expect(validationCalls[0]).toContain(`/${runDirs[0]!}/workspace|typecheck:npm run typecheck:true:120000,test:npm run test:true:120000,build:npm run build:true:120000`);
    const validationReport = JSON.parse(await readFile(path.join(runsDir, runDirs[0]!, "validation-report.json"), "utf8"));
    expect(validationReport.status).toBe("PASS");
    expect(validationReport.results.map((result: { name: string }) => result.name)).toEqual(["typecheck", "test", "build"]);
    await expect(readFile(path.join(runsDir, runDirs[0]!, "workspace.diff"), "utf8")).resolves.toContain("diff --git");
    await expect(readFile(path.join(runsDir, runDirs[0]!, "workspace-status.txt"), "utf8")).resolves.toContain("README.md");
    expect(reviewerCalls).toEqual([`${brief.objective}|diff --git a/README.md b/README.md\n|PASS`]);
    const reviewReport = JSON.parse(await readFile(path.join(runsDir, runDirs[0]!, "review-report.json"), "utf8"));
    expect(reviewReport.verdict).toBe("ACCEPT");
    expect(reviewReport.warnings).toHaveLength(1);
    const finalResult = JSON.parse(await readFile(path.join(runsDir, runDirs[0]!, "final-result.json"), "utf8"));
    expect(finalResult.status).toBe("ACCEPTED");
    expect(finalResult.totalCodingAttempts).toBe(1);
    const session = JSON.parse(await readFile(path.join(runsDir, runDirs[0]!, "session.json"), "utf8"));
    expect(session.runId).toBe(runDirs[0]);
    const timeline = (await readFile(path.join(runsDir, runDirs[0]!, "timeline.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(timeline.map((event) => event.event)).toEqual(["session.created", "step.created", "attempt.started", "attempt.completed"]);
  });
});

type ReviewVerdict = "ACCEPT" | "REWORK" | "HUMAN_REQUIRED";

async function setupRunFixture(maxReworkAttempts = 2) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "catos-rework-cli-"));
  const runsDir = path.join(cwd, "runs");
  await mkdir(path.join(cwd, "projects"));
  await mkdir(path.join(cwd, "demo-project"));
  await writeFile(
    path.join(cwd, "projects", "demo.yaml"),
    `project:\n  id: demo\n  name: Demo project\n  repoPath: ../demo-project\n  baseBranch: main\ncommands:\n  typecheck: npm run typecheck\n  test: npm run test\n  build: npm run build\nworkflow:\n  maxReworkAttempts: ${maxReworkAttempts}\n  createCommit: false\npermissions:\n  allowNetwork: false\n  allowPush: false\n  allowMerge: false\n`,
    "utf8",
  );
  return { cwd, runsDir };
}

function codingResult(threadId: string, workspacePath: string, label: string): CodingResult {
  return {
    threadId,
    finalResponse: `${label} done`,
    workspacePath,
    changedFiles: [`${label}.ts`],
    diff: `diff --git a/${label}.ts b/${label}.ts\n+${label}\n`,
    status: ` M ${label}.ts\n`,
    sandboxMode: "workspace-write",
    sandboxIsolation: "enabled",
  };
}

function validationRunnerWith(statuses: Array<"PASS" | "FAIL" | "BLOCKED">): ValidationRunner {
  let index = 0;
  return {
    run: async (input) => {
      const status = statuses[Math.min(index, statuses.length - 1)]!;
      index += 1;
      return {
        schemaVersion: 1,
        status,
        workspacePath: input.workspacePath,
        startedAt: new Date(0).toISOString(),
        finishedAt: new Date(1).toISOString(),
        results: input.commands.map((command) => ({ name: command.name, command: command.command, required: command.required, status, exitCode: status === "PASS" ? 0 : 1, signal: null, stdout: "", stderr: "", durationMs: 1, timedOut: false })),
      };
    },
  };
}

function review(verdict: ReviewVerdict, id = "finding-1") {
  return {
    schemaVersion: 1,
    verdict,
    summary: `${verdict} summary`,
    reviewedAcceptanceCriteria: [{ criterion: brief.acceptanceCriteria[0]!, status: verdict === "ACCEPT" ? "SATISFIED" : "NOT_SATISFIED", evidence: "review evidence" }],
    blockingFindings: verdict === "REWORK" ? [{ id, title: `Title ${id}`, evidence: `Evidence ${id}`, requiredChange: `Change ${id}` }] : [],
    warnings: [],
  };
}

describe("runCommand rework loop", () => {
  it("does not rework on HUMAN_REQUIRED", async () => {
    const { cwd, runsDir } = await setupRunFixture();
    const provider: TaskAnalystProvider = { analyze: async () => brief };
    const codingWorker: CodingWorker = {
      executeTask: async (input) => codingResult("thread-1", path.join(input.workspaceRoot, input.runId, "workspace"), "initial"),
      continueTask: async () => { throw new Error("unexpected rework"); },
    };
    const reviewerProvider: ReviewerProvider = { review: async () => review("HUMAN_REQUIRED") };
    await runCommand(["--project", "demo", "--task", "Test task"], { cwd, runsDir, taskAnalystProvider: provider, codingWorker, validationRunner: validationRunnerWith(["PASS"]), reviewerProvider });
    const [runId] = await readdir(runsDir);
    const finalResult = JSON.parse(await readFile(path.join(runsDir, runId!, "final-result.json"), "utf8"));
    expect(finalResult.status).toBe("HUMAN_REQUIRED");
    await expect(readdir(path.join(runsDir, runId!, "attempts"))).rejects.toThrow();
  });

  it("creates a rework package, continues the same thread and workspace, reruns coding validation and review, then accepts", async () => {
    const { cwd, runsDir } = await setupRunFixture();
    const provider: TaskAnalystProvider = { analyze: async () => brief };
    const continueInputs: ReworkCodingTask[] = [];
    const validationCalls: string[] = [];
    const codingWorker: CodingWorker = {
      executeTask: async (input) => codingResult("thread-1", path.join(input.workspaceRoot, input.runId, "workspace"), "initial"),
      continueTask: async (input) => { continueInputs.push(input); return codingResult(input.threadId, input.workspacePath, "rework"); },
    };
    const baseValidationRunner = validationRunnerWith(["FAIL", "PASS"]);
    const validationRunner: ValidationRunner = { run: async (input) => { validationCalls.push(input.workspacePath); return baseValidationRunner.run(input); } };
    const reviewInputs: Parameters<ReviewerProvider["review"]>[0][] = [];
    let reviewCall = 0;
    const reviewerProvider: ReviewerProvider = { review: async (input) => { reviewInputs.push(input); return reviewCall++ === 0 ? review("REWORK") : review("ACCEPT"); } };
    await runCommand(["--project", "demo", "--task", "Test task"], { cwd, runsDir, taskAnalystProvider: provider, codingWorker, validationRunner, reviewerProvider });
    const [runId] = await readdir(runsDir);
    const runDir = path.join(runsDir, runId!);
    expect(continueInputs).toHaveLength(1);
    expect(continueInputs[0]!.threadId).toBe("thread-1");
    expect(continueInputs[0]!.workspacePath).toContain(path.join(runId!, "workspace"));
    expect(validationCalls).toHaveLength(2);
    expect(reviewInputs).toHaveLength(2);
    expect(reviewInputs[0]!.reworkContext).toBeUndefined();
    expect(reviewInputs[1]!.reworkContext).toMatchObject({
      previousBlockingFindings: [{ id: "finding-1", requiredChange: "Change finding-1" }],
      requiredChanges: ["Change finding-1"],
      reworkReason: expect.stringContaining("REWORK summary"),
    });
    expect(reviewInputs[1]!.reworkContext?.reworkPackage.mustChange).toEqual(["Change finding-1"]);
    const reworkPackage = JSON.parse(await readFile(path.join(runDir, "attempts", "01", "rework-package.json"), "utf8"));
    expect(reworkPackage.mustChange).toEqual(["Change finding-1"]);
    await expect(readFile(path.join(runDir, "attempts", "01", "coding-result.json"), "utf8")).resolves.toContain("thread-1");
    await expect(readFile(path.join(runDir, "attempts", "01", "validation-report.json"), "utf8")).resolves.toContain("PASS");
    await expect(readFile(path.join(runDir, "attempts", "01", "review-report.json"), "utf8")).resolves.toContain("ACCEPT");
    const rootCoding = await readFile(path.join(runDir, "coding-result.json"), "utf8");
    expect(rootCoding).toContain("initial done");
    const finalResult = JSON.parse(await readFile(path.join(runDir, "final-result.json"), "utf8"));
    expect(finalResult.status).toBe("ACCEPTED");
    expect(finalResult.totalCodingAttempts).toBe(2);
    const steps = await readdir(path.join(runDir, "steps"));
    const sessionAttempts = await readdir(path.join(runDir, "steps", steps[0]!, "attempts"));
    expect(sessionAttempts).toHaveLength(2);
  });

  it("stops after rework returns HUMAN_REQUIRED", async () => {
    const { cwd, runsDir } = await setupRunFixture();
    const provider: TaskAnalystProvider = { analyze: async () => brief };
    const codingWorker: CodingWorker = { executeTask: async (input) => codingResult("thread-1", path.join(input.workspaceRoot, input.runId, "workspace"), "initial"), continueTask: async (input) => codingResult(input.threadId, input.workspacePath, "rework") };
    let reviewCall = 0;
    const reviewerProvider: ReviewerProvider = { review: async () => reviewCall++ === 0 ? review("REWORK") : review("HUMAN_REQUIRED") };
    await runCommand(["--project", "demo", "--task", "Test task"], { cwd, runsDir, taskAnalystProvider: provider, codingWorker, validationRunner: validationRunnerWith(["FAIL", "FAIL"]), reviewerProvider });
    const [runId] = await readdir(runsDir);
    const finalResult = JSON.parse(await readFile(path.join(runsDir, runId!, "final-result.json"), "utf8"));
    expect(finalResult.status).toBe("HUMAN_REQUIRED");
    expect(finalResult.totalCodingAttempts).toBe(2);
  });

  it("returns REWORK_LIMIT_REACHED when max rework attempts are exhausted", async () => {
    const { cwd, runsDir } = await setupRunFixture(1);
    const provider: TaskAnalystProvider = { analyze: async () => brief };
    const codingWorker: CodingWorker = { executeTask: async (input) => codingResult("thread-1", path.join(input.workspaceRoot, input.runId, "workspace"), "initial"), continueTask: async (input) => codingResult(input.threadId, input.workspacePath, "rework") };
    let i = 0;
    const reviewerProvider: ReviewerProvider = { review: async () => review("REWORK", `finding-${++i}`) };
    await runCommand(["--project", "demo", "--task", "Test task"], { cwd, runsDir, taskAnalystProvider: provider, codingWorker, validationRunner: validationRunnerWith(["FAIL", "FAIL"]), reviewerProvider });
    const [runId] = await readdir(runsDir);
    const finalResult = JSON.parse(await readFile(path.join(runsDir, runId!, "final-result.json"), "utf8"));
    expect(finalResult.status).toBe("REWORK_LIMIT_REACHED");
    expect(await readdir(path.join(runsDir, runId!, "attempts"))).toEqual(["01"]);
  });

  it("converts repeated blocking findings and REWORK without findings to HUMAN_REQUIRED", async () => {
    for (const noFindings of [false, true]) {
      const { cwd, runsDir } = await setupRunFixture(2);
      const provider: TaskAnalystProvider = { analyze: async () => brief };
      let continueCount = 0;
      const codingWorker: CodingWorker = { executeTask: async (input) => codingResult("thread-1", path.join(input.workspaceRoot, input.runId, "workspace"), "initial"), continueTask: async (input) => { continueCount += 1; return codingResult(input.threadId, input.workspacePath, `rework${continueCount}`); } };
      let call = 0;
      const reviewerProvider: ReviewerProvider = { review: async () => {
        call += 1;
        if (noFindings) return { ...review("REWORK"), blockingFindings: [] };
        return review("REWORK", "same");
      } };
      await runCommand(["--project", "demo", "--task", "Test task"], { cwd, runsDir, taskAnalystProvider: provider, codingWorker, validationRunner: validationRunnerWith(["FAIL", "FAIL", "FAIL"]), reviewerProvider });
      const [runId] = await readdir(runsDir);
      const finalResult = JSON.parse(await readFile(path.join(runsDir, runId!, "final-result.json"), "utf8"));
      expect(finalResult.status).toBe("HUMAN_REQUIRED");
      expect(finalResult.reworkAttempts).toBe(noFindings ? 0 : 1);
    }
  });

  it("stores each rework attempt in a separate directory without overwriting previous artifacts", async () => {
    const { cwd, runsDir } = await setupRunFixture(2);
    const provider: TaskAnalystProvider = { analyze: async () => brief };
    let continueCount = 0;
    const codingWorker: CodingWorker = { executeTask: async (input) => codingResult("thread-1", path.join(input.workspaceRoot, input.runId, "workspace"), "initial"), continueTask: async (input) => codingResult(input.threadId, input.workspacePath, `rework${++continueCount}`) };
    let i = 0;
    const reviewerProvider: ReviewerProvider = { review: async () => review("REWORK", `finding-${++i}`) };
    await runCommand(["--project", "demo", "--task", "Test task"], { cwd, runsDir, taskAnalystProvider: provider, codingWorker, validationRunner: validationRunnerWith(["FAIL", "FAIL", "FAIL"]), reviewerProvider });
    const [runId] = await readdir(runsDir);
    const runDir = path.join(runsDir, runId!);
    expect(await readdir(path.join(runDir, "attempts"))).toEqual(["01", "02"]);
    await expect(readFile(path.join(runDir, "attempts", "01", "coding-result.json"), "utf8")).resolves.toContain("rework1 done");
    await expect(readFile(path.join(runDir, "attempts", "02", "coding-result.json"), "utf8")).resolves.toContain("rework2 done");
    await expect(readFile(path.join(runDir, "coding-result.json"), "utf8")).resolves.toContain("initial done");
    await expect(readFile(path.join(runDir, "final-result.json"), "utf8")).resolves.toContain("REWORK_LIMIT_REACHED");
  });
});
