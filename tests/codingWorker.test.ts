import { mkdtemp, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { buildIsolatedWorkspacePath, CodexSdkWorker, normalizeWorkBranchName, writeCodingArtifacts, type CodingResult } from "../src/codingWorker.js";

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

    await expect(worker.executeTask({ instruction: "x", repositoryPath: directory, baseBranch: "main", runId: "run", workspaceRoot: path.join(os.tmpdir(), "catos-workspaces") })).rejects.toThrow(/Git command failed/);
  });

  it("rejects a missing base branch before starting Codex", async () => {
    const repo = await createRepo("main");
    const worker = new CodexSdkWorker({ codexFactory: () => { throw new Error("Codex must not start"); } });

    await expect(worker.executeTask({ instruction: "x", repositoryPath: repo, baseBranch: "missing", runId: "run", workspaceRoot: path.join(os.tmpdir(), "catos-run-missing") })).rejects.toThrow(/Git command failed/);
  });

  it("normalizes unsafe work branch names", () => {
    expect(normalizeWorkBranchName(" ../Bad Run:@{x}.lock ")).toBe("catos/Bad-Run-x");
    expect(normalizeWorkBranchName("***")).toBe("catos/run");
  });

  it("creates an isolated worktree and leaves the original checkout unchanged while collecting Git diff data", async () => {
    const repo = await createRepo("main");
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "catos-worker-workspaces-"));
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

    const result = await worker.executeTask({ instruction: "Change README", repositoryPath: repo, baseBranch: "main", runId: "run 1", workspaceRoot });

    expect(receivedInstruction).toContain("Change README");
    expect(receivedInstruction).toContain("Do not create commits, push, merge, or rebase.");
    expect(receivedWorkspace).toBe(path.join(workspaceRoot, "run-1", "workspace"));
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



  it("builds worktree path outside CatOS root and rejects unsafe workspace roots", async () => {
    const catosRoot = await mkdtemp(path.join(os.tmpdir(), "catos-root-"));
    const repo = await createRepo("main");
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "catos-external-workspaces-"));

    const workspacePath = await buildIsolatedWorkspacePath({ workspaceRoot, runId: "run-42", repositoryPath: repo, catosRoot });
    expect(workspacePath).toBe(path.join(workspaceRoot, "run-42", "workspace"));
    expect(path.relative(catosRoot, workspacePath).startsWith("..")).toBe(true);

    await expect(buildIsolatedWorkspacePath({ workspaceRoot: path.join(catosRoot, "runs"), runId: "bad", repositoryPath: repo, catosRoot })).rejects.toThrow(/CatOS repository root/);
    await expect(buildIsolatedWorkspacePath({ workspaceRoot: path.join(repo, "nested"), runId: "bad", repositoryPath: repo, catosRoot })).rejects.toThrow(/target repository checkout/);
  });

  it("passes danger-full-access to the SDK only when explicitly requested and records disabled isolation", async () => {
    const repo = await createRepo("main");
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "catos-worker-danger-workspaces-"));
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

    const result = await worker.executeTask({ instruction: "Change README", repositoryPath: repo, baseBranch: "main", runId: "danger", workspaceRoot, sandboxMode: "danger-full-access" });

    expect(receivedSandboxMode).toBe("danger-full-access");
    expect(result.sandboxMode).toBe("danger-full-access");
    expect(result.sandboxIsolation).toBe("disabled");
  });

  it("continues an existing Codex thread for rework in the same workspace", async () => {
    const workspace = await mkdtemp(path.join(os.tmpdir(), "catos-rework-workspace-"));
    await git(["init", "-b", "main"], workspace);
    await git(["config", "user.email", "catos@example.test"], workspace);
    await git(["config", "user.name", "CatOS Test"], workspace);
    await writeFile(path.join(workspace, "README.md"), "before\n", "utf8");
    await git(["add", "README.md"], workspace);
    await git(["commit", "-m", "initial"], workspace);
    let resumedThreadId = "";
    let resumedWorkspace = "";
    let instruction = "";
    const worker = new CodexSdkWorker({
      codexFactory: () => ({
        startThread: () => { throw new Error("must not start a new thread"); },
        resumeThread: (threadId, { workingDirectory }) => {
          resumedThreadId = threadId;
          resumedWorkspace = workingDirectory;
          return {
            id: threadId,
            run: async (inputInstruction: string) => {
              instruction = inputInstruction;
              await writeFile(path.join(workingDirectory, "README.md"), "after rework\n", "utf8");
              return { finalResponse: "reworked" };
            },
          };
        },
      }),
    });

    const result = await worker.continueTask({
      threadId: "thread-existing",
      workspacePath: workspace,
      sandboxMode: "workspace-write",
      reworkPackage: {
        schemaVersion: 1,
        attempt: 1,
        originalObjective: "Fix README",
        acceptanceCriteria: ["README is fixed"],
        blockingFindings: [{ id: "b1", title: "README not fixed", evidence: "before", requiredChange: "Write after rework" }],
        preserve: ["Keep unrelated files"],
        mustChange: ["Write after rework"],
        mustNotChange: ["Do not commit"],
        previousAttemptSummary: "Initial attempt missed README.",
      },
    });

    expect(resumedThreadId).toBe("thread-existing");
    expect(resumedWorkspace).toBe(workspace);
    expect(instruction).toContain("Rework attempt: 1");
    expect(instruction).toContain("Required change: Write after rework");
    expect(result.threadId).toBe("thread-existing");
    expect(result.workspacePath).toBe(workspace);
    expect(result.diff).toContain("after rework");
  });

  it("keeps the fake Codex workingDirectory scoped to the run workspace", async () => {
    const repo = await createRepo("main");
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "catos-worker-cwd-workspaces-"));
    let receivedWorkspace = "";
    const worker = new CodexSdkWorker({
      codexFactory: () => ({
        startThread: ({ workingDirectory }) => {
          receivedWorkspace = workingDirectory;
          return { id: "thread-cwd", run: async () => ({ finalResponse: "no changes" }) };
        },
      }),
    });

    const result = await worker.executeTask({ instruction: "Inspect only", repositoryPath: repo, baseBranch: "main", runId: "cwd", workspaceRoot });

    expect(receivedWorkspace).toBe(path.join(workspaceRoot, "cwd", "workspace"));
    expect(result.workspacePath).toBe(receivedWorkspace);
  });
});
