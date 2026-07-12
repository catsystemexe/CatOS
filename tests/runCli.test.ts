import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "../src/cli/run.js";
import type { TaskAnalystProvider } from "../src/agents/taskAnalyst.js";
import { taskBriefSchema, type TaskBrief } from "../src/schemas/taskBrief.js";
import type { CodingWorker } from "../src/codingWorker.js";
import type { ValidationRunner } from "../src/validationRunner.js";

const brief: TaskBrief = {
  objective: "Analyze a demo task.",
  acceptanceCriteria: ["task-brief.json exists."],
  nonGoals: ["Do not call Codex."],
  codexInstruction: "Prepare a minimal implementation plan for Codex.",
  riskLevel: "standard",
};

describe("runCommand", () => {
  it("runs Task Analyst, Coding Worker, Validation Runner, and writes validation-report.json", async () => {
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
          workspacePath: path.join(input.runDir, "workspace"),
          changedFiles: ["README.md"],
          diff: "diff --git a/README.md b/README.md\n",
          status: " M README.md\n",
          sandboxMode: input.sandboxMode ?? "workspace-write",
          sandboxIsolation: input.sandboxMode === "danger-full-access" ? "disabled" : "enabled",
        };
      },
    };
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

    await runCommand(["--project", "demo", "--task", "Test task"], { cwd, runsDir, taskAnalystProvider: provider, codingWorker, validationRunner });

    const runDirs = await import("node:fs/promises").then((fs) => fs.readdir(runsDir));
    expect(runDirs).toHaveLength(1);
    const taskBrief = JSON.parse(await readFile(path.join(runsDir, runDirs[0]!, "task-brief.json"), "utf8"));
    expect(taskBriefSchema.parse(taskBrief)).toEqual(brief);
    expect(calls).toEqual([`${brief.codexInstruction}|workspace-write`]);
    const codingResult = JSON.parse(await readFile(path.join(runsDir, runDirs[0]!, "coding-result.json"), "utf8"));
    expect(codingResult.changedFiles).toEqual(["README.md"]);
    expect(codingResult.sandboxMode).toBe("workspace-write");
    expect(codingResult.sandboxIsolation).toBe("enabled");
    expect(validationCalls).toEqual([`${path.join(runsDir, runDirs[0]!, "workspace")}|typecheck:npm run typecheck:true:120000,test:npm run test:true:120000,build:npm run build:true:120000`]);
    const validationReport = JSON.parse(await readFile(path.join(runsDir, runDirs[0]!, "validation-report.json"), "utf8"));
    expect(validationReport.status).toBe("PASS");
    expect(validationReport.results.map((result: { name: string }) => result.name)).toEqual(["typecheck", "test", "build"]);
    await expect(readFile(path.join(runsDir, runDirs[0]!, "workspace.diff"), "utf8")).resolves.toContain("diff --git");
    await expect(readFile(path.join(runsDir, runDirs[0]!, "workspace-status.txt"), "utf8")).resolves.toContain("README.md");
  });
});
