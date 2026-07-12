import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { TaskInput } from "../schemas/taskInput.js";

export type CreateRunOptions = {
  runsDir?: string;
  now?: Date;
  runId?: string;
};

export type CreateRunResult = {
  runId: string;
  runDir: string;
  inputPath: string;
  input: TaskInput;
};

export async function createRun(projectId: string, goal: string, configPath: string, options: CreateRunOptions = {}): Promise<CreateRunResult> {
  const runId = options.runId ?? `${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`;
  const runsDir = options.runsDir ?? path.resolve(process.cwd(), "runs");
  const runDir = path.join(runsDir, runId);
  const inputPath = path.join(runDir, "input.json");
  const createdAt = (options.now ?? new Date()).toISOString();
  const input: TaskInput = {
    schemaVersion: 1,
    runId,
    projectId,
    goal,
    createdAt,
    configPath,
  };

  await mkdir(runsDir, { recursive: true });
  await mkdir(runDir, { recursive: false });
  await writeFile(inputPath, `${JSON.stringify(input, null, 2)}\n`, "utf8");

  return { runId, runDir, inputPath, input };
}
