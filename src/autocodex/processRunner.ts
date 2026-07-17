import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

export type ProcessLogPaths = Readonly<{ stdout: string; stderr: string }>;
export type ProcessRunOptions = Readonly<{ executable: string; argv: readonly string[]; stdin?: string; cwd: string; env: NodeJS.ProcessEnv; timeoutMs: number; logPaths: ProcessLogPaths; maxLogBytes?: number }>;
export type ProcessRunResult = Readonly<{ exitCode: number | null; signal: NodeJS.Signals | null; timedOut: boolean; stdoutTruncated: boolean; stderrTruncated: boolean; startedAt: string; finishedAt: string }>;
const defaultMaxLogBytes = 1024 * 1024;

function cappedWriter(file: string, max: number) {
  const chunks: Buffer[] = []; let used = 0; let truncated = false;
  return { write(chunk: Buffer) { const room = max - used; if (room <= 0) { truncated = true; return; } if (chunk.length > room) { chunks.push(chunk.subarray(0, room)); used += room; truncated = true; return; } chunks.push(chunk); used += chunk.length; }, async save() { const marker = truncated ? Buffer.from("\n[CatOS log truncated]\n") : Buffer.alloc(0); await mkdir(path.dirname(file), { recursive: true }); await writeFile(file, Buffer.concat([...chunks, marker])); return truncated; } };
}
function terminateGroup(child: ReturnType<typeof spawn>, signal: NodeJS.Signals): void {
  if (child.pid === undefined) return;
  // detached gives the process its own POSIX group; negative PID terminates its descendants too.
  try { process.kill(-child.pid, signal); } catch { try { child.kill(signal); } catch { /* already exited */ } }
}
/** Runs an injected executable without a shell and retains bounded stdout/stderr evidence. */
export async function runProcess(options: ProcessRunOptions): Promise<ProcessRunResult> {
  if (!options.executable || options.argv.some((arg) => arg.includes("\0"))) throw new Error("Invalid executable or argv");
  if (!Number.isFinite(options.timeoutMs) || options.timeoutMs <= 0) throw new Error("timeoutMs must be positive");
  const max = options.maxLogBytes ?? defaultMaxLogBytes;
  const stdout = cappedWriter(options.logPaths.stdout, max); const stderr = cappedWriter(options.logPaths.stderr, max); const startedAt = new Date().toISOString();
  const child = spawn(options.executable, [...options.argv], { cwd: options.cwd, env: options.env, shell: false, detached: process.platform !== "win32", stdio: ["pipe", "pipe", "pipe"] });
  child.stdout.on("data", (chunk: Buffer) => stdout.write(chunk)); child.stderr.on("data", (chunk: Buffer) => stderr.write(chunk));
  if (options.stdin !== undefined) child.stdin.end(options.stdin); else child.stdin.end();
  let timedOut = false;
  const outcome = await new Promise<{ exitCode: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
    const timer = setTimeout(() => { timedOut = true; terminateGroup(child, "SIGTERM"); setTimeout(() => terminateGroup(child, "SIGKILL"), 500).unref(); }, options.timeoutMs);
    child.once("error", (error) => { clearTimeout(timer); reject(error); });
    child.once("close", (exitCode, signal) => { clearTimeout(timer); resolve({ exitCode, signal }); });
  });
  const [stdoutTruncated, stderrTruncated] = await Promise.all([stdout.save(), stderr.save()]);
  return Object.freeze({ ...outcome, timedOut, stdoutTruncated, stderrTruncated, startedAt, finishedAt: new Date().toISOString() });
}
export const runChildProcess = runProcess;
