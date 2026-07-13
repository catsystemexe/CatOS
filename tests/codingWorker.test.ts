import { mkdtemp, readFile, realpath as fsRealpath, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { buildIsolatedWorkspacePath, CodexSdkWorker, createForkedCodexRuntimeRunner, guardCodexWorkspace, normalizeWorkBranchName, writeCodingArtifacts, type CodingResult } from "../src/codingWorker.js";

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
    const worker = new CodexSdkWorker({ codexRuntimeRunner: async () => { throw new Error("Codex must not start"); } });

    await expect(worker.executeTask({ instruction: "x", repositoryPath: directory, baseBranch: "main", runId: "run", workspaceRoot: path.join(os.tmpdir(), "catos-workspaces") })).rejects.toThrow(/Git command failed/);
  });

  it("rejects a missing base branch before starting Codex", async () => {
    const repo = await createRepo("main");
    const worker = new CodexSdkWorker({ codexRuntimeRunner: async () => { throw new Error("Codex must not start"); } });

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
      codexRuntimeRunner: async ({ request }) => {
        receivedWorkspace = request.workingDirectory;
        receivedSandboxMode = request.sandboxMode;
        receivedInstruction = request.instruction;
        await writeFile(path.join(request.workingDirectory, "README.md"), "after\n", "utf8");
        await writeFile(path.join(request.workingDirectory, "new file.txt"), "new content\n", "utf8");
        await writeFile(path.join(request.workingDirectory, "bin file.dat"), Buffer.from([0, 1, 2]));
        return { threadId: "thread-local", finalResponse: "changed files" };
      },
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
    const manifest = JSON.parse(await readFile(path.join(workspaceRoot, "run-1", "runtime", "runtime.json"), "utf8"));
    expect(manifest.workspacePath).toBe(receivedWorkspace);
    expect(manifest.workspaceRoot).toBe(workspaceRoot);
    expect(manifest.environmentPolicy).toBe("allowlist");
    expect(manifest.allowedEnvironmentVariables).toContain("HOME");
    expect(manifest.allowedEnvironmentVariables).toContain("TMPDIR");
    expect(manifest.allowedEnvironmentVariables).toContain("GIT_CONFIG_GLOBAL");
    expect(manifest.allowedEnvironmentVariables).not.toContain("GITHUB_TOKEN");
    expect(manifest.githubCredentialsRemoved).toBe(true);
    expect(manifest.sshAgentRemoved).toBe(true);
    expect(JSON.stringify(manifest)).not.toContain("secret-value");
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
      codexRuntimeRunner: async ({ request }) => {
        receivedSandboxMode = request.sandboxMode;
        await writeFile(path.join(request.workingDirectory, "README.md"), "danger mode edit\n", "utf8");
        return { threadId: "thread-danger", finalResponse: "changed files" };
      },
    });

    const result = await worker.executeTask({ instruction: "Change README", repositoryPath: repo, baseBranch: "main", runId: "danger", workspaceRoot, sandboxMode: "danger-full-access" });

    expect(receivedSandboxMode).toBe("danger-full-access");
    expect(result.sandboxMode).toBe("danger-full-access");
    expect(result.sandboxIsolation).toBe("disabled");
  });

  it("guards Codex workspaces with realpath and rejects paths outside the allowed root", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "catos-guard-root-"));
    const workspace = path.join(workspaceRoot, "run", "workspace");
    await mkdir(workspace, { recursive: true });
    await expect(guardCodexWorkspace({ workspacePath: workspace, workspaceRoot })).resolves.toEqual({
      workspacePath: await fsRealpath(workspace),
      workspaceRoot: await fsRealpath(workspaceRoot),
    });

    const outside = await mkdtemp(path.join(os.tmpdir(), "catos-guard-outside-"));
    await expect(guardCodexWorkspace({ workspacePath: outside, workspaceRoot })).rejects.toThrow(/inside configured workspace root/);
    await expect(guardCodexWorkspace({ workspacePath: os.homedir(), workspaceRoot })).rejects.toThrow(/HOME|inside configured workspace root/);
  });

  it("scrubs child Codex process environment to an explicit allowlist", async () => {
    const previousGithubToken = process.env.GITHUB_TOKEN;
    const previousSecret = process.env.MY_PRIVATE_API_KEY;
    const previousSsh = process.env.SSH_AUTH_SOCK;
    const beforeEnv = { ...process.env };
    process.env.GITHUB_TOKEN = "secret-value";
    process.env.MY_PRIVATE_API_KEY = "secret-value";
    process.env.SSH_AUTH_SOCK = "/tmp/agent.sock";
    try {
      const repo = await createRepo("main");
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "catos-worker-env-workspaces-"));
      let observedEnv: NodeJS.ProcessEnv = {};
      const worker = new CodexSdkWorker({
        codexRuntimeRunner: async ({ request, env }) => {
          observedEnv = { ...env };
          expect(request.mode).toBe("start");
          return { threadId: "thread-env", finalResponse: "ok" };
        },
      });

      await worker.executeTask({ instruction: "Inspect env", repositoryPath: repo, baseBranch: "main", runId: "env", workspaceRoot });

      expect(process.env.GITHUB_TOKEN).toBe("secret-value");
      expect(process.env.MY_PRIVATE_API_KEY).toBe("secret-value");
      expect(process.env.SSH_AUTH_SOCK).toBe("/tmp/agent.sock");
      expect(observedEnv.GITHUB_TOKEN).toBeUndefined();
      expect(observedEnv.MY_PRIVATE_API_KEY).toBeUndefined();
      expect(observedEnv.SSH_AUTH_SOCK).toBeUndefined();
      expect(observedEnv.GIT_CONFIG_GLOBAL).toBe("/dev/null");
      expect(observedEnv.GIT_CONFIG_SYSTEM).toBe("/dev/null");
      expect(observedEnv.GIT_TERMINAL_PROMPT).toBe("0");
      expect(observedEnv.HOME).toBe(path.join(workspaceRoot, "env", "runtime", "home"));
      expect(Object.keys(observedEnv).sort()).toEqual(expect.arrayContaining(["HOME", "TMPDIR", "GIT_CONFIG_GLOBAL", "GIT_CONFIG_SYSTEM", "GIT_TERMINAL_PROMPT"]));
      expect(Object.keys(observedEnv)).not.toEqual(expect.arrayContaining(Object.keys(process.env)));
      expect(beforeEnv.GITHUB_TOKEN).toBe(previousGithubToken);
    } finally {
      if (previousGithubToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previousGithubToken;
      if (previousSecret === undefined) delete process.env.MY_PRIVATE_API_KEY; else process.env.MY_PRIVATE_API_KEY = previousSecret;
      if (previousSsh === undefined) delete process.env.SSH_AUTH_SOCK; else process.env.SSH_AUTH_SOCK = previousSsh;
    }
  });

  it("leaves the main process environment unchanged when the runtime fails", async () => {
    const previousToken = process.env.GITHUB_TOKEN;
    process.env.GITHUB_TOKEN = "secret-value";
    try {
      const before = { ...process.env };
      const repo = await createRepo("main");
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "catos-worker-env-error-workspaces-"));
      const worker = new CodexSdkWorker({
        codexRuntimeRunner: async () => {
          throw new Error("SDK failed");
        },
      });

      await expect(worker.executeTask({ instruction: "Fail", repositoryPath: repo, baseBranch: "main", runId: "env-error", workspaceRoot })).rejects.toThrow(/SDK failed/);
      expect(process.env).toEqual(before);
    } finally {
      if (previousToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previousToken;
    }
  });

  it("continues an existing Codex thread for rework in the same workspace", async () => {
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "catos-rework-root-"));
    const workspace = path.join(workspaceRoot, "workspace");
    await mkdir(workspace);
    await git(["init", "-b", "main"], workspace);
    await git(["config", "user.email", "catos@example.test"], workspace);
    await git(["config", "user.name", "CatOS Test"], workspace);
    await writeFile(path.join(workspace, "README.md"), "before\n", "utf8");
    await git(["add", "README.md"], workspace);
    await git(["commit", "-m", "initial"], workspace);
    let resumedThreadId = "";
    let resumedWorkspace = "";
    let instruction = "";
    let observedEnv: NodeJS.ProcessEnv = {};
    const worker = new CodexSdkWorker({
      codexRuntimeRunner: async ({ request, env }) => {
        if (request.mode !== "continue") throw new Error("must not start a new thread");
        observedEnv = { ...env };
        resumedThreadId = request.threadId;
        resumedWorkspace = request.workingDirectory;
        instruction = request.instruction;
        await writeFile(path.join(request.workingDirectory, "README.md"), "after rework\n", "utf8");
        return { threadId: request.threadId, finalResponse: "reworked" };
      },
    });

    const result = await worker.continueTask({
      threadId: "thread-existing",
      workspacePath: workspace,
      workspaceRoot,
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
    expect(observedEnv.GIT_CONFIG_GLOBAL).toBe("/dev/null");
    expect(observedEnv.GITHUB_TOKEN).toBeUndefined();
  });

  it("keeps the fake Codex workingDirectory scoped to the run workspace", async () => {
    const repo = await createRepo("main");
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "catos-worker-cwd-workspaces-"));
    let receivedWorkspace = "";
    const worker = new CodexSdkWorker({
      codexRuntimeRunner: async ({ request }) => {
        receivedWorkspace = request.workingDirectory;
        return { threadId: "thread-cwd", finalResponse: "no changes" };
      },
    });

    const result = await worker.executeTask({ instruction: "Inspect only", repositoryPath: repo, baseBranch: "main", runId: "cwd", workspaceRoot });

    expect(receivedWorkspace).toBe(path.join(workspaceRoot, "cwd", "workspace"));
    expect(result.workspacePath).toBe(receivedWorkspace);
  });

  it("runs the forked Codex runtime child with allowlisted env and captures logs", async () => {
    const previousGithubToken = process.env.GITHUB_TOKEN;
    const previousSecret = process.env.MY_PRIVATE_API_KEY;
    process.env.GITHUB_TOKEN = "secret-value";
    process.env.MY_PRIVATE_API_KEY = "secret-value";
    try {
      const repo = await createRepo("main");
      const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "catos-fork-runtime-"));
      const childPath = path.resolve("tests/fixtures/codexRuntimeFakeChild.cjs");
      const before = { ...process.env };
      const worker = new CodexSdkWorker({
        codexRuntimeRunner: createForkedCodexRuntimeRunner({ childPath, timeoutMs: 10_000 }),
      });

      const result = await worker.executeTask({ instruction: "Inspect runtime", repositoryPath: repo, baseBranch: "main", runId: "fork", workspaceRoot });

      expect(process.env).toEqual(before);
      expect(result.threadId).toBe("fake-thread");
      const response = JSON.parse(result.finalResponse);
      expect(response.mode).toBe("start");
      expect(response.hasSecret).toBe(false);
      expect(response.allowedEnv).toContain("HOME");
      expect(response.allowedEnv).toContain("TMPDIR");
      expect(response.allowedEnv).toContain("GIT_CONFIG_GLOBAL");
      expect(response.allowedEnv).not.toContain("GITHUB_TOKEN");
      expect(response.allowedEnv).not.toContain("MY_PRIVATE_API_KEY");
      const runtimeDir = path.join(workspaceRoot, "fork", "runtime");
      await expect(readFile(path.join(runtimeDir, "codex-runtime.stdout.log"), "utf8")).resolves.toContain("fake stdout start");
      await expect(readFile(path.join(runtimeDir, "codex-runtime.stderr.log"), "utf8")).resolves.toContain("fake stderr start");
      const manifest = await readFile(path.join(runtimeDir, "runtime.json"), "utf8");
      expect(manifest).not.toContain("secret-value");
    } finally {
      if (previousGithubToken === undefined) delete process.env.GITHUB_TOKEN; else process.env.GITHUB_TOKEN = previousGithubToken;
      if (previousSecret === undefined) delete process.env.MY_PRIVATE_API_KEY; else process.env.MY_PRIVATE_API_KEY = previousSecret;
    }
  });

  it("reports forked runtime exit, malformed IPC, timeout, and supports continuation", async () => {
    const repo = await createRepo("main");
    const workspaceRoot = await mkdtemp(path.join(os.tmpdir(), "catos-fork-runtime-errors-"));
    const childPath = path.resolve("tests/fixtures/codexRuntimeFakeChild.cjs");

    await expect(new CodexSdkWorker({
      codexRuntimeRunner: createForkedCodexRuntimeRunner({ childPath, timeoutMs: 10_000 }),
    }).executeTask({ instruction: "MODE=EXIT", repositoryPath: repo, baseBranch: "main", runId: "exit", workspaceRoot })).rejects.toThrow(/exited with code 7/);
    await expect(readFile(path.join(workspaceRoot, "exit", "runtime", "codex-runtime-error.json"), "utf8")).resolves.toContain("exit-code");

    await expect(new CodexSdkWorker({
      codexRuntimeRunner: createForkedCodexRuntimeRunner({ childPath, timeoutMs: 10_000 }),
    }).executeTask({ instruction: "MODE=MALFORMED", repositoryPath: repo, baseBranch: "main", runId: "malformed", workspaceRoot })).rejects.toThrow(/malformed result/);
    await expect(readFile(path.join(workspaceRoot, "malformed", "runtime", "codex-runtime-error.json"), "utf8")).resolves.toContain("malformed-result");

    await expect(new CodexSdkWorker({
      codexRuntimeRunner: createForkedCodexRuntimeRunner({ childPath, timeoutMs: 100 }),
    }).executeTask({ instruction: "MODE=TIMEOUT", repositoryPath: repo, baseBranch: "main", runId: "timeout", workspaceRoot })).rejects.toThrow(/timed out/);
    await expect(readFile(path.join(workspaceRoot, "timeout", "runtime", "codex-runtime-error.json"), "utf8")).resolves.toContain("timeout");

    const workspace = path.join(workspaceRoot, "continue-workspace");
    await mkdir(workspace);
    await git(["init", "-b", "main"], workspace);
    await git(["config", "user.email", "catos@example.test"], workspace);
    await git(["config", "user.name", "CatOS Test"], workspace);
    await writeFile(path.join(workspace, "README.md"), "before\n", "utf8");
    await git(["add", "README.md"], workspace);
    await git(["commit", "-m", "initial"], workspace);

    const continuation = await new CodexSdkWorker({
      codexRuntimeRunner: createForkedCodexRuntimeRunner({ childPath, timeoutMs: 10_000 }),
    }).continueTask({
      threadId: "thread-existing",
      workspacePath: workspace,
      workspaceRoot,
      sandboxMode: "workspace-write",
      reworkPackage: {
        schemaVersion: 1,
        attempt: 1,
        originalObjective: "Continue",
        acceptanceCriteria: ["Continues"],
        blockingFindings: [],
        preserve: [],
        mustChange: [],
        mustNotChange: [],
        previousAttemptSummary: "Need continuation.",
      },
    });
    expect(continuation.threadId).toBe("thread-existing");
    expect(JSON.parse(continuation.finalResponse).mode).toBe("continue");
    await expect(readFile(path.join(workspaceRoot, "runtime", "codex-runtime.stdout.log"), "utf8")).resolves.toContain("fake stdout continue");
  });
});
