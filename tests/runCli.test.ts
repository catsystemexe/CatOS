import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { runCommand } from "../src/cli/run.js";
import type { TaskAnalystProvider } from "../src/agents/taskAnalyst.js";
import { taskBriefSchema, type TaskBrief } from "../src/schemas/taskBrief.js";

const brief: TaskBrief = {
  objective: "Analyze a demo task.",
  acceptanceCriteria: ["task-brief.json exists."],
  nonGoals: ["Do not call Codex."],
  codexInstruction: "Prepare a minimal implementation plan for Codex.",
  riskLevel: "standard",
};

describe("runCommand", () => {
  it("preserves run creation and writes task-brief.json with an injected provider", async () => {
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

    await runCommand(["--project", "demo", "--task", "Test task"], { cwd, runsDir, taskAnalystProvider: provider });

    const runDirs = await import("node:fs/promises").then((fs) => fs.readdir(runsDir));
    expect(runDirs).toHaveLength(1);
    const taskBrief = JSON.parse(await readFile(path.join(runsDir, runDirs[0]!, "task-brief.json"), "utf8"));
    expect(taskBriefSchema.parse(taskBrief)).toEqual(brief);
  });
});
