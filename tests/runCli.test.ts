import { mkdtemp, mkdir, readFile, writeFile, readdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";
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


const execFileAsync = promisify(execFile);
const gitExecutable = "/nix/store/v2rxk9xkcxsas64wl7ds31al15cm2wqd-git-2.50.1/bin/git";
process.env.CATOS_GIT_EXECUTABLE = gitExecutable;

async function initializeGitRepository(repositoryPath: string): Promise<void> {
  await mkdir(repositoryPath, { recursive: true });

  await writeFile(
    path.join(repositoryPath, "README.md"),
    "# Demo\n",
    "utf8",
  );

  await execFileAsync(gitExecutable, ["init"], {
    cwd: repositoryPath,
  });

  await execFileAsync(
    "git",
    ["config", "user.name", "CatOS Test"],
    { cwd: repositoryPath },
  );

  await execFileAsync(
    "git",
    ["config", "user.email", "catos-test@example.invalid"],
    { cwd: repositoryPath },
  );

  await execFileAsync(gitExecutable, ["add", "."], {
    cwd: repositoryPath,
  });

  await execFileAsync(
    "git",
    ["commit", "-m", "initial"],
    { cwd: repositoryPath },
  );

  await execFileAsync(
    "git",
    ["branch", "-M", "main"],
    { cwd: repositoryPath },
  );
}

describe("runCommand", () => {
  it("runs Task Analyst, Coding Worker, Validation Runner, Reviewer, and writes review-report.json", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "catos-cli-"));
    const runsDir = path.join(cwd, "runs");
    await mkdir(path.join(cwd, "projects"));
    await initializeGitRepository(path.join(cwd, "demo-project"));
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
        calls.push(`${input.originalTask}|${input.taskBrief.codexInstruction}|${input.sandboxMode}|${input.attemptNumber}`);
        return {
          threadId: "thread-cli",
          finalResponse: "fake worker done",
          workspacePath: await createMockWorkspace(input),
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
        reviewerCalls.push(`${input.taskBrief.objective}|${input.workspaceDiff}|${input.validationReport.status}|${input.codingResult.diffCheck?.status}|${input.codingResult.diffCheck?.command}|${input.codingResult.diffCheck?.exitCode}`);
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
    expect(calls).toEqual([`Test task|${brief.codexInstruction}|workspace-write|1`]);
    const codingResult = JSON.parse(await readFile(path.join(runsDir, runDirs[0]!, "coding-result.json"), "utf8"));
    expect(codingResult.changedFiles).toEqual(["README.md"]);
    expect(codingResult.sandboxMode).toBe("workspace-write");
    expect(codingResult.sandboxIsolation).toBe("enabled");
    expect(codingResult.diffCheck).toMatchObject({ command: "git diff --check", status: "PASS", exitCode: 0 });
    expect(validationCalls[0]).toContain(`/${runDirs[0]!}/workspace|typecheck:npm run typecheck:true:120000,test:npm run test:true:120000,build:npm run build:true:120000`);
    const validationReport = JSON.parse(await readFile(path.join(runsDir, runDirs[0]!, "validation-report.json"), "utf8"));
    expect(validationReport.status).toBe("PASS");
    expect(validationReport.results.map((result: { name: string }) => result.name)).toEqual(["typecheck", "test", "build"]);
    await expect(readFile(path.join(runsDir, runDirs[0]!, "workspace.diff"), "utf8")).resolves.toContain("diff --git");
    await expect(readFile(path.join(runsDir, runDirs[0]!, "workspace-status.txt"), "utf8")).resolves.toContain("README.md");
    expect(reviewerCalls).toEqual([`${brief.objective}|diff --git a/README.md b/README.md\n|PASS|PASS|git diff --check|0`]);
    const reviewReport = JSON.parse(await readFile(path.join(runsDir, runDirs[0]!, "review-report.json"), "utf8"));
    expect(reviewReport.verdict).toBe("ACCEPT");
    expect(reviewReport.warnings).toHaveLength(1);
    const finalResult = JSON.parse(await readFile(path.join(runsDir, runDirs[0]!, "final-result.json"), "utf8"));
    expect(finalResult.status).toBe("ACCEPTED");
    expect(finalResult.totalCodingAttempts).toBe(1);
    const session = JSON.parse(await readFile(path.join(runsDir, runDirs[0]!, "session.json"), "utf8"));
    expect(session.runId).toBe(runDirs[0]);
    const timeline = (await readFile(path.join(runsDir, runDirs[0]!, "timeline.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(timeline.map((event) => event.event)).toEqual([
      "session.created",
      "step.created",
      "git.base_resolved",
      "step.status_changed",
      "attempt.started",
      "git.run_branch_created",
      "step.status_changed",
      "attempt.completed",
    ]);

    expect(timeline[3]).toMatchObject({
      event: "step.status_changed",
      metadata: {
        from: "open",
        to: "running",
      },
    });

    expect(timeline[6]).toMatchObject({
      event: "step.status_changed",
      metadata: {
        from: "running",
        to: "awaiting_decision",
      },
    });
  });

  it("passes the full literal original task and derived TaskBrief separately to Coding and writes instruction audit metadata", async () => {
    const originalTask = [
      "Create exactly one file:",
      "",
      "docs/AUTOCODEX_UI_DEMO.md",
      "",
      "The file content must be exactly the text inside the BEGIN/END markers.",
      "Do not include the markers themselves.",
      "",
      "BEGIN FILE CONTENT",
      "# AutoCodex UI Demo",
      "",
      "Status: passed",
      "Purpose: verify task integrity",
      "Literal: `preserve this`",
      "END FILE CONTENT",
    ].join("\n");
    const previousSecret = process.env.OPENAI_API_KEY;
    process.env.OPENAI_API_KEY = "controlled-fake-openai-secret-task-integrity";
    try {
      const driftedBrief: TaskBrief = { ...brief, codexInstruction: "Create the requested documentation file." };
      const { cwd, runsDir } = await setupRunFixture();
      const provider: TaskAnalystProvider = { analyze: async () => driftedBrief };
      let receivedOriginalTask = "";
      let receivedTaskBrief: TaskBrief | undefined;
      const codingWorker: CodingWorker = {
        executeTask: async (input) => {
          receivedOriginalTask = input.originalTask;
          receivedTaskBrief = input.taskBrief;
          return codingResult("thread-1", await createMockWorkspace(input), "initial");
        },
        continueTask: async () => { throw new Error("rework must not run"); },
      };
      const reviewerProvider: ReviewerProvider = { review: async () => review("ACCEPT") };
      await runCommand(["--project", "demo", "--task", originalTask], { cwd, runsDir, taskAnalystProvider: provider, codingWorker, validationRunner: validationRunnerWith(["PASS"]), reviewerProvider });
      const [runId] = await readdir(runsDir);
      const runDir = path.join(runsDir, runId!);
      expect(receivedOriginalTask).toBe(originalTask);
      expect(receivedTaskBrief).toEqual(driftedBrief);
      const instruction = await readFile(path.join(runDir, "coding-instruction.md"), "utf8");
      expect(instruction).toContain(originalTask);
      expect(instruction.indexOf("## Original user task — verbatim")).toBeLessThan(instruction.indexOf("## Derived implementation guidance"));
      expect(instruction).toContain("## Derived implementation guidance\n\nCreate the requested documentation file.");
      expect(instruction).not.toContain("controlled-fake-openai-secret-task-integrity");
      expect(instruction).not.toContain("Authorization:");
      const coding = JSON.parse(await readFile(path.join(runDir, "coding-result.json"), "utf8"));
      expect(coding.instructionArtifactPath).toBe("coding-instruction.md");
      expect(coding.originalTaskLength).toBe(Buffer.byteLength(originalTask, "utf8"));
      expect(coding.originalTaskSha256).toBe(createHash("sha256").update(originalTask, "utf8").digest("hex"));
      expect(coding.renderedInstructionSha256).toMatch(/^[a-f0-9]{64}$/);
      expect(coding.attemptNumber).toBe(1);
      expect(path.isAbsolute(coding.instructionArtifactPath)).toBe(false);
      const steps = await readdir(path.join(runDir, "steps"));
      const attempts = await readdir(path.join(runDir, "steps", steps[0]!, "attempts"));
      await expect(readFile(path.join(runDir, "steps", steps[0]!, "attempts", attempts[0]!, "coding-instruction.md"), "utf8")).resolves.toBe(instruction);
    } finally {
      if (previousSecret === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previousSecret;
    }
  });
});
type ReviewVerdict = "ACCEPT" | "REWORK" | "HUMAN_REQUIRED";

async function setupRunFixture(maxReworkAttempts = 2) {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "catos-rework-cli-"));
  const runsDir = path.join(cwd, "runs");
  await mkdir(path.join(cwd, "projects"));
  await initializeGitRepository(path.join(cwd, "demo-project"));
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


async function createMockWorkspace(input: {
  repositoryPath: string;
  workspaceRoot: string;
  runId: string;
  runBranch?: string;
  baseCommit?: string;
  baseBranch: string;
}): Promise<string> {
  const workspacePath = path.join(
    input.workspaceRoot,
    input.runId,
    "workspace",
  );

  const runBranch = input.runBranch ?? `catos/${input.runId}`;
  const baseRef = input.baseCommit ?? input.baseBranch;

  await mkdir(path.dirname(workspacePath), { recursive: true });

  await execFileAsync(
    gitExecutable,
    [
      "worktree",
      "add",
      "-b",
      runBranch,
      workspacePath,
      baseRef,
    ],
    {
      cwd: input.repositoryPath,
    },
  );

  return workspacePath;
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
      executeTask: async (input) => codingResult("thread-1", await createMockWorkspace(input), "initial"),
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
      executeTask: async (input) => codingResult("thread-1", await createMockWorkspace(input), "initial"),
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
    expect(continueInputs[0]!.originalTask).toBe("Test task");
    expect(continueInputs[0]!.taskBrief).toEqual(brief);
    expect(continueInputs[0]!.attemptNumber).toBe(2);
    expect(continueInputs[0]!.threadId).toBe("thread-1");
    expect(continueInputs[0]!.workspacePath).toContain(path.join(runId!, "workspace"));
    expect(validationCalls).toHaveLength(2);
    expect(reviewInputs).toHaveLength(2);
    expect(reviewInputs[0]!.codingResult.diffCheck).toMatchObject({ status: "PASS", command: "git diff --check", exitCode: 0 });
    expect(reviewInputs[1]!.codingResult.diffCheck).toMatchObject({ status: "PASS", command: "git diff --check", exitCode: 0 });
    expect(reviewInputs[0]!.codingResult.finalResponse).toContain("initial");
    expect(reviewInputs[1]!.codingResult.finalResponse).toContain("rework");
    expect(reviewInputs[0]!.reworkContext).toBeUndefined();
    expect(reviewInputs[1]!.reworkContext).toMatchObject({
      previousBlockingFindings: [{ id: "finding-1", requiredChange: "Change finding-1" }],
      requiredChanges: ["Change finding-1"],
      reworkReason: expect.stringContaining("REWORK summary"),
    });
    expect(reviewInputs[1]!.reworkContext?.reworkPackage.mustChange).toEqual(["Change finding-1"]);
    const stepsForReworkPackage = await readdir(path.join(runDir, "steps"));
    const attemptsForReworkPackage = await readdir(path.join(runDir, "steps", stepsForReworkPackage[0]!, "attempts"));
    const attemptOneDir = path.join(runDir, "steps", stepsForReworkPackage[0]!, "attempts", attemptsForReworkPackage[0]!);
    const attemptTwoDir = path.join(runDir, "steps", stepsForReworkPackage[0]!, "attempts", attemptsForReworkPackage[1]!);
    const reworkPackage = JSON.parse(await readFile(path.join(attemptOneDir, "rework", "rework-package.json"), "utf8"));
    expect(reworkPackage.mustChange).toEqual(["Change finding-1"]);
    await expect(readFile(path.join(attemptTwoDir, "coding-result.json"), "utf8")).resolves.toContain("thread-1");
    await expect(readFile(path.join(attemptTwoDir, "validation-report.json"), "utf8")).resolves.toContain("PASS");
    await expect(readFile(path.join(attemptTwoDir, "review-report.json"), "utf8")).resolves.toContain("ACCEPT");
    const rootCoding = await readFile(path.join(runDir, "coding-result.json"), "utf8");
    expect(rootCoding).toContain("initial done");
    const finalResult = JSON.parse(await readFile(path.join(runDir, "final-result.json"), "utf8"));
    expect(finalResult.status).toBe("ACCEPTED");
    expect(finalResult.totalCodingAttempts).toBe(2);
    const steps = await readdir(path.join(runDir, "steps"));
    const sessionAttempts = await readdir(path.join(runDir, "steps", steps[0]!, "attempts"));
    expect(sessionAttempts).toHaveLength(2);
    const attemptOneInstruction = await readFile(path.join(runDir, "steps", steps[0]!, "attempts", sessionAttempts[0]!, "coding-instruction.md"), "utf8");
    const attemptTwoInstruction = await readFile(path.join(runDir, "steps", steps[0]!, "attempts", sessionAttempts[1]!, "coding-instruction.md"), "utf8");
    expect(attemptOneInstruction).toContain("Test task");
    expect(attemptTwoInstruction).toContain("Test task");
    expect(attemptTwoInstruction).toContain("## Review verdict");
    expect(attemptTwoInstruction).toContain("## Required changes");
    expect(attemptTwoInstruction).toContain("Change finding-1");
    expect(attemptTwoInstruction).not.toBe("Change finding-1");
    const initialCodingResult = JSON.parse(await readFile(path.join(runDir, "coding-result.json"), "utf8"));
    const reworkCodingResult = JSON.parse(await readFile(path.join(attemptTwoDir, "coding-result.json"), "utf8"));
    expect(initialCodingResult.originalTaskSha256).toBe(reworkCodingResult.originalTaskSha256);
    expect(initialCodingResult.renderedInstructionSha256).not.toBe(reworkCodingResult.renderedInstructionSha256);
    expect(path.isAbsolute(reworkCodingResult.instructionArtifactPath)).toBe(false);
  });

  it("stops after rework returns HUMAN_REQUIRED", async () => {
    const { cwd, runsDir } = await setupRunFixture();
    const provider: TaskAnalystProvider = { analyze: async () => brief };
    const codingWorker: CodingWorker = { executeTask: async (input) => codingResult("thread-1", await createMockWorkspace(input), "initial"), continueTask: async (input) => codingResult(input.threadId, input.workspacePath, "rework") };
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
    const codingWorker: CodingWorker = { executeTask: async (input) => codingResult("thread-1", await createMockWorkspace(input), "initial"), continueTask: async (input) => codingResult(input.threadId, input.workspacePath, "rework") };
    let i = 0;
    const reviewerProvider: ReviewerProvider = { review: async () => review("REWORK", `finding-${++i}`) };
    await runCommand(["--project", "demo", "--task", "Test task"], { cwd, runsDir, taskAnalystProvider: provider, codingWorker, validationRunner: validationRunnerWith(["FAIL", "FAIL"]), reviewerProvider });
    const [runId] = await readdir(runsDir);
    const finalResult = JSON.parse(await readFile(path.join(runsDir, runId!, "final-result.json"), "utf8"));
    expect(finalResult.status).toBe("REWORK_LIMIT_REACHED");
    const steps = await readdir(path.join(runsDir, runId!, "steps"));
    const attempts = await readdir(path.join(runsDir, runId!, "steps", steps[0]!, "attempts"));
    expect(attempts).toHaveLength(2);
  });

  it("converts repeated blocking findings and REWORK without findings to HUMAN_REQUIRED", async () => {
    for (const noFindings of [false, true]) {
      const { cwd, runsDir } = await setupRunFixture(2);
      const provider: TaskAnalystProvider = { analyze: async () => brief };
      let continueCount = 0;
      const codingWorker: CodingWorker = { executeTask: async (input) => codingResult("thread-1", await createMockWorkspace(input), "initial"), continueTask: async (input) => { continueCount += 1; return codingResult(input.threadId, input.workspacePath, `rework${continueCount}`); } };
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
    const codingWorker: CodingWorker = { executeTask: async (input) => codingResult("thread-1", await createMockWorkspace(input), "initial"), continueTask: async (input) => codingResult(input.threadId, input.workspacePath, `rework${++continueCount}`) };
    let i = 0;
    const reviewerProvider: ReviewerProvider = { review: async () => review("REWORK", `finding-${++i}`) };
    await runCommand(["--project", "demo", "--task", "Test task"], { cwd, runsDir, taskAnalystProvider: provider, codingWorker, validationRunner: validationRunnerWith(["FAIL", "FAIL", "FAIL"]), reviewerProvider });
    const [runId] = await readdir(runsDir);
    const runDir = path.join(runsDir, runId!);
    const steps = await readdir(path.join(runDir, "steps"));
    const attempts = await readdir(path.join(runDir, "steps", steps[0]!, "attempts"));
    expect(attempts).toHaveLength(3);
    await expect(readFile(path.join(runDir, "steps", steps[0]!, "attempts", attempts[1]!, "coding-result.json"), "utf8")).resolves.toContain("rework1 done");
    await expect(readFile(path.join(runDir, "steps", steps[0]!, "attempts", attempts[2]!, "coding-result.json"), "utf8")).resolves.toContain("rework2 done");
    await expect(readFile(path.join(runDir, "coding-result.json"), "utf8")).resolves.toContain("initial done");
    await expect(readFile(path.join(runDir, "final-result.json"), "utf8")).resolves.toContain("REWORK_LIMIT_REACHED");
  });

  it("analyzes each explicit Planned Step once and stores separate Step TaskBriefs", async () => {
    const { cwd, runsDir } = await setupRunFixture();
    const plan = {
      schemaVersion: 1 as const,
      objective: "Four step repair",
      originalTask: "Complete the explicit four step repair.",
      steps: [
        { id: "audit", sequence: 1, title: "Audit", instruction: "Audit exactly.", acceptanceCriteria: ["audit accepted"], expectedArtifacts: ["audit.md"], validationPolicy: "optional" as const, dependsOn: [] },
        { id: "findings", sequence: 2, title: "Findings", instruction: "Write findings exactly.", acceptanceCriteria: ["findings accepted"], expectedArtifacts: ["findings.md"], validationPolicy: "optional" as const, dependsOn: ["audit"] },
        { id: "solution", sequence: 3, title: "Solution", instruction: "Design solution exactly.", acceptanceCriteria: ["solution accepted"], expectedArtifacts: ["solution.md"], validationPolicy: "not-applicable" as const, dependsOn: ["findings"] },
        { id: "implementation", sequence: 4, title: "Implementation", instruction: "Implement exactly.", acceptanceCriteria: ["implementation accepted"], expectedArtifacts: [], validationPolicy: "required" as const, dependsOn: ["solution"] },
      ],
    };
    const analystCalls: string[] = [];
    const provider: TaskAnalystProvider = { analyze: async (input) => {
      analystCalls.push(`${input.stepAnalysis?.currentStep.id}:${input.stepAnalysis?.currentStep.instruction}`);
      return { ...brief, objective: `Brief ${input.stepAnalysis?.currentStep.id}`, codexInstruction: `Guidance for ${input.stepAnalysis?.currentStep.id}`, acceptanceCriteria: [`brief ${input.stepAnalysis?.currentStep.id}`] };
    } };
    const codingBriefs: TaskBrief[] = [];
    const codingWorker: CodingWorker = {
      executeTask: async (input) => { codingBriefs.push(input.taskBrief); return codingResult(`thread-${input.currentStep?.id}`, await createMockWorkspace(input), input.currentStep?.id ?? "step"); },
      continueTask: async () => { throw new Error("unexpected rework"); },
    };
    const reviewerProvider: ReviewerProvider = { review: async () => review("ACCEPT") };
    await runCommand(["--project", "demo", "--task", plan.originalTask], { cwd, runsDir, executionPlan: plan, taskAnalystProvider: provider, codingWorker, validationRunner: validationRunnerWith(["PASS", "PASS", "PASS", "PASS"]), reviewerProvider });
    const [runId] = await readdir(runsDir);
    const runDir = path.join(runsDir, runId!);
    expect(analystCalls).toEqual(plan.steps.map((step) => `${step.id}:${step.instruction}`));
    expect(codingBriefs.map((b) => b.codexInstruction)).toEqual(["Guidance for audit", "Guidance for findings", "Guidance for solution", "Guidance for implementation"]);
    const stepDirs = await readdir(path.join(runDir, "steps"));
    expect(stepDirs).toHaveLength(4);
    for (const [index, dir] of stepDirs.entries()) {
      const persisted = JSON.parse(await readFile(path.join(runDir, "steps", dir, "task-brief.json"), "utf8"));
      expect(persisted).toMatchObject({ objective: `Brief ${plan.steps[index]!.id}`, codexInstruction: `Guidance for ${plan.steps[index]!.id}`, acceptanceCriteria: [`brief ${plan.steps[index]!.id}`], nonGoals: brief.nonGoals, riskLevel: brief.riskLevel });
    }
  });

  it("escalates contradictory Step rework to HUMAN_REQUIRED before another Coding attempt", async () => {
    const { cwd, runsDir } = await setupRunFixture(2);
    const plan = { schemaVersion: 1 as const, objective: "Contradiction", originalTask: "Create exactly one file only.", steps: [{ id: "only", sequence: 1, title: "Only", instruction: "Create exactly one file and do not create additional files.", acceptanceCriteria: ["Only one file changed"], expectedArtifacts: ["only.md"], validationPolicy: "optional" as const, dependsOn: [] }] };
    const provider: TaskAnalystProvider = { analyze: async () => brief };
    let continueCount = 0;
    const codingWorker: CodingWorker = { executeTask: async (input) => codingResult("thread-1", await createMockWorkspace(input), "initial"), continueTask: async (input) => { continueCount += 1; return codingResult(input.threadId, input.workspacePath, "rework"); } };
    const reviewerProvider: ReviewerProvider = { review: async () => ({ ...review("REWORK", "contradiction"), blockingFindings: [{ id: "contradiction", title: "Need extra file", evidence: "Reviewer asked for extra scope", requiredChange: "Create an additional file." }] }) };
    await runCommand(["--project", "demo", "--task", plan.originalTask], { cwd, runsDir, executionPlan: plan, taskAnalystProvider: provider, codingWorker, validationRunner: validationRunnerWith(["FAIL"]), reviewerProvider });
    const [runId] = await readdir(runsDir);
    const finalResult = JSON.parse(await readFile(path.join(runsDir, runId!, "final-result.json"), "utf8"));
    expect(finalResult.status).toBe("HUMAN_REQUIRED");
    expect(continueCount).toBe(0);
  });
});
// report-consistency regression: the UI contract test keeps danger-full-access behavior covered.
