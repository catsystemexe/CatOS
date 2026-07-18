import path from "node:path";
import { mkdir } from "node:fs/promises";
import { atomicWriteJson } from "./persistence.js";
import { git, gitExitCode, gitRefSnapshot, parsePorcelainZ } from "./git.js";
import type { TaskPackage } from "./taskPackage.js";

export type AttemptGitGuards = { attemptBaseCommit: string; branch: string; tags: string[]; submodules: string[] };
export type ChangeValidationStatus = "PASS" | "FAIL" | "BLOCKED";
export type ChangedFile = { path: string; status: string; untracked: boolean };
export type ChangeValidationReport = {
  schemaVersion: 2; status: ChangeValidationStatus; taskId: string; stepId: string; attemptId: string; runId: string;
  attemptBaseCommit: string; headCommit?: string; branch?: string; changedFiles: ChangedFile[]; violations: string[];
  globalPathRules: string[]; stepPathRules: string[]; generatedAt: string;
};

export type ChangeValidationInput = {
  workspacePath: string; artifactDir: string; taskId: string; stepId: string; attemptId: string; runId: string;
  attemptBaseCommit: string; expectedBranch?: string; attemptBaseTags?: string[]; attemptBaseSubmodules?: string[];
  /** A path to the immutable task package, if it is inside the workspace. */ taskPackageDir?: string;
  taskPackagePath?: string; taskPackage?: Pick<TaskPackage, "steps">;
  /** Every changed path must satisfy both non-empty lists. */ globalPathRules?: string[]; stepPathRules?: string[];
  /** Compatibility aliases for callers which call them allowed paths. */ allowedPaths?: string[]; stepAllowedPaths?: string[];
};

function same(a: readonly string[], b: readonly string[]): boolean { return JSON.stringify([...a].sort()) === JSON.stringify([...b].sort()); }
function normal(p: string): string { return p.replace(/\\/g, "/").replace(/^\.\//, ""); }
function glob(pattern: string, value: string): boolean {
  if (!pattern || pattern.includes("\0") || path.isAbsolute(pattern) || pattern.split(/[\\/]+/).includes("..")) return false;
  const escaped = normal(pattern).replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*\*/g, "\u0001").replace(/\*/g, "[^/]*").replace(/\u0001/g, ".*").replace(/\?/g, "[^/]");
  return new RegExp(`^${escaped}$`).test(value);
}
function taskRules(input: ChangeValidationInput): readonly string[] {
  if (input.stepPathRules) return input.stepPathRules;
  if (input.stepAllowedPaths) return input.stepAllowedPaths;
  return input.taskPackage?.steps.find((step) => step.id === input.stepId)?.files ?? [];
}
function packageRelative(workspace: string, packagePath: string | undefined): string | undefined {
  if (!packagePath) return undefined; const relative = path.relative(workspace, packagePath);
  return relative && !relative.startsWith("..") && !path.isAbsolute(relative) ? normal(relative) : undefined;
}

/** Capture this immediately before Coding; later validation compares the immutable snapshot. */
export async function captureAttemptGitGuards(workspacePath: string): Promise<AttemptGitGuards> {
  const branch = (await git(workspacePath, ["branch", "--show-current"])).trim();
  if (!branch) throw new Error("Cannot start a Coding attempt from detached HEAD.");
  return { attemptBaseCommit: (await git(workspacePath, ["rev-parse", "HEAD"])).trim(), branch, tags: await gitRefSnapshot(workspacePath, "refs/tags"), submodules: (await git(workspacePath, ["submodule", "status", "--recursive"])).split("\n").filter(Boolean).sort() };
}

export async function validateChanges(input: ChangeValidationInput): Promise<ChangeValidationReport> {
  const violations: string[] = []; let headCommit: string | undefined; let branch: string | undefined; let entries: ChangedFile[] = [];
  const globalRules = input.globalPathRules ?? input.allowedPaths ?? ["**"];
  const stepRules = taskRules(input);
  try {
    headCommit = (await git(input.workspacePath, ["rev-parse", "HEAD"])).trim();
    branch = (await git(input.workspacePath, ["branch", "--show-current"])).trim();
    entries = parsePorcelainZ(await git(input.workspacePath, ["status", "--porcelain=v1", "-z", "--untracked-files=all"]));
    if (headCommit !== input.attemptBaseCommit) violations.push(`Unexpected HEAD: expected ${input.attemptBaseCommit}, got ${headCommit}.`);
    if (!branch || (input.expectedBranch && branch !== input.expectedBranch)) violations.push(`Unexpected branch: expected ${input.expectedBranch ?? "a branch"}, got ${branch || "detached HEAD"}.`);
    if (input.attemptBaseTags && !same(await gitRefSnapshot(input.workspacePath, "refs/tags"), input.attemptBaseTags)) violations.push("Tags changed during Coding.");
    if (input.attemptBaseSubmodules && !same((await git(input.workspacePath, ["submodule", "status", "--recursive"])).split("\n").filter(Boolean), input.attemptBaseSubmodules)) violations.push("Submodule state changed during Coding.");
    if (!entries.length) violations.push("Zero diff: Coding produced no working-tree changes.");
    const packageRoot = packageRelative(input.workspacePath, input.taskPackageDir);
    const taskFile = packageRelative(input.workspacePath, input.taskPackagePath);
    for (const entry of entries) {
      if ((packageRoot && (entry.path === packageRoot || entry.path.startsWith(`${packageRoot}/`))) || (taskFile && entry.path === taskFile)) violations.push(`Task Package mutation is forbidden: ${entry.path}.`);
      if (!globalRules.some((rule) => glob(rule, entry.path))) violations.push(`Path violates global rules: ${entry.path}.`);
      if (!stepRules.length || !stepRules.some((rule) => glob(rule, entry.path))) violations.push(`Path violates Step rules: ${entry.path}.`);
    }
    // A gitlink is a submodule mutation even when `submodule status` cannot
    // resolve it (for example a newly-added, uninitialised submodule).
    if (await gitExitCode(input.workspacePath, ["diff", "--quiet", "HEAD"]) === 1) {
      const gitlinks = (await git(input.workspacePath, ["diff", "--raw", "HEAD"])).split("\n").some((line) => /^:(?:160000|\d+) 160000 /.test(line));
      if (gitlinks) violations.push("Submodule gitlink changed during Coding.");
    }
  } catch (error) { violations.push(`Git guard could not be evaluated: ${error instanceof Error ? error.message : String(error)}`); }
  const report: ChangeValidationReport = { schemaVersion: 2, status: violations.length ? "FAIL" : "PASS", taskId: input.taskId, stepId: input.stepId, attemptId: input.attemptId, runId: input.runId, attemptBaseCommit: input.attemptBaseCommit, ...(headCommit ? { headCommit } : {}), ...(branch ? { branch } : {}), changedFiles: entries, violations, globalPathRules: globalRules, stepPathRules: stepRules, generatedAt: new Date().toISOString() };
  await mkdir(input.artifactDir, { recursive: true });
  await atomicWriteJson(path.join(input.artifactDir, "changed-files.json"), { schemaVersion: 2, changedFiles: entries });
  await atomicWriteJson(path.join(input.artifactDir, "change-validation.json"), report);
  return report;
}

export const validateChangeSet = validateChanges;
