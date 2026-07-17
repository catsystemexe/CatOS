import { execFile } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { runTaskChecks } from "../src/autocodex/checks.js";
import { runTestProcess } from "../src/autocodex/testRunner.js";
import type { TaskPackage } from "../src/autocodex/taskPackage.js";

const exec = promisify(execFile);
async function fixture() {
  const workspace = await mkdtemp(path.join(os.tmpdir(), "catos-checks-")); const artifacts = path.join(workspace, "artifacts");
  await exec("git", ["init", "-q"], { cwd: workspace }); await exec("git", ["config", "user.name", "Test"], { cwd: workspace }); await exec("git", ["config", "user.email", "test@example.invalid"], { cwd: workspace });
  await writeFile(path.join(workspace, "README.md"), "base\n"); await exec("git", ["add", "."], { cwd: workspace }); await exec("git", ["commit", "-qm", "base"], { cwd: workspace });
  const task: TaskPackage = { schemaVersion: 2, taskId: "task", task: "test", baseCommitSha: (await exec("git", ["rev-parse", "HEAD"], { cwd: workspace })).stdout.trim(), checks: [], steps: [{ id: "step", title: "step", dependsOn: [], checks: [], files: [] }] };
  return { workspace, artifacts, task };
}
const node = (code: string) => [process.execPath, "-e", code];

describe("AutoCodex frozen test runner", () => {
  it("passes argv directly, does not expand shell metacharacters, and writes logs", async () => {
    const f = await fixture(); const marker = path.join(f.workspace, "owned");
    const result = await runTestProcess({ argv: node(`process.stdout.write(process.argv[1])`).concat([`; touch ${marker}`]), cwd: f.workspace, timeoutMs: 5_000, environment: { PATH: process.env.PATH, OPENAI_API_KEY: "secret" }, logPaths: { stdout: path.join(f.artifacts, "out"), stderr: path.join(f.artifacts, "err") } });
    expect(result.exitCode).toBe(0); await expect(readFile(marker)).rejects.toThrow(); expect(await readFile(result.stdoutPath, "utf8")).toContain("; touch"); expect(await readFile(result.stderrPath, "utf8")).resolves.toBe("");
  });
  it("enforces mustPassAtBaseline while recording an explicitly permitted baseline failure", async () => {
    const f = await fixture(); f.task.checks = [{ id: "known", argv: node("process.exit(2)"), required: true, blocking: true, timeoutSeconds: 120, mustPassAtBaseline: false }, { id: "good", argv: node("process.exit(0)"), required: true, blocking: true, timeoutSeconds: 120, mustPassAtBaseline: true }];
    const report = await runTaskChecks({ task: Object.freeze(f.task), workspacePath: f.workspace, artifactDir: f.artifacts, phase: "BASELINE" }); expect(report.status).toBe("PASS"); expect(report.results.map(x => x.status)).toEqual(["FAIL", "PASS"]);
    f.task.checks[0]!.mustPassAtBaseline = true; expect((await runTaskChecks({ task: Object.freeze(f.task), workspacePath: f.workspace, artifactDir: f.artifacts, phase: "BASELINE" })).status).toBe("REWORK_TESTS");
  });
  it("makes only blocking ordinary test failures rework", async () => {
    const f = await fixture(); f.task.checks = [{ id: "optional", argv: node("process.exit(3)"), required: false, blocking: false, timeoutSeconds: 120, mustPassAtBaseline: false }, { id: "required", argv: node("process.exit(4)"), required: true, blocking: true, timeoutSeconds: 120, mustPassAtBaseline: false }]; f.task.steps[0]!.checks = ["optional", "required"];
    const report = await runTaskChecks({ task: Object.freeze(f.task), workspacePath: f.workspace, artifactDir: f.artifacts, phase: "POST_COMMIT", stepId: "step" }); expect(report.status).toBe("REWORK_TESTS"); expect(report.results.map(x => x.status)).toEqual(["FAIL", "FAIL"]);
    f.task.checks.pop(); f.task.steps[0]!.checks = ["optional"]; expect((await runTaskChecks({ task: Object.freeze(f.task), workspacePath: f.workspace, artifactDir: f.artifacts, phase: "POST_COMMIT", stepId: "step" })).status).toBe("PASS");
  });
  it("treats timeout and signal as failed test processes", async () => {
    const f = await fixture(); f.task.checks = [{ id: "slow", argv: node("setTimeout(() => {}, 10_000)"), required: false, blocking: false, timeoutSeconds: 120, mustPassAtBaseline: false }]; f.task.steps[0]!.checks = ["slow"];
    expect((await runTaskChecks({ task: Object.freeze(f.task), workspacePath: f.workspace, artifactDir: f.artifacts, phase: "POST_COMMIT", stepId: "step", timeoutMs: 20 })).status).toBe("FAILED_TEST_PROCESS");
    f.task.checks[0]!.argv = node("process.kill(process.pid, 'SIGTERM')"); const report = await runTaskChecks({ task: Object.freeze(f.task), workspacePath: f.workspace, artifactDir: f.artifacts, phase: "POST_COMMIT", stepId: "step" }); expect(report.status).toBe("FAILED_TEST_PROCESS"); expect(report.results[0]?.status).toBe("SIGNAL");
  });
  it("rejects test-created Git mutations as failed processes", async () => {
    const f = await fixture(); f.task.checks = [{ id: "mutate", argv: node("require('fs').writeFileSync('changed.txt', 'x')"), required: false, blocking: false, timeoutSeconds: 120, mustPassAtBaseline: false }]; f.task.steps[0]!.checks = ["mutate"];
    const report = await runTaskChecks({ task: Object.freeze(f.task), workspacePath: f.workspace, artifactDir: f.artifacts, phase: "POST_COMMIT", stepId: "step" }); expect(report.status).toBe("FAILED_TEST_PROCESS"); expect(report.results[0]).toMatchObject({ status: "GIT_MUTATION" });
  });
});
