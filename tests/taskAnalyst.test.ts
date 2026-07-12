import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { analyzeTaskBrief, TaskBriefValidationError, writeTaskBrief, type TaskAnalystProvider } from "../src/agents/taskAnalyst.js";
import { taskBriefSchema, type TaskBrief } from "../src/schemas/taskBrief.js";

const validBrief: TaskBrief = {
  objective: "Add a read-only status command.",
  acceptanceCriteria: ["CLI prints project status."],
  nonGoals: ["Do not modify project files."],
  codexInstruction: "Implement a read-only status command and update tests.",
  riskLevel: "standard",
};

function sequenceProvider(outputs: unknown[]): TaskAnalystProvider & { calls: number } {
  return {
    calls: 0,
    async analyze() {
      return outputs[this.calls++];
    },
  };
}

describe("Task Analyst", () => {
  it("accepts a valid TaskBrief", async () => {
    const provider = sequenceProvider([validBrief]);

    const result = await analyzeTaskBrief("Add status", "demo", { provider });

    expect(result).toEqual({ taskBrief: validBrief, attempts: 1 });
    expect(taskBriefSchema.parse(result.taskBrief)).toEqual(validBrief);
  });

  it("rejects invalid output", async () => {
    const provider = sequenceProvider([{ objective: "missing required fields" }, validBrief]);

    const result = await analyzeTaskBrief("Add status", "demo", { provider });

    expect(result.taskBrief).toEqual(validBrief);
    expect(provider.calls).toBe(2);
  });

  it("uses one corrective iteration", async () => {
    const provider = sequenceProvider(["not an object", validBrief]);

    const result = await analyzeTaskBrief("Add status", "demo", { provider });

    expect(result.attempts).toBe(2);
    expect(provider.calls).toBe(2);
  });

  it("fails after the second invalid output", async () => {
    const provider = sequenceProvider(["not an object", { objective: "still invalid" }]);

    await expect(analyzeTaskBrief("Add status", "demo", { provider })).rejects.toBeInstanceOf(TaskBriefValidationError);
    expect(provider.calls).toBe(2);
  });

  it("writes task-brief.json", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "catos-task-brief-"));

    const taskBriefPath = await writeTaskBrief(runDir, validBrief);
    const content = JSON.parse(await readFile(taskBriefPath, "utf8"));

    expect(taskBriefPath).toBe(path.join(runDir, "task-brief.json"));
    expect(taskBriefSchema.parse(content)).toEqual(validBrief);
  });
});
