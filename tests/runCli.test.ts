import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { runCommand } from "../src/cli/run.js";

const task = {
  schemaVersion: 2 as const,
  taskId: "task-1",
  task: "Change one file",
  baseCommitSha: "a".repeat(40),
  checks: [],
  steps: [{ id: "step-1", title: "One", dependsOn: [], checks: [], files: ["README.md"] }],
};

async function fixtureCwd(): Promise<string> {
  const cwd = await mkdtemp(path.join(os.tmpdir(), "catos-v2-cli-"));
  await mkdir(path.join(cwd, "projects"));
  await mkdir(path.join(cwd, "repository"));
  await writeFile(path.join(cwd, "projects", "demo.yaml"), [
    "project:", "  id: demo", "  name: Demo", "  repoPath: ../repository",
    "commands:", "  typecheck: npm run typecheck", "  test: npm test", "  build: npm run build",
    "workflow:", "  maxReworkAttempts: 2", "  createCommit: true",
    "permissions:", "  allowNetwork: false", "  allowPush: false", "  allowMerge: false",
  ].join("\n"));
  return cwd;
}

describe("v2 run CLI adapter", () => {
  it.each([["--task", "legacy task"], ["--execution-plan", "plan.json"]])("rejects %s without creating an Analyst fallback", async (name, value) => {
    const preflight = vi.fn();
    await expect(runCommand(["--project", "demo", name, value, "--task-package", "package"], { preflight })).rejects.toThrow(/legacy vstup.*Analyst fallback neexistuje/i);
    expect(preflight).not.toHaveBeenCalled();
  });

  it("requires both v2 authority inputs", async () => {
    await expect(runCommand(["--task-package", "package"])).rejects.toThrow("--project");
    await expect(runCommand(["--project", "demo"])).rejects.toThrow("--task-package");
  });

  it("delegates a frozen Task Package to the v2 core and never invokes legacy model modules", async () => {
    const release = vi.fn().mockResolvedValue(undefined);
    const preflight = vi.fn().mockResolvedValue({ task, workspacePath: "/tmp/workspace", baseCommitSha: task.baseCommitSha, baseline: [], runtimeMetadata: { policy: "deny", allowedNames: [], deniedNames: [] }, release });
    const orchestrator = vi.fn().mockResolvedValue({ status: "APPROVED", steps: [] });
    const log = vi.fn();
    const cwd = await fixtureCwd();
    await expect(runCommand(["--project", "demo", "--task-package", "packages/task-1"], { cwd, runId: "run-1", preflight, orchestrator, log })).resolves.toMatchObject({ status: "APPROVED" });
    expect(preflight).toHaveBeenCalledWith(expect.objectContaining({ packageDir: expect.stringMatching(/packages[\\/]task-1$/), artifactDir: expect.stringMatching(/runs[\\/]run-1$/), runId: "run-1" }));
    expect(orchestrator).toHaveBeenCalledWith(expect.objectContaining({ task, workspacePath: "/tmp/workspace", artifactDir: expect.stringMatching(/runs[\\/]run-1$/), runId: "run-1", taskPackagePath: expect.stringMatching(/packages[\\/]task-1[\\/]task\.json$/) }));
    expect(release).toHaveBeenCalledOnce();
    expect(log).toHaveBeenCalledWith("v2 run run-1: APPROVED");
  });

  it("keeps the Task Package byte-identical while fake-Codex run artifacts use runs/<RUN_ID>", async () => {
    const cwd = await fixtureCwd();
    const packageDir = path.join(cwd, "packages", "task-1");
    await mkdir(packageDir, { recursive: true });
    await writeFile(path.join(packageDir, "task.json"), JSON.stringify(task));
    await writeFile(path.join(packageDir, "approved-note.txt"), "frozen bytes\n");
    const before = await Promise.all((await readdir(packageDir)).sort().map(async file => [file, await readFile(path.join(packageDir, file))] as const));
    const release = vi.fn().mockResolvedValue(undefined);
    const preflight = vi.fn().mockResolvedValue({ task, workspacePath: "/tmp/workspace", baseCommitSha: task.baseCommitSha, baseline: [], runtimeMetadata: { policy: "deny", allowedNames: [], deniedNames: [] }, release });
    const orchestrator = vi.fn().mockImplementation(async ({ artifactDir }: { artifactDir: string }) => { await mkdir(artifactDir, { recursive: true }); await writeFile(path.join(artifactDir, "fake-codex.json"), "offline\n"); return { status: "APPROVED", steps: [] }; });

    await runCommand(["--project", "demo", "--task-package", "packages/task-1"], { cwd, runId: "offline-fake", preflight, orchestrator });

    const after = await Promise.all((await readdir(packageDir)).sort().map(async file => [file, await readFile(path.join(packageDir, file))] as const));
    expect(after).toEqual(before);
    await expect(readFile(path.join(cwd, "runs", "offline-fake", "fake-codex.json"), "utf8")).resolves.toBe("offline\n");
    expect(await readdir(packageDir)).not.toContain("artifacts");
  });

  it("keeps the production adapter free of legacy Analyst, Reviewer, SDK, and publish Git paths", async () => {
    const source = await import("node:fs/promises").then(({ readFile }) => readFile(new URL("../src/cli/run.ts", import.meta.url), "utf8"));
    expect(source).not.toMatch(/agents\/(taskAnalyst|reviewer)|codingWorker|executionPlan|@openai\/(agents|codex-sdk)/);
    expect(source).not.toMatch(/\b(push|publish|pull-request|pr)\b/i);
  });

  it("resolves the source entrypoint module without a model call", async () => {
    await expect(import("../src/index.js")).resolves.toBeDefined();
  });
});
