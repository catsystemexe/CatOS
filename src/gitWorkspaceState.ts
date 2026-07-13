import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

type GitResult = { stdout: string; stderr: string };

export type WorkspaceGitFileEntry = {
  path: string;
  status: string;
  untracked: boolean;
};

export type WorkspaceGitState = {
  diff: string;
  status: string;
  changedFiles: string[];
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

function isExpectedNoIndexDifference(error: unknown): boolean {
  const maybeError = error as { code?: number | string };
  return maybeError.code === 1 || maybeError.code === "1";
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

  return {
    diff: [trackedDiff.stdout, ...untrackedDiffs].filter(Boolean).join("\n"),
    status: humanStatusOutput.stdout,
    changedFiles: sortUnique(entries.map((entry) => entry.path)),
  };
}
