import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { CodexSdkWorker, normalizeWorkBranchName, writeCodingArtifacts, type CodingResult } from "../src/codingWorker.js";

const execFileAsync = promisify(execFile);

async function git(args: string[], cwd: string): Promise<string> {
  const { stdout } = await execFileAsync("git", args, { cwd, encoding: "utf8" });
  return stdout;
}

async function createRepo(branch = "main"): Promise<string> {
  const repo = await mkdtemp(path.join(os.tmpdir(), "catos-git-"));
  await git(["init", "-b", branch], repo);
  await git(["config", "user.email", "catos@example.test"], repo);
  await git(["config", "user.name", "CatOS Test"], repo);
  await writeFile(path.join(repo, "README.md"), "before\n", "utf8");
  await git(["add", "README.md"], repo);
  await git(["commit", "-m", "initial"], repo);
  return repo;
}

describe("writeCodingArtifacts", () => {
  it("writes coding-result.json, workspace.diff, and workspace-status.txt from a result", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "catos-artifacts-"));
    const result: CodingResult = {
      threadId: "thread-123",
      finalResponse: "done",
      workspacePath: path.join(runDir, "workspace"),
      changedFiles: ["src/a.ts", "README.md"],
      diff: "diff --git a/README.md b/README.md\n",
      status: " M README.md\n",
      sandboxMode: "danger-full-access",
      sandboxIsolation: "disabled",
    };

    const artifacts = await writeCodingArtifacts(runDir, { codexInstruction: "Do it" }, result);

    const codingResult = JSON.parse(await readFile(artifacts.codingResultPath, "utf8"));
    expect(codingResult).toEqual({
      schemaVersion: 1,
      threadId: "thread-123",
      workspacePath: result.workspacePath,
      changedFiles: ["src/a.ts", "README.md"],
      finalResponse: "done",
      sandboxMode: "danger-full-access",
      sandboxIsolation: "disabled",
    });
    await expect(readFile(artifacts.diffPath, "utf8")).resolves.toBe(result.diff);
    await expect(readFile(artifacts.statusPath, "utf8")).resolves.toBe(result.status);
  });
});

describe("CodexSdkWorker", () => {
  it("rejects a path that is not a Git repository", async () => {
    const directory = await mkdtemp(path.join(os.tmpdir(), "catos-not-git-"));
    const worker = new CodexSdkWorker({ codexFactory: () => { throw new Error("Codex must not start"); } });

    await expect(worker.executeTask({ instruction: "x", repositoryPath: directory, baseBranch: "main", runId: "run", runDir: path.join(directory, "run") })).rejects.toThrow(/Git command failed/);
  });

  it("rejects a missing base branch before starting Codex", async () => {
    const repo = await createRepo("main");
    const worker = new CodexSdkWorker({ codexFactory: () => { throw new Error("Codex must not start"); } });

    await expect(worker.executeTask({ instruction: "x", repositoryPath: repo, baseBranch: "missing", runId: "run", runDir: path.join(os.tmpdir(), "catos-run-missing") })).rejects.toThrow(/Git command failed/);
  });

  it("normalizes unsafe work branch names", () => {
    expect(normalizeWorkBranchName(" ../Bad Run:@{x}.lock ")).toBe("catos/Bad-Run-x");
    expect(normalizeWorkBranchName("***")).toBe("catos/run");
  });

  it("creates an isolated worktree and leaves the original checkout unchanged while collecting Git diff data", async () => {
    const repo = await createRepo("main");
    const runsRoot = await mkdtemp(path.join(os.tmpdir(), "catos-worker-"));
    const runDir = path.join(runsRoot, "run-1");
    let receivedInstruction = "";
    let receivedWorkspace = "";
    let receivedSandboxMode = "";
    const worker = new CodexSdkWorker({
      codexFactory: () => ({
        startThread: ({ workingDirectory, sandboxMode }) => {
          receivedWorkspace = workingDirectory;
          receivedSandboxMode = sandboxMode ?? "";
          return {
            id: "thread-local",
            run: async (instruction: string) => {
              receivedInstruction = instruction;
              await writeFile(path.join(workingDirectory, "README.md"), "after\n", "utf8");
              await writeFile(path.join(workingDirectory, "new file.txt"), "new content\n", "utf8");
              await writeFile(path.join(workingDirectory, "bin file.dat"), Buffer.from([0, 1, 2]));
              return { finalResponse: "changed files" };
            },
          };
        },
      }),
    });

    const result = await worker.executeTask({ instruction: "Change README", repositoryPath: repo, baseBranch: "main", runId: "run 1", runDir });

    expect(receivedInstruction).toContain("Change README");
    expect(receivedInstruction).toContain("Do not create commits, push, merge, or rebase.");
    expect(receivedWorkspace).toBe(path.join(runDir, "workspace"));
    expect(receivedSandboxMode).toBe("workspace-write");
    expect(result.workspacePath).toBe(receivedWorkspace);
    expect(result.threadId).toBe("thread-local");
    expect(result.changedFiles).toEqual(["README.md", "bin file.dat", "new file.txt"]);
    expect(result.diff).toContain("after");
    expect(result.diff).toContain("new file.txt");
    expect(result.diff).toContain("new content");
    expect(result.diff).toContain("bin file.dat");
    expect(result.diff).toContain("GIT binary patch");
    expect(result.status).toContain("README.md");
    expect(result.sandboxMode).toBe("workspace-write");
    expect(result.sandboxIsolation).toBe("enabled");
    await expect(readFile(path.join(repo, "README.md"), "utf8")).resolves.toBe("before\n");
    await expect(git(["status", "--short"], repo)).resolves.toBe("");
  });

  it("passes danger-full-access to the SDK only when explicitly requested and records disabled isolation", async () => {
    const repo = await createRepo("main");
    const runsRoot = await mkdtemp(path.join(os.tmpdir(), "catos-worker-danger-"));
    const runDir = path.join(runsRoot, "run-1");
    let receivedSandboxMode = "";
    const worker = new CodexSdkWorker({
      codexFactory: () => ({
        startThread: ({ workingDirectory, sandboxMode }) => {
          receivedSandboxMode = sandboxMode ?? "";
          return {
            id: "thread-danger",
            run: async () => {
              await writeFile(path.join(workingDirectory, "README.md"), "danger mode edit\n", "utf8");
              return { finalResponse: "changed files" };
            },
          };
        },
      }),
    });

    const result = await worker.executeTask({ instruction: "Change README", repositoryPath: repo, baseBranch: "main", runId: "danger", runDir, sandboxMode: "danger-full-access" });

    expect(receivedSandboxMode).toBe("danger-full-access");
    expect(result.sandboxMode).toBe("danger-full-access");
    expect(result.sandboxIsolation).toBe("disabled");
  });

  it("keeps the fake Codex workingDirectory scoped to the run workspace", async () => {
    const repo = await createRepo("main");
    const runsRoot = await mkdtemp(path.join(os.tmpdir(), "catos-worker-cwd-"));
    const runDir = path.join(runsRoot, "run-1");
    let receivedWorkspace = "";
    const worker = new CodexSdkWorker({
      codexFactory: () => ({
        startThread: ({ workingDirectory }) => {
          receivedWorkspace = workingDirectory;
          return { id: "thread-cwd", run: async () => ({ finalResponse: "no changes" }) };
        },
      }),
    });

    const result = await worker.executeTask({ instruction: "Inspect only", repositoryPath: repo, baseBranch: "main", runId: "cwd", runDir });

    expect(receivedWorkspace).toBe(path.join(runDir, "workspace"));
    expect(result.workspacePath).toBe(receivedWorkspace);
  });
});
