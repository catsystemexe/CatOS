import { spawn, type ChildProcess } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createCodexChildEnvironment } from "./runtimePolicy.js";

export type TestProcessLogPaths = Readonly<{ stdout: string; stderr: string }>;
export type TestProcessInput = Readonly<{
  /** An argv vector from the frozen Task Package.  This runner never accepts a shell command. */
  argv: readonly string[];
  cwd: string;
  timeoutMs: number;
  logPaths: TestProcessLogPaths;
  environment?: NodeJS.ProcessEnv;
}>;
export type TestProcessResult = Readonly<{
  exitCode: number | null; signal: NodeJS.Signals | null; timedOut: boolean; runnerError?: string;
  startedAt: string; finishedAt: string; stdoutPath: string; stderrPath: string;
}>;

function killProcessGroup(child: ChildProcess, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  try {
    if (process.platform === "win32") child.kill(signal);
    else process.kill(-child.pid, signal);
  } catch {
    try { child.kill(signal); } catch { /* The child exited while it was being terminated. */ }
  }
}

function validate(input: TestProcessInput): void {
  if (!Array.isArray(input.argv) || input.argv.length === 0 || !input.argv[0] || input.argv[0] === "--" || input.argv.some((part) => !part || part.includes("\0"))) throw new Error("Test argv must contain a non-NUL executable and arguments.");
  if (!Number.isFinite(input.timeoutMs) || input.timeoutMs <= 0) throw new Error("Test timeoutMs must be positive.");
}

/**
 * Executes a frozen argv vector directly.  The only copied environment values are
 * the small, credential-free allow-list in createCodexChildEnvironment; notably it
 * does not inherit process.env and it never enables a shell.
 */
export async function runTestProcess(input: TestProcessInput): Promise<TestProcessResult> {
  validate(input);
  await Promise.all([mkdir(path.dirname(input.logPaths.stdout), { recursive: true }), mkdir(path.dirname(input.logPaths.stderr), { recursive: true })]);
  const [executable, ...argv] = input.argv;
  const env = createCodexChildEnvironment(input.environment).env;
  const startedAt = new Date().toISOString();
  let child: ChildProcess;
  try {
    child = spawn(executable!, argv, { cwd: input.cwd, env, shell: false, windowsHide: true, detached: process.platform !== "win32", stdio: ["ignore", "pipe", "pipe"] });
  } catch (error) {
    const runnerError = error instanceof Error ? error.message : String(error);
    await Promise.all([writeFile(input.logPaths.stdout, ""), writeFile(input.logPaths.stderr, `${runnerError}\n`)]);
    return Object.freeze({ exitCode: null, signal: null, timedOut: false, runnerError, startedAt, finishedAt: new Date().toISOString(), stdoutPath: input.logPaths.stdout, stderrPath: input.logPaths.stderr });
  }
  let stdout = ""; let stderr = ""; let timedOut = false;
  const result = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null; runnerError?: string }>((resolve) => {
    let done = false;
    const finish = (value: { exitCode: number | null; signal: NodeJS.Signals | null; runnerError?: string }) => { if (!done) { done = true; resolve(value); } };
    const timer = setTimeout(() => { timedOut = true; killProcessGroup(child, "SIGTERM"); setTimeout(() => killProcessGroup(child, "SIGKILL"), 250).unref(); }, input.timeoutMs);
    child.stdout?.setEncoding("utf8"); child.stderr?.setEncoding("utf8");
    child.stdout?.on("data", (chunk: string) => { stdout += chunk; }); child.stderr?.on("data", (chunk: string) => { stderr += chunk; });
    child.once("error", (error) => { clearTimeout(timer); stderr += `${error.message}\n`; finish({ exitCode: null, signal: null, runnerError: error.message }); });
    child.once("close", (exitCode, signal) => { clearTimeout(timer); finish({ exitCode, signal }); });
  });
  await Promise.all([writeFile(input.logPaths.stdout, stdout), writeFile(input.logPaths.stderr, stderr)]);
  return Object.freeze({ ...result, timedOut, startedAt, finishedAt: new Date().toISOString(), stdoutPath: input.logPaths.stdout, stderrPath: input.logPaths.stderr });
}

export const runFrozenTestProcess = runTestProcess;
