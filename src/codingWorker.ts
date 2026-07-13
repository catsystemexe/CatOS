import { mkdir, realpath, stat, writeFile } from "node:fs/promises";
import type { ReworkPackage } from "./schemas/reworkPackage.js";
import path from "node:path";
import { execFile } from "node:child_process";
import { collectWorkspaceGitState } from "./gitWorkspaceState.js";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type SandboxIsolation = "enabled" | "disabled";

export type CodingTask = {
  instruction: string;
  repositoryPath: string;
  baseBranch: string;
  runId: string;
  workspaceRoot: string;
  sandboxMode?: SandboxMode;
};

export type ReworkCodingTask = {
  threadId: string;
  workspacePath: string;
  reworkPackage: ReworkPackage;
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
  continueTask(input: ReworkCodingTask): Promise<CodingResult>;
}

type GitResult = { stdout: string; stderr: string };

type CodexThread = {
  id?: string;
  threadId?: string;
  run(instruction: string): Promise<unknown>;
};

type CodexClient = {
  startThread(options: { workingDirectory: string; sandboxMode?: SandboxMode; model?: string }): CodexThread;
  resumeThread?: (threadId: string, options: { workingDirectory: string; sandboxMode?: SandboxMode; model?: string }) => CodexThread;
  continueThread?: (threadId: string, options: { workingDirectory: string; sandboxMode?: SandboxMode; model?: string }) => CodexThread;
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
  catosRoot?: string;
};

export function normalizeWorkBranchName(runId: string): string {
  const normalized = runId
    .trim()
    .replace(/[^A-Za-z0-9._/-]+/g, "-")
    .replace(/\.\.+/g, ".")
    .replace(/\/+/g, "/")
    .replace(/^[\/.-]+|[\/.-]+$/g, "")
    .replace(/\.lock$/i, "");
  const safeRunId = normalized.length > 0 ? normalized : "run";
  return `catos/${safeRunId}`.slice(0, 200).replace(/[/.-]+$/g, "");
}


function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return relative === "" || (!!relative && !relative.startsWith("..") && !path.isAbsolute(relative));
}

function sanitizeRunIdForPath(runId: string): string {
  return runId.trim().replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "") || "run";
}

async function realpathIfExists(inputPath: string): Promise<string> {
  try {
    return await realpath(inputPath);
  } catch {
    return path.resolve(inputPath);
  }
}

export async function buildIsolatedWorkspacePath(input: { workspaceRoot: string; runId: string; repositoryPath: string; catosRoot?: string }): Promise<string> {
  const workspaceRoot = path.resolve(input.workspaceRoot);
  const workspacePath = path.resolve(workspaceRoot, sanitizeRunIdForPath(input.runId), "workspace");
  const [catosRoot, repositoryPath] = await Promise.all([
    realpathIfExists(input.catosRoot ?? process.cwd()),
    realpathIfExists(input.repositoryPath),
  ]);

  if (!isPathInside(workspaceRoot, workspacePath)) {
    throw new Error("workspacePath must stay inside configured workspaceRoot.");
  }
  if (!workspacePath.includes(`${path.sep}${sanitizeRunIdForPath(input.runId)}${path.sep}`)) {
    throw new Error("workspacePath must be uniquely tied to runId.");
  }
  if (isPathInside(catosRoot, workspacePath)) {
    throw new Error("workspacePath must not be inside the CatOS repository root.");
  }
  if (isPathInside(repositoryPath, workspacePath)) {
    throw new Error("workspacePath must not be inside the target repository checkout.");
  }
  try {
    await stat(workspacePath);
    throw new Error("workspacePath already exists and may belong to another active worktree for this run.");
  } catch (error) {
    const systemError = error as NodeJS.ErrnoException;
    if (systemError.code !== "ENOENT") throw error;
  }

  return workspacePath;
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


export function buildReworkCodexInstruction(reworkPackage: ReworkPackage): string {
  return [
    "You are continuing the same CatOS Codex Worker thread for a bounded rework attempt.",
    "",
    "Safety rules:",
    "- Continue working in the same Git worktree workspace already provided to this thread.",
    "- Modify only files inside that workspace.",
    "- Do not change files outside the workspace.",
    "- Do not create commits, push, merge, or rebase.",
    "- Do not add secrets, credentials, API keys, tokens, or private data.",
    "- Make only the specific required changes below and preserve already satisfied behavior.",
    "",
    `Rework attempt: ${reworkPackage.attempt}`,
    `Original objective: ${reworkPackage.originalObjective}`,
    "",
    "Acceptance criteria:",
    ...reworkPackage.acceptanceCriteria.map((criterion) => `- ${criterion}`),
    "",
    "Blocking findings to fix:",
    ...reworkPackage.blockingFindings.map((finding) => [
      `- ${finding.id}: ${finding.title}`,
      `  Evidence: ${finding.evidence}`,
      `  Required change: ${finding.requiredChange}`,
    ].join("\n")),
    "",
    "Must change:",
    ...reworkPackage.mustChange.map((item) => `- ${item}`),
    "",
    "Preserve:",
    ...(reworkPackage.preserve.length > 0 ? reworkPackage.preserve.map((item) => `- ${item}`) : ["- Preserve all behavior unrelated to the blocking findings."]),
    "",
    "Must not change:",
    ...(reworkPackage.mustNotChange.length > 0 ? reworkPackage.mustNotChange.map((item) => `- ${item}`) : ["- Do not expand scope beyond the original TaskBrief."]),
    "",
    `Previous attempt summary: ${reworkPackage.previousAttemptSummary}`,
  ].join("\n");
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
  private readonly catosRoot?: string;

  constructor(options: CodexSdkWorkerOptions = {}) {
    this.git = options.git ?? defaultGit;
    this.codexFactory = options.codexFactory;
    this.catosRoot = options.catosRoot;
  }

  private async collectResult(input: { threadId: string; finalResponse: string; workspacePath: string; sandboxMode: SandboxMode; sandboxIsolation: SandboxIsolation }): Promise<CodingResult> {
    const workspaceState = await collectWorkspaceGitState(input.workspacePath, { git: this.git });
    return {
      threadId: input.threadId,
      finalResponse: input.finalResponse,
      workspacePath: input.workspacePath,
      changedFiles: workspaceState.changedFiles,
      diff: workspaceState.diff,
      status: workspaceState.status,
      sandboxMode: input.sandboxMode,
      sandboxIsolation: input.sandboxIsolation,
    };
  }

  async executeTask(input: CodingTask): Promise<CodingResult> {
    const repositoryPath = path.resolve(input.repositoryPath);
    await this.git(["rev-parse", "--is-inside-work-tree"], repositoryPath);
    await this.git(["rev-parse", "--verify", `${input.baseBranch}^{commit}`], repositoryPath);

    const branchName = normalizeWorkBranchName(input.runId);
    const workspacePath = await buildIsolatedWorkspacePath({ workspaceRoot: input.workspaceRoot, runId: input.runId, repositoryPath, catosRoot: this.catosRoot });
    await mkdir(path.dirname(workspacePath), { recursive: true });
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

    return await this.collectResult({
      threadId: thread.id ?? thread.threadId ?? "unknown",
      finalResponse: stringifyCodexTurn(turn),
      workspacePath,
      sandboxMode,
      sandboxIsolation,
    });
  }

  async continueTask(input: ReworkCodingTask): Promise<CodingResult> {
    const workspacePath = path.resolve(input.workspacePath);
    const sandboxMode = input.sandboxMode ?? "workspace-write";
    const sandboxIsolation = sandboxMode === "danger-full-access" ? "disabled" : "enabled";
    const factory = this.codexFactory ?? (await loadDefaultCodexFactory());
    const codex = factory();
    const options = {
      workingDirectory: workspacePath,
      sandboxMode,
      ...(process.env.CATOS_CODEX_MODEL ? { model: process.env.CATOS_CODEX_MODEL } : {}),
    };
    const resume = codex.resumeThread ?? codex.continueThread;
    if (!resume) {
      throw new Error("Codex SDK client does not expose resumeThread/continueThread for rework continuation.");
    }
    const thread = resume.call(codex, input.threadId, options);
    const turn = await thread.run(buildReworkCodexInstruction(input.reworkPackage));
    return await this.collectResult({
      threadId: thread.id ?? thread.threadId ?? input.threadId,
      finalResponse: stringifyCodexTurn(turn),
      workspacePath,
      sandboxMode,
      sandboxIsolation,
    });
  }
}

export async function writeCodingArtifacts(runDir: string, taskBrief: unknown, result: CodingResult): Promise<{ codingResultPath: string; diffPath: string; statusPath: string; taskBriefPath: string }> {
  await mkdir(runDir, { recursive: true });
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
