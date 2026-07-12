import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type SandboxIsolation = "enabled" | "disabled";

export type CodingTask = {
  instruction: string;
  repositoryPath: string;
  baseBranch: string;
  runId: string;
  runDir: string;
  sandboxMode?: SandboxMode;
};

export type CodingResult = {
  threadId: string;
  finalResponse: string;
  workspacePath: string;
  changedFiles: string[];
  diff: string;
  status: string;
  sandboxMode: SandboxMode;
  sandboxIsolation: SandboxIsolation;
};

export interface CodingWorker {
  executeTask(input: CodingTask): Promise<CodingResult>;
}

type GitResult = { stdout: string; stderr: string };

type ChangedFileEntry = {
  path: string;
  status: string;
  untracked: boolean;
};

type CodexThread = {
  id?: string;
  threadId?: string;
  run(instruction: string): Promise<unknown>;
};

type CodexClient = {
  startThread(options: { workingDirectory: string; sandboxMode?: SandboxMode; model?: string }): CodexThread;
};

type CodexConstructor = new () => CodexClient;

type CodexTurn = {
  finalResponse?: string;
  response?: string;
  text?: string;
};

export type CodexSdkWorkerOptions = {
  codexFactory?: () => CodexClient;
  git?: (args: string[], cwd?: string) => Promise<GitResult>;
};

export function normalizeWorkBranchName(runId: string): string {
  const normalized = runId
    .trim()
    .replace(/[^A-Za-z0-9._/-]+/g, "-")
    .replace(/\.\.+/g, ".")
    .replace(/\/+/g, "/")
    .replace(/^[/.-]+|[/.-]+$/g, "")
    .replace(/\.lock$/i, "");
  const safeRunId = normalized.length > 0 ? normalized : "run";
  return `catos/${safeRunId}`.slice(0, 200).replace(/[/.-]+$/g, "");
}

export function buildCodexInstruction(instruction: string): string {
  return [
    "You are the CatOS Codex Worker executing a TaskBrief.codexInstruction.",
    "",
    "Safety rules:",
    "- Modify only files inside the provided Git worktree workspace.",
    "- Do not change files outside the worktree.",
    "- Do not create commits, push, merge, or rebase.",
    "- Do not add secrets, credentials, API keys, tokens, or private data.",
    "- Do not do work outside the scope of the TaskBrief.",
    "- You may run reasonable local commands to inspect or support your implementation, but CatOS will not treat them as a verification gate in this stage.",
    "",
    "TaskBrief.codexInstruction:",
    instruction,
  ].join("\n");
}

function parseStatusPorcelainZ(status: string): ChangedFileEntry[] {
  const tokens = status.split("\0").filter(Boolean);
  const entries: ChangedFileEntry[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const statusCode = token.slice(0, 2);
    const filePath = token.slice(3);

    entries.push({
      path: filePath,
      status: statusCode,
      untracked: statusCode === "??",
    });

    if (statusCode.includes("R") || statusCode.includes("C")) {
      index += 1;
    }
  }

  return entries;
}

function isExpectedNoIndexDifference(error: unknown): boolean {
  const maybeError = error as { code?: number | string };
  return maybeError.code === 1 || maybeError.code === "1";
}

async function gitNoIndexDiff(filePath: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--binary", "--no-index", "--", "/dev/null", filePath], { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    if (isExpectedNoIndexDifference(error)) {
      return err.stdout ?? "";
    }

    const message = [err.message, err.stderr, err.stdout].filter(Boolean).join("\n");
    throw new Error(`Git command failed: git diff --binary --no-index -- /dev/null ${filePath}\n${message}`);
  }
}

async function buildWorkspaceDiff(workspacePath: string, changedFiles: ChangedFileEntry[], git: (args: string[], cwd?: string) => Promise<GitResult>): Promise<string> {
  const trackedDiff = await git(["diff", "--binary", "HEAD"], workspacePath);
  const untrackedDiffs = await Promise.all(
    changedFiles
      .filter((entry) => entry.untracked)
      .map((entry) => gitNoIndexDiff(entry.path, workspacePath)),
  );

  return [trackedDiff.stdout, ...untrackedDiffs].filter(Boolean).join("\n");
}

function stringifyCodexTurn(turn: unknown): string {
  if (typeof turn === "string") return turn;
  if (turn && typeof turn === "object") {
    const candidate = turn as CodexTurn;
    return candidate.finalResponse ?? candidate.response ?? candidate.text ?? JSON.stringify(turn);
  }
  return String(turn ?? "");
}

async function loadDefaultCodexFactory(): Promise<() => CodexClient> {
  // The official dependency is installed by npm in environments where registry access allows it.
  // @ts-ignore The package may be unavailable in offline/firewalled test environments; do not add a local shim.
  const sdk: { Codex: CodexConstructor } = await import("@openai/codex-sdk");
  return () => new sdk.Codex();
}

async function defaultGit(args: string[], cwd?: string): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    return { stdout, stderr };
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    const message = [err.message, err.stderr, err.stdout].filter(Boolean).join("\n");
    throw new Error(`Git command failed: git ${args.join(" ")}\n${message}`);
  }
}

export class CodexSdkWorker implements CodingWorker {
  private readonly git: (args: string[], cwd?: string) => Promise<GitResult>;
  private readonly codexFactory?: () => CodexClient;

  constructor(options: CodexSdkWorkerOptions = {}) {
    this.git = options.git ?? defaultGit;
    this.codexFactory = options.codexFactory;
  }

  async executeTask(input: CodingTask): Promise<CodingResult> {
    const repositoryPath = path.resolve(input.repositoryPath);
    await this.git(["rev-parse", "--is-inside-work-tree"], repositoryPath);
    await this.git(["rev-parse", "--verify", `${input.baseBranch}^{commit}`], repositoryPath);

    const branchName = normalizeWorkBranchName(input.runId);
    const workspacePath = path.join(input.runDir, "workspace");
    await mkdir(input.runDir, { recursive: true });
    await this.git(["branch", branchName, input.baseBranch], repositoryPath);
    await this.git(["worktree", "add", workspacePath, branchName], repositoryPath);

    const sandboxMode = input.sandboxMode ?? "workspace-write";
    const sandboxIsolation = sandboxMode === "danger-full-access" ? "disabled" : "enabled";
    if (sandboxMode === "danger-full-access") {
      console.warn([
        "⚠️  WARNING: Codex sandbox isolation is DISABLED.",
        "CatOS is running Codex with sandboxMode=danger-full-access because it was explicitly configured and acknowledged.",
        "Use this compatibility mode only in trusted repositories without sensitive data.",
      ].join("\n"));
    }

    const factory = this.codexFactory ?? (await loadDefaultCodexFactory());
    const codex = factory();
    const thread = codex.startThread({
      workingDirectory: workspacePath,
      sandboxMode,
      ...(process.env.CATOS_CODEX_MODEL ? { model: process.env.CATOS_CODEX_MODEL } : {}),
    });
    const turn = await thread.run(buildCodexInstruction(input.instruction));

    const statusOutput = await this.git(["status", "--porcelain=v1", "-z"], workspacePath);
    const changedFileEntries = parseStatusPorcelainZ(statusOutput.stdout);
    const diff = await buildWorkspaceDiff(workspacePath, changedFileEntries, this.git);
    const humanStatusOutput = await this.git(["status", "--short"], workspacePath);

    return {
      threadId: thread.id ?? thread.threadId ?? "unknown",
      finalResponse: stringifyCodexTurn(turn),
      workspacePath,
      changedFiles: changedFileEntries.map((entry) => entry.path),
      diff,
      status: humanStatusOutput.stdout,
      sandboxMode,
      sandboxIsolation,
    };
  }
}

export async function writeCodingArtifacts(runDir: string, taskBrief: unknown, result: CodingResult): Promise<{ codingResultPath: string; diffPath: string; statusPath: string; taskBriefPath: string }> {
  const taskBriefPath = path.join(runDir, "task-brief.json");
  const codingResultPath = path.join(runDir, "coding-result.json");
  const diffPath = path.join(runDir, "workspace.diff");
  const statusPath = path.join(runDir, "workspace-status.txt");
  await writeFile(taskBriefPath, `${JSON.stringify(taskBrief, null, 2)}\n`, "utf8");
  await writeFile(codingResultPath, `${JSON.stringify({
    schemaVersion: 1,
    threadId: result.threadId,
    workspacePath: result.workspacePath,
    changedFiles: result.changedFiles,
    finalResponse: result.finalResponse,
    sandboxMode: result.sandboxMode,
    sandboxIsolation: result.sandboxIsolation,
  }, null, 2)}\n`, "utf8");
  await writeFile(diffPath, result.diff, "utf8");
  await writeFile(statusPath, result.status, "utf8");
  return { codingResultPath, diffPath, statusPath, taskBriefPath };
}
