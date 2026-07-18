import { test, expect } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { listBranches, listRepositories, loadManualRepository, startRun } from "../src/uiApi.js";

const exec = promisify(execFile);

async function root() {
  return mkdtemp(path.join(os.tmpdir(), "catos-api-"));
}

async function repo(r: string, n = "repo") {
  const p = path.join(r, n);
  await mkdir(p, { recursive: true });
  await exec("git", ["init", "-b", "main"], { cwd: p });
  await writeFile(path.join(p, "README.md"), "x");
  await exec("git", ["add", "."], { cwd: p });
  await exec("git", ["-c", "user.name=t", "-c", "user.email=t@e.invalid", "commit", "-m", "init"], { cwd: p });
  return p;
}

test("repo selector is populated from GitHub API only while manual branches still load locally", async () => {
  const cwd = await root();
  const managed = path.join(cwd, "managed");
  const owner = path.join(managed, "test-owner");
  const a = await repo(owner, "a");
  await repo(owner, "b");
  await writeFile(path.join(cwd, "catos.config.yaml"), `repositoryRoots:\n  - ${managed}\n`);
  const env = { CATOS_REPOSITORIES_ROOT: managed } as NodeJS.ProcessEnv;
  const res = await listRepositories({
    cwd,
    env,
    githubProvider: async () => ({
      repositories: [{ id: 1, name: "remote", fullName: "owner/remote", cloneUrl: "https://github.com/owner/remote.git", defaultBranch: "main", isPrivate: false }],
      github: { available: true, error: null },
    }),
  });
  expect(res).toMatchObject({ total: 1, githubCount: 1, localCount: 0 });
  expect(res.repositories).toEqual([{ id: "github:owner/remote", source: "github", name: "owner/remote", fullName: "owner/remote", cloneUrl: "https://github.com/owner/remote.git", defaultBranch: "main", isPrivate: false, isAvailableLocally: false }]);
  const branches = await listBranches(a);
  expect(branches.branches.map((b) => b.name)).toContain("main");
});

test("manual repo path validates while v2 UI start fails closed", async () => {
  const cwd = await root();
  const p = await repo(cwd);
  await expect(loadManualRepository(p)).resolves.toMatchObject({ repository: { path: p } });
  await expect(startRun({ repositoryPath: p, baseBranch: "missing", prTargetBranch: "main", task: "x" }, { cwd, runsDir: path.join(cwd, "runs") })).rejects.toThrow("UI start is disabled for AutoCodex v2");
  await expect(startRun({ repositoryPath: p, baseBranch: "missing", prTargetBranch: "main", task: "x" }, { cwd, runsDir: path.join(cwd, "runs") })).rejects.toThrow("--project <id> --task-package <directory>");
});

test("API API MVP clone flow returns checkout localPath for run payload", async () => {
  const cwd = await root();
  const src = await repo(cwd, "source");
  await exec("git", ["checkout", "-b", "feature-test"], { cwd: src });
  await writeFile(path.join(src, "feature.txt"), "feature-test");
  await exec("git", ["add", "."], { cwd: src });
  await exec("git", ["-c", "user.name=t", "-c", "user.email=t@e.invalid", "commit", "-m", "feature"], { cwd: src });
  const bare = path.join(cwd, "remote.git");
  await exec("git", ["clone", "--bare", src, bare]);
  const managed = path.join(cwd, "managed");
  await writeFile(path.join(cwd, "catos.config.yaml"), `repositoryRoots:\n  - ${managed}\n`);
  const gh = { repositories: [{ id: 1, name: "repo", fullName: "owner/repo", cloneUrl: `file://${bare}`, defaultBranch: "main", isPrivate: false }], github: { available: true, error: null } };
  const ctx = { cwd, env: { CATOS_REPOSITORIES_ROOT: managed } as NodeJS.ProcessEnv, githubProvider: async () => gh };
  const listed = await listRepositories(ctx);
  expect(listed.repositories.some((r) => r.id === "github:owner/repo")).toBe(true);
  const remoteBranches = await listBranches("", "github:owner/repo", ctx);
  expect(remoteBranches.branches.map((b) => b.name)).toContain("feature-test");
  const { cloneRepository } = await import("../src/uiApi.js");
  const selectedBranch = "feature-test";
  const expectedTarget = path.join(managed, "Cloned", "owner", "repo", "feature-test");
  const cloned = await cloneRepository({ repositoryId: "github:owner/repo", branch: selectedBranch }, ctx);
  expect(cloned.checkout.localPath).toBe(expectedTarget);
  expect(cloned.checkout.branch).toBe(selectedBranch);
  expect(cloned.checkout.headCommit).toMatch(/^[0-9a-f]{40}$/);
  const runPayload = { repositoryPath: cloned.checkout.localPath, baseBranch: cloned.checkout.branch, prTargetBranch: cloned.checkout.branch, task: "do it" };
  expect(runPayload.repositoryPath).toBe(expectedTarget);
  expect(runPayload.baseBranch).toBe(selectedBranch);
});

import { readRunOutput } from "../src/uiApi.js";

test("relative output path resolves against finalWorkspacePath", async () => {
  const cwd = await root();
  const runsDir = path.join(cwd, "runs");
  const runId = "run-output";
  const runDir = path.join(runsDir, runId);
  const ws = path.join(cwd, "workspace");
  await mkdir(path.join(ws, "docs"), { recursive: true });
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(ws, "docs", "AUTOCODEX_TEST.md"), "task output\n", "utf8");
  await writeFile(path.join(runDir, "final-result.json"), JSON.stringify({ schemaVersion:1, runId, status:"ACCEPTED", finalReviewVerdict:"ACCEPT", totalCodingAttempts:1, reworkAttempts:0, finalWorkspacePath:ws, finalChangedFiles:["docs/AUTOCODEX_TEST.md"], finalValidationStatus:"PASS", finalReviewReportPath:path.join(runDir,"review-report.json") }), "utf8");
  const out = await readRunOutput(runId, "docs/AUTOCODEX_TEST.md", { cwd, runsDir });
  expect(out).toEqual({ path: "docs/AUTOCODEX_TEST.md", content: "task output\n" });
});
