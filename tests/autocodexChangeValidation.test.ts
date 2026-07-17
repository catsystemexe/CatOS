import { execFile } from "node:child_process";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { captureAttemptGitGuards, validateChanges } from "../src/autocodex/changeValidation.js";
import { commitValidatedChanges } from "../src/autocodex/gitCommit.js";

const exec = promisify(execFile);
async function command(cwd: string, ...args: string[]) { await exec("git", args, { cwd }); }
async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "catos-change-")); const workspace = path.join(root, "repo"); const artifacts = path.join(root, "artifacts");
  await mkdir(workspace); await command(workspace, "init", "-q"); await command(workspace, "config", "user.name", "Test"); await command(workspace, "config", "user.email", "test@example.invalid");
  await writeFile(path.join(workspace, "README.md"), "base\n"); await command(workspace, "add", "."); await command(workspace, "commit", "-qm", "base");
  return { workspace, artifacts };
}
async function input(f: Awaited<ReturnType<typeof fixture>>, guards = await captureAttemptGitGuards(f.workspace)) {
  return { workspacePath: f.workspace, artifactDir: f.artifacts, taskId: "task", stepId: "step", attemptId: "attempt", runId: "run", ...guards, expectedBranch: guards.branch, attemptBaseTags: guards.tags, attemptBaseSubmodules: guards.submodules, globalPathRules: ["src/**"], stepPathRules: ["src/**"] };
}

describe("AutoCodex v2 change validation", () => {
  it("permits only the allowed change, persists evidence, and commits it", async () => {
    const f = await fixture(); const i = await input(f); await mkdir(path.join(f.workspace, "src")); await writeFile(path.join(f.workspace, "src", "ok.ts"), "export {};\n");
    expect((await validateChanges(i)).status).toBe("PASS");
    expect(JSON.parse(await readFile(path.join(f.artifacts, "changed-files.json"), "utf8")).changedFiles[0].path).toBe("src/ok.ts");
    const commit = await commitValidatedChanges({ ...i, codingStatus: "COMPLETED" }); expect(commit.parentSha).toBe(i.attemptBaseCommit); expect(commit.resultSha).not.toBe(commit.parentSha);
    await expect(readFile(path.join(f.artifacts, "commit.json"), "utf8")).resolves.toContain('"taskId": "task"');
  });
  it("fails a prohibited path and task package mutation", async () => {
    const f = await fixture(); const i = await input(f); await writeFile(path.join(f.workspace, "nope.txt"), "x"); await writeFile(path.join(f.workspace, "task.json"), "{}\n");
    const report = await validateChanges({ ...i, taskPackagePath: path.join(f.workspace, "task.json") }); expect(report.status).toBe("FAIL"); expect(report.violations.join(" ")).toMatch(/global rules.*Task Package mutation/i);
  });
  it("fails HEAD, branch, tag, and submodule guards", async () => {
    const f = await fixture(); const i = await input(f); await mkdir(path.join(f.workspace, "src")); await writeFile(path.join(f.workspace, "src", "x"), "x"); await command(f.workspace, "tag", "created-by-coding"); await command(f.workspace, "checkout", "-qb", "other"); await command(f.workspace, "add", "src/x"); await command(f.workspace, "commit", "-qm", "bad");
    const report = await validateChanges(i); expect(report.violations.join(" ")).toMatch(/Unexpected HEAD.*Unexpected branch.*Tags changed/i);
  });
  it("fails zero diffs and refuses BLOCKED Coding without creating a commit", async () => {
    const f = await fixture(); const i = await input(f); expect((await validateChanges(i)).violations.join(" ")).toMatch(/Zero diff/);
    await expect(commitValidatedChanges({ ...i, codingStatus: "BLOCKED" })).rejects.toThrow(/BLOCKED/);
  });
});
