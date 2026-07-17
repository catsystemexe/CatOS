import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { createCodexChildEnvironment, type RuntimeEnvironment } from "./runtimePolicy.js";

const execFileAsync = promisify(execFile);
export type CliResult = { stdout: string; stderr: string; exitCode: number };
export type CodexCli = { run(args: string[], options?: { cwd?: string; env?: NodeJS.ProcessEnv }): Promise<CliResult> };
export type CodexCapabilities = { version: string; auth: "chatgpt"; supportsExec: true; supportsLoginStatus: true };

export function createCodexCli(executable = process.env.CATOS_CODEX_EXECUTABLE ?? "codex"): CodexCli {
  return { async run(args, options = {}) { try { const result = await execFileAsync(executable, args, { cwd: options.cwd, env: options.env, encoding: "utf8", maxBuffer: 1024 * 1024 }); return { stdout: result.stdout, stderr: result.stderr, exitCode: 0 }; } catch (error: unknown) { const e = error as { stdout?: string; stderr?: string; code?: number }; return { stdout: e.stdout ?? "", stderr: e.stderr ?? "", exitCode: typeof e.code === "number" ? e.code : 127 }; } } };
}
function output(result: CliResult): string { return `${result.stdout}\n${result.stderr}`.toLowerCase(); }
export function parseCodexAuthStatus(result: CliResult): "chatgpt" | "api" | "unknown" {
  if (result.exitCode !== 0) return "unknown";
  const value = output(result);
  if (/chatgpt|login method:\s*chatgpt|authenticated.*chatgpt/.test(value)) return "chatgpt";
  if (/api[ -]?key|platform api|access token/.test(value)) return "api";
  return "unknown";
}
function parseVersion(text: string): [number, number, number] | undefined { const m = text.match(/(?:^|\s|v)(\d+)\.(\d+)(?:\.(\d+))?/); return m ? [+m[1], +m[2], +(m[3] ?? 0)] : undefined; }
function atLeast(actual: [number, number, number], minimum: [number, number, number]): boolean { return actual[0] > minimum[0] || actual[0] === minimum[0] && (actual[1] > minimum[1] || actual[1] === minimum[1] && actual[2] >= minimum[2]); }

/** Safe auth check: the status command receives the same credentials-denied env as model execution. */
export async function assertCodexCapabilities(cli: CodexCli, minimumVersion = "0.1.0", sourceEnv = process.env): Promise<{ capabilities: CodexCapabilities; runtime: RuntimeEnvironment }> {
  const runtime = createCodexChildEnvironment(sourceEnv);
  const version = await cli.run(["--version"], { env: runtime.env });
  const actual = parseVersion(version.stdout);
  const minimum = parseVersion(minimumVersion);
  if (version.exitCode !== 0 || !actual || !minimum || !atLeast(actual, minimum)) throw new Error("Unsupported Codex CLI version.");
  const help = await cli.run(["exec", "--help"], { env: runtime.env });
  if (help.exitCode !== 0) throw new Error("Codex CLI does not support exec.");
  const login = await cli.run(["login", "status"], { env: runtime.env });
  if (parseCodexAuthStatus(login) !== "chatgpt") throw new Error("Codex CLI must be authenticated with ChatGPT; API and unknown authentication are refused.");
  return { capabilities: { version: version.stdout.trim(), auth: "chatgpt", supportsExec: true, supportsLoginStatus: true }, runtime };
}
