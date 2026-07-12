import { mkdtemp, readFile, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { createRun } from "../src/runs/createRun.js";
import { taskInputSchema } from "../src/schemas/taskInput.js";

describe("createRun", () => {
  it("creates a run directory", async () => {
    const runsDir = await mkdtemp(path.join(os.tmpdir(), "catos-runs-"));

    const run = await createRun("demo", "Testovací úkol", "projects/demo.yaml", { runsDir });

    expect((await stat(run.runDir)).isDirectory()).toBe(true);
  });

  it("writes input.json with valid content", async () => {
    const runsDir = await mkdtemp(path.join(os.tmpdir(), "catos-input-"));
    const now = new Date("2026-07-12T12:00:00.000Z");

    const run = await createRun("demo", "Testovací úkol", "projects/demo.yaml", { runsDir, now, runId: "test-run" });
    const content = JSON.parse(await readFile(run.inputPath, "utf8"));

    expect(taskInputSchema.parse(content)).toEqual({
      schemaVersion: 1,
      runId: "test-run",
      projectId: "demo",
      goal: "Testovací úkol",
      createdAt: "2026-07-12T12:00:00.000Z",
      configPath: "projects/demo.yaml",
    });
  });

  it("creates unique run IDs for consecutive runs", async () => {
    const runsDir = await mkdtemp(path.join(os.tmpdir(), "catos-unique-"));

    const first = await createRun("demo", "První úkol", "projects/demo.yaml", { runsDir });
    const second = await createRun("demo", "Druhý úkol", "projects/demo.yaml", { runsDir });

    expect(first.runId).not.toBe(second.runId);
  });
});
