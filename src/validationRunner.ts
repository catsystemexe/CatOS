import { execFile, spawn, type ChildProcess } from "node:child_process";
import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type ValidationCommand = {
  name: string;
  command: string;
  required: boolean;
  timeoutMs: number;
};

export type ValidationCommandResult = {
  name: string;
  command: string;
  required: boolean;
  status: "PASS" | "FAIL" | "SKIPPED" | "BLOCKED";
  exitCode: number | null;
  signal: string | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
};

export type ValidationReport = {
  schemaVersion: 1;
  status: "PASS" | "FAIL" | "SKIPPED" | "BLOCKED";
  workspacePath: string;
  startedAt: string;
  finishedAt: string;
  results: ValidationCommandResult[];
};

function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function blockedPreflightResult(message: string): ValidationCommandResult {
  return {
    name: "preflight",
    command: "validation workspace isolation preflight",
    required: true,
    status: "BLOCKED",
    exitCode: null,
    signal: null,
    stdout: "",
    stderr: message,
    durationMs: 0,
    timedOut: false,
  };
}

async function validationPreflight(workspacePath: string, catosRoot: string): Promise<ValidationCommandResult | undefined> {
  try {
    const workspaceStats = await stat(workspacePath);
    if (!workspaceStats.isDirectory()) return blockedPreflightResult(`Workspace is not a directory: ${workspacePath}`);
    const [realWorkspacePath, realCatosRoot] = await Promise.all([realpath(workspacePath), realpath(catosRoot)]);
    if (isPathInside(realCatosRoot, realWorkspacePath)) {
      return blockedPreflightResult(`Validation workspace must not be inside CatOS repository root: ${realWorkspacePath}`);
    }
    const { stdout } = await execFileAsync("git", ["rev-parse", "--show-toplevel"], { cwd: realWorkspacePath, encoding: "utf8" });
    const gitTopLevel = await realpath(stdout.trim());
    if (gitTopLevel !== realWorkspacePath) {
      return blockedPreflightResult(`Validation workspace Git top-level mismatch: expected ${realWorkspacePath}, got ${gitTopLevel}`);
    }
  } catch (error) {
    const err = error as Error & { stderr?: string; stdout?: string };
    return blockedPreflightResult([err.message, err.stderr, err.stdout].filter(Boolean).join("\n"));
  }
  return undefined;
}

export interface ValidationRunner {
  run(input: { workspacePath: string; commands: ValidationCommand[] }): Promise<ValidationReport>;
}

export function buildValidationCommands(
  commands: { typecheck: string; test: string; build: string },
  options: { timeoutMs?: number } = {},
): ValidationCommand[] {
  const timeoutMs = options.timeoutMs ?? 120_000;
  return [
    { name: "typecheck", command: commands.typecheck, required: true, timeoutMs },
    { name: "test", command: commands.test, required: true, timeoutMs },
    { name: "build", command: commands.build, required: true, timeoutMs },
  ];
}

function computeStatus(results: ValidationCommandResult[]): ValidationReport["status"] {
  const requiredResults = results.filter((result) => result.required);
  if (requiredResults.length === 0) return "SKIPPED";
  if (requiredResults.some((result) => result.status === "FAIL")) return "FAIL";
  if (requiredResults.some((result) => result.status === "BLOCKED")) return "BLOCKED";
  if (requiredResults.every((result) => result.status === "SKIPPED")) return "SKIPPED";
  if (requiredResults.every((result) => result.status === "PASS" || result.status === "SKIPPED")) return "PASS";
  return "BLOCKED";
}

function skippedResult(command: ValidationCommand): ValidationCommandResult {
  return { name: command.name, command: command.command, required: command.required, status: "SKIPPED", exitCode: null, signal: null, stdout: "", stderr: "Validation check skipped: command is not configured.", durationMs: 0, timedOut: false };
}

function isSkipCommand(command: ValidationCommand): boolean {
  return /^catos:skip(?::|$)/.test(command.command);
}

function isCommandNotFound(exitCode: number | null, stderr: string): boolean {
  return exitCode === 127 || /not found|not recognized|command not found|is not recognized/i.test(stderr);
}

function killProcessTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;

  try {
    if (process.platform === "win32") {
      child.kill(signal);
      return;
    }

    // Validation commands are shell command strings. On POSIX systems, detached children
    // are placed in their own process group, so killing the negative PID terminates both
    // the shell and any child process it started.
    process.kill(-child.pid, signal);
  } catch (error) {
    const systemError = error as NodeJS.ErrnoException;
    if (systemError.code !== "ESRCH") {
      try {
        child.kill(signal);
      } catch {
        // The process may already have exited between the process-group kill attempt and
        // this fallback. There is nothing else to clean up in that case.
      }
    }
  }
}

async function runOneCommand(workspacePath: string, command: ValidationCommand): Promise<ValidationCommandResult> {
  const started = Date.now();

  return await new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let settled = false;
    let timedOut = false;
    let child: ReturnType<typeof spawn>;
    let killTimer: NodeJS.Timeout | undefined;

    const finish = (result: Omit<ValidationCommandResult, "durationMs" | "stdout" | "stderr">) => {
      if (settled) return;
      settled = true;
      resolve({
        ...result,
        stdout,
        stderr,
        durationMs: Date.now() - started,
      });
    };

    try {
      // Project validation commands are trusted project configuration strings. They are executed
      // through an explicit system shell so existing config values such as `npm run test` remain
      // compatible, while cwd is always pinned to the isolated worktree.
      child = spawn(command.command, {
        cwd: workspacePath,
        shell: true,
        windowsHide: true,
        env: process.env,
        detached: process.platform !== "win32",
      });
    } catch (error) {
      const err = error as Error;
      stderr += err.message;
      finish({
        name: command.name,
        command: command.command,
        required: command.required,
        status: "BLOCKED",
        exitCode: null,
        signal: null,
        timedOut: false,
      });
      return;
    }

    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child, "SIGTERM");
      killTimer = setTimeout(() => {
        killProcessTree(child, "SIGKILL");
      }, 250);
    }, command.timeoutMs);

    child.stdout?.setEncoding("utf8");
    child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
    child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
    child.on("error", (error: Error) => {
      clearTimeout(timer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      stderr += error.message;
      finish({
        name: command.name,
        command: command.command,
        required: command.required,
        status: "BLOCKED",
        exitCode: null,
        signal: null,
        timedOut,
      });
    });
    child.on("close", (exitCode: number | null, signal: NodeJS.Signals | null) => {
      clearTimeout(timer);
      if (killTimer !== undefined) clearTimeout(killTimer);
      const status = timedOut || isCommandNotFound(exitCode, stderr)
        ? "BLOCKED"
        : exitCode === 0
          ? "PASS"
          : "FAIL";
      finish({
        name: command.name,
        command: command.command,
        required: command.required,
        status,
        exitCode,
        signal,
        timedOut,
      });
    });
  });
}

export class ShellValidationRunner implements ValidationRunner {
  private readonly catosRoot: string;

  constructor(options: { catosRoot?: string } = {}) {
    this.catosRoot = path.resolve(options.catosRoot ?? process.cwd());
  }

  async run(input: { workspacePath: string; commands: ValidationCommand[] }): Promise<ValidationReport> {
    const workspacePath = path.resolve(input.workspacePath);
    const startedAt = new Date().toISOString();
    const results: ValidationCommandResult[] = [];

    const preflightFailure = await validationPreflight(workspacePath, this.catosRoot);
    if (preflightFailure) {
      const finishedAt = new Date().toISOString();
      return { schemaVersion: 1, status: "BLOCKED", workspacePath, startedAt, finishedAt, results: [preflightFailure] };
    }

    for (const command of input.commands) {
      results.push(isSkipCommand(command) ? skippedResult(command) : await runOneCommand(workspacePath, command));
    }

    const finishedAt = new Date().toISOString();
    return {
      schemaVersion: 1,
      status: computeStatus(results),
      workspacePath,
      startedAt,
      finishedAt,
      results,
    };
  }
}

export async function writeValidationReport(runDir: string, report: ValidationReport): Promise<string> {
  await mkdir(runDir, { recursive: true });
  const reportPath = path.join(runDir, "validation-report.json");
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  return reportPath;
}
