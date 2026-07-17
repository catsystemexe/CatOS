import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/** Deliberately small Git boundary used by the v2 post-Coding guards. */
export async function git(workspacePath: string, args: string[], options: { env?: NodeJS.ProcessEnv } = {}): Promise<string> {
  const { stdout } = await execFileAsync(process.env.CATOS_GIT_EXECUTABLE ?? "git", args, {
    cwd: workspacePath,
    encoding: "utf8",
    maxBuffer: 50 * 1024 * 1024,
    env: options.env,
  });
  return stdout;
}

export async function gitExitCode(workspacePath: string, args: string[]): Promise<number> {
  try { await git(workspacePath, args); return 0; }
  catch (error) { const code = Number((error as { code?: string | number }).code); return Number.isFinite(code) ? code : -1; }
}

export function parsePorcelainZ(value: string): Array<{ path: string; status: string; untracked: boolean }> {
  const fields = value.split("\0").filter(Boolean); const result: Array<{ path: string; status: string; untracked: boolean }> = [];
  for (let index = 0; index < fields.length; index += 1) {
    const field = fields[index]!; const status = field.slice(0, 2); const filePath = field.slice(3).replace(/\\/g, "/");
    result.push({ path: filePath, status, untracked: status === "??" });
    if (status.includes("R") || status.includes("C")) index += 1; // porcelain supplies the old name as the next NUL field
  }
  return result.sort((a, b) => a.path.localeCompare(b.path));
}

export async function gitRefSnapshot(workspacePath: string, prefix: string): Promise<string[]> {
  return (await git(workspacePath, ["for-each-ref", "--format=%(refname):%(objectname)", prefix])).split("\n").filter(Boolean).sort();
}
