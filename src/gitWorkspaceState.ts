import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type GitResult = { stdout: string; stderr: string };

export type WorkspaceGitFileEntry = {
  path: string;
  status: string;
  untracked: boolean;
};

export type WorkspaceDiffCheck = {
  command: "git diff --check";
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  status: "PASS" | "FAIL" | "BLOCKED";
  limitation?: string;
};

export type WorkspaceGitState = {
  diff: string;
  status: string;
  changedFiles: string[];
  diffCheck: WorkspaceDiffCheck;
};

export type WorkspaceGitStateOptions = {
  git?: (args: string[], cwd?: string) => Promise<GitResult>;
};

function normalizePath(filePath: string): string {
  return filePath.replace(/\\/g, "/").replace(/^\.\//, "");
}

function sortUnique(filePaths: string[]): string[] {
  return [...new Set(filePaths.map(normalizePath).filter(Boolean))].sort();
}

export function parseStatusPorcelainZ(status: string): WorkspaceGitFileEntry[] {
  const tokens = status.split("\0").filter(Boolean);
  const entries: WorkspaceGitFileEntry[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index]!;
    const statusCode = token.slice(0, 2);
    const filePath = token.slice(3);

    entries.push({
      path: normalizePath(filePath),
      status: statusCode,
      untracked: statusCode === "??",
    });

    if (statusCode.includes("R") || statusCode.includes("C")) {
      index += 1;
    }
  }

  return entries.sort((a, b) => a.path.localeCompare(b.path));
}

function errorExitCode(error: unknown): number | null {
  const maybeError = error as { code?: number | string };
  const n = Number(maybeError.code);
  return Number.isFinite(n) ? n : null;
}

function isExpectedNoIndexDifference(error: unknown): boolean {
  return errorExitCode(error) === 1;
}

async function defaultGit(args: string[], cwd?: string): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync("git", args, { cwd, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
    return { stdout, stderr };
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    const message = [err.message, err.stderr, err.stdout].filter(Boolean).join("\n");
    throw new Error(`Git command failed: git ${args.join(" ")}\n${message}`);
  }
}

export async function collectWorkspaceDiffCheck(workspacePath: string): Promise<WorkspaceDiffCheck> {
  const started = Date.now();
  try {
    const { stdout, stderr } = await execFileAsync("git", ["diff", "--check"], { cwd: workspacePath, encoding: "utf8", maxBuffer: 20 * 1024 * 1024 });
    return { command: "git diff --check", exitCode: 0, stdout, stderr, durationMs: Date.now() - started, status: "PASS", limitation: "git diff --check does not inspect untracked file content." };
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    const exitCode = errorExitCode(error);
    return {
      command: "git diff --check",
      exitCode,
      stdout: err.stdout ?? "",
      stderr: err.stderr ?? err.message,
      durationMs: Date.now() - started,
      status: exitCode === null ? "BLOCKED" : "FAIL",
      limitation: "git diff --check does not inspect untracked file content.",
    };
  }
}

async function gitNoIndexDiff(filePath: string, cwd: string): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", ["diff", "--binary", "--no-index", "--", "/dev/null", filePath], { cwd, encoding: "utf8", maxBuffer: 50 * 1024 * 1024 });
    return stdout;
  } catch (error) {
    const err = error as Error & { stdout?: string; stderr?: string };
    if (isExpectedNoIndexDifference(error)) return err.stdout ?? "";

    const message = [err.message, err.stderr, err.stdout].filter(Boolean).join("\n");
    throw new Error(`Git command failed: git diff --binary --no-index -- /dev/null ${filePath}\n${message}`);
  }
}

export async function collectCompleteWorkspaceDiff(workspacePath: string, options: WorkspaceGitStateOptions = {}): Promise<string> {
  return (await collectWorkspaceGitState(workspacePath, options)).diff;
}

export async function collectWorkspaceGitState(workspacePath: string, options: WorkspaceGitStateOptions = {}): Promise<WorkspaceGitState> {
  const git = options.git ?? defaultGit;
  const statusOutput = await git(["status", "--porcelain=v1", "-z"], workspacePath);
  const entries = parseStatusPorcelainZ(statusOutput.stdout);
  const trackedDiff = await git(["diff", "--binary", "HEAD"], workspacePath);
  const untrackedDiffs = await Promise.all(entries.filter((entry) => entry.untracked).map((entry) => gitNoIndexDiff(entry.path, workspacePath)));
  const humanStatusOutput = await git(["status", "--short"], workspacePath);
  const diffCheck = await collectWorkspaceDiffCheck(workspacePath);

  return {
    diff: [trackedDiff.stdout, ...untrackedDiffs].filter(Boolean).join("\n"),
    status: humanStatusOutput.stdout,
    changedFiles: sortUnique(entries.map((entry) => entry.path)),
    diffCheck,
  };
}
