import { access, lstat, mkdir, open, realpath, stat, unlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { ReworkPackage } from "./schemas/reworkPackage.js";
import type { TaskBrief } from "./schemas/taskBrief.js";
import path from "node:path";
import { execFile, fork } from "node:child_process";
import { collectWorkspaceGitState, type WorkspaceDiffCheck } from "./gitWorkspaceState.js";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";

const require = createRequire(import.meta.url);

function resolveTsxImport(): string {
  return pathToFileURL(require.resolve("tsx")).href;
};


const execFileAsync = promisify(execFile);
const R_OK = 4;
const W_OK = 2;

export type SandboxMode = "read-only" | "workspace-write" | "danger-full-access";
export type SandboxIsolation = "enabled" | "disabled";

export type CodingTask = {
  originalTask: string;
  taskBrief: TaskBrief;
  repositoryPath: string;
  baseBranch: string;
  baseCommit?: string;
  runBranch?: string;
  workspacePath?: string;
  runId: string;
  workspaceRoot: string;
  sandboxMode?: SandboxMode;
  approvalPolicy?: "never";
  attemptNumber?: number;
};

export type ReworkCodingTask = {
  originalTask: string;
  taskBrief: TaskBrief;
  threadId: string;
  workspacePath: string;
  workspaceRoot: string;
  reworkPackage: ReworkPackage;
  sandboxMode?: SandboxMode;
  approvalPolicy?: "never";
  attemptNumber: number;
  previousAttemptResult?: string;
  reviewVerdict?: string;
};

type RenderedInstructionTask = {
  threadId?: string;
  renderedInstruction: string;
  workspacePath: string;
  workspaceRoot: string;
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
  diffCheck?: WorkspaceDiffCheck;
  instructionArtifactPath?: string;
  originalTaskLength?: number;
  originalTaskSha256?: string;
  renderedInstructionSha256?: string;
  attemptNumber?: number;
};

export interface CodingWorker {
  executeTask(input: CodingTask): Promise<CodingResult>;
  continueTask(input: ReworkCodingTask): Promise<CodingResult>;
}

type GitResult = { stdout: string; stderr: string };

export type CodexRuntimeRequest =
  | {
      mode: "start";
      workingDirectory: string;
      sandboxMode: SandboxMode;
      approvalPolicy: "never";
      model?: string;
      instruction: string;
    }
  | {
      mode: "continue";
      threadId: string;
      workingDirectory: string;
      sandboxMode: SandboxMode;
      approvalPolicy: "never";
      model?: string;
      instruction: string;
    };

export type CodexRuntimeDiagnostics = {
  sdkOptions?: Record<string, unknown>;
  sandboxModeRequested?: SandboxMode;
  sandboxModeEffective?: SandboxMode | "unconfirmed";
  approvalPolicy?: "never";
  childCwd?: string;
};

export type CodexRuntimeResult = {
  threadId: string;
  finalResponse: string;
  diagnostics?: CodexRuntimeDiagnostics;
};

export type CodexRuntimeLogSummary = {
  stdoutPath: string;
  stderrPath: string;
  stdoutBytes: number;
  stderrBytes: number;
  stdoutTruncated: boolean;
  stderrTruncated: boolean;
};

export type CodexRuntimeRunner = (input: { request: CodexRuntimeRequest; env: NodeJS.ProcessEnv; cwd: string; runtimeDir: string }) => Promise<CodexRuntimeResult>;

export type CodexSdkWorkerOptions = {
  codexRuntimeRunner?: CodexRuntimeRunner;
  workspaceProbeOpen?: typeof open;
  codexRuntimeChildPath?: string;
  codexRuntimeTimeoutMs?: number;
  git?: (args: string[], cwd?: string) => Promise<GitResult>;
  catosRoot?: string;
};

export type RuntimeManifest = {
  schemaVersion: 1;
  sandboxMode: SandboxMode;
  sandboxIsolation: SandboxIsolation;
  workspacePath: string;
  workspaceRoot: string;
  environmentPolicy: "allowlist";
  allowedEnvironmentVariables: string[];
  githubCredentialsRemoved: boolean;
  sshAgentRemoved: boolean;
  gitConfigGlobal: "/dev/null";
  gitConfigSystem: "/dev/null";
  gitTerminalPrompt: "0";
  homePath: string;
  tmpdirPath: string;
  network: "unrestricted";
  requestedWorkspacePath: string;
  resolvedWorkspacePath: string;
  childCwd?: string;
  workspaceWritable: boolean;
  workspaceWriteProbe: "passed" | "failed";
  sandboxModeRequested: SandboxMode;
  sandboxModeEffective: SandboxMode | "unconfirmed";
  approvalPolicy: "never";
  runtimeChildPid?: number;
  processUid?: number;
  processGid?: number;
  directoryOwnerUid?: number;
  directoryOwnerGid?: number;
  directoryMode?: string;
  gitStatus?: string;
  gitBranch?: string;
  startedAt: string;
};

const BASE_CODEX_ENV_ALLOWLIST = [
  "PATH",
  "LANG",
  "LC_ALL",
  "TERM",
  "OPENAI_API_KEY",
  "CODEX_API_KEY",
  "OPENAI_BASE_URL",
] as const;
const DEFAULT_CODEX_RUNTIME_TIMEOUT_MS = 30 * 60 * 1000;
const DEFAULT_CODEX_RUNTIME_LOG_LIMIT_BYTES = 1024 * 1024;

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

function buildCodexEnvironment(runtimeHome: string, runtimeTmpdir: string): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const name of BASE_CODEX_ENV_ALLOWLIST) {
    if (process.env[name] !== undefined) {
      env[name] = process.env[name];
    }
  }
  env.HOME = runtimeHome;
  env.TMPDIR = runtimeTmpdir;
  env.GIT_CONFIG_GLOBAL = "/dev/null";
  env.GIT_CONFIG_SYSTEM = "/dev/null";
  env.GIT_TERMINAL_PROMPT = "0";
  return env;
}

export async function guardCodexWorkspace(input: { workspacePath: string; workspaceRoot: string; repositoryPath?: string; catosRoot?: string }): Promise<{ workspacePath: string; workspaceRoot: string }> {
  const [workspaceStats, rootStats] = await Promise.all([lstat(input.workspacePath), lstat(input.workspaceRoot)]);
  if (workspaceStats.isSymbolicLink()) throw new Error(`Codex workspace must not be a symlink: ${input.workspacePath}`);
  if (rootStats.isSymbolicLink()) throw new Error(`Codex workspace root must not be a symlink: ${input.workspaceRoot}`);
  if (!workspaceStats.isDirectory()) throw new Error(`Codex workspace must be a directory: ${input.workspacePath}`);
  if (!rootStats.isDirectory()) throw new Error(`Codex workspace root must be a directory: ${input.workspaceRoot}`);

  const realWorkspacePath = await realpath(input.workspacePath);
  const realWorkspaceRoot = await realpath(input.workspaceRoot);
  const home = process.env.HOME ? await realpathIfExists(process.env.HOME) : undefined;
  const catosRoot = await realpathIfExists(input.catosRoot ?? process.cwd());
  const repositoryPath = input.repositoryPath ? await realpathIfExists(input.repositoryPath) : undefined;

  if (realWorkspacePath === path.parse(realWorkspacePath).root) throw new Error("Codex workspace must not be filesystem root.");
  if (home && realWorkspacePath === home) throw new Error("Codex workspace must not be HOME.");
  if (realWorkspacePath === catosRoot) throw new Error("Codex workspace must not be the CatOS repository root.");
  if (repositoryPath && realWorkspacePath === repositoryPath) throw new Error("Codex workspace must not be the target repository root.");
  if (!isPathInside(realWorkspaceRoot, realWorkspacePath)) {
    throw new Error(`Codex workspace must stay inside configured workspace root. workspace=${realWorkspacePath} root=${realWorkspaceRoot}`);
  }
  return { workspacePath: realWorkspacePath, workspaceRoot: realWorkspaceRoot };
}


export async function probeWorkspaceWritable(input: { workspacePath: string; workspaceRoot: string; repositoryPath?: string; runId?: string; git?: (args: string[], cwd?: string) => Promise<GitResult>; openFile?: typeof open }): Promise<{ writable: true; probe: Record<string, unknown> }> {
  const requestedWorkspacePath = path.resolve(input.workspacePath);
  const resolvedWorkspacePath = await realpath(input.workspacePath);
  const resolvedWorkspaceRoot = await realpath(input.workspaceRoot);
  const directory = await stat(resolvedWorkspacePath);
  if (!isPathInside(resolvedWorkspaceRoot, resolvedWorkspacePath)) throw new Error(`WORKSPACE_NOT_WRITABLE: workspace is outside isolated run root. workspace=${resolvedWorkspacePath} root=${resolvedWorkspaceRoot}`);
  if (input.repositoryPath && resolvedWorkspacePath === await realpathIfExists(input.repositoryPath)) throw new Error("WORKSPACE_NOT_WRITABLE: workspace resolves to the source clone.");
  await access(resolvedWorkspacePath, R_OK | W_OK);
  const probeName = `.write-probe-${sanitizeRunIdForPath(input.runId ?? "run")}`;
  const probePath = path.join(resolvedWorkspacePath, probeName);
  let handle: Awaited<ReturnType<typeof open>> | undefined;
  try {
    handle = await (input.openFile ?? open)(probePath, "wx");
    await handle.writeFile("workspace write probe\n", "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await access(probePath, R_OK);
  } catch (error) {
    try { if (handle) await handle.close(); } catch {}
    try { await unlink(probePath); } catch {}
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(`WORKSPACE_NOT_WRITABLE: coordinator write probe failed for ${resolvedWorkspacePath}: ${message}`);
  } finally {
    try { await unlink(probePath); } catch {}
  }
  const gitStatus = input.git ? (await input.git(["status", "--porcelain=v1", "--untracked-files=all"], resolvedWorkspacePath)).stdout : undefined;
  const gitBranch = input.git ? (await input.git(["branch", "--show-current"], resolvedWorkspacePath)).stdout.trim() || "DETACHED" : undefined;
  return { writable: true, probe: { requestedWorkspacePath, resolvedWorkspacePath, workspaceWritable: true, workspaceWriteProbe: "passed", processUid: process.getuid?.(), processGid: process.getgid?.(), directoryOwnerUid: directory.uid, directoryOwnerGid: directory.gid, directoryMode: `0${(directory.mode & 0o777).toString(8)}`, gitStatus, gitBranch } };
}

async function writeRuntimeManifest(runtimeDir: string, manifest: RuntimeManifest): Promise<void> {
  await writeFile(path.join(runtimeDir, "runtime.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

async function prepareRuntime(input: { workspacePath: string; workspaceRoot: string; sandboxMode: SandboxMode; sandboxIsolation: SandboxIsolation; probe: Record<string, unknown> }): Promise<{ env: NodeJS.ProcessEnv; manifest: RuntimeManifest; runtimeDir: string }> {
  const runtimeDir = path.join(path.dirname(input.workspacePath), "runtime");
  const homePath = path.join(runtimeDir, "home");
  const tmpdirPath = path.join(runtimeDir, "tmp");
  await mkdir(homePath, { recursive: true });
  await mkdir(tmpdirPath, { recursive: true });
  const env = buildCodexEnvironment(homePath, tmpdirPath);
  const manifest: RuntimeManifest = {
    schemaVersion: 1,
    sandboxMode: input.sandboxMode,
    sandboxIsolation: input.sandboxIsolation,
    workspacePath: input.workspacePath,
    workspaceRoot: input.workspaceRoot,
    environmentPolicy: "allowlist",
    allowedEnvironmentVariables: Object.keys(env).sort(),
    githubCredentialsRemoved: !("GITHUB_TOKEN" in env) && !("GH_TOKEN" in env),
    sshAgentRemoved: !("SSH_AUTH_SOCK" in env),
    gitConfigGlobal: "/dev/null",
    gitConfigSystem: "/dev/null",
    gitTerminalPrompt: "0",
    homePath,
    tmpdirPath,
    network: "unrestricted",
    requestedWorkspacePath: String(input.probe.requestedWorkspacePath),
    resolvedWorkspacePath: String(input.probe.resolvedWorkspacePath),
    workspaceWritable: true,
    workspaceWriteProbe: "passed",
    sandboxModeRequested: input.sandboxMode,
    sandboxModeEffective: "unconfirmed",
    approvalPolicy: "never",
    processUid: input.probe.processUid as number | undefined,
    processGid: input.probe.processGid as number | undefined,
    directoryOwnerUid: input.probe.directoryOwnerUid as number | undefined,
    directoryOwnerGid: input.probe.directoryOwnerGid as number | undefined,
    directoryMode: input.probe.directoryMode as string | undefined,
    gitStatus: input.probe.gitStatus as string | undefined,
    gitBranch: input.probe.gitBranch as string | undefined,
    startedAt: new Date().toISOString(),
  };
  await writeRuntimeManifest(runtimeDir, manifest);
  return { env, manifest, runtimeDir };
}

export async function buildIsolatedWorkspacePath(input: { workspaceRoot: string; runId: string; repositoryPath: string; catosRoot?: string }): Promise<string> {
  const workspaceRoot = await realpathIfExists(input.workspaceRoot);
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

type TaskBriefWithOptionalFields = TaskBrief & { expectedFiles?: unknown; constraints?: unknown };

function linesOrDash(items: string[] | undefined, empty = "- none"): string[] {
  return items && items.length > 0 ? items.map((item) => `- ${item}`) : [empty];
}

function stringArray(value: unknown): string[] | undefined {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string" && item.length > 0) : undefined;
}

function constraintsForTaskBrief(taskBrief: TaskBriefWithOptionalFields): string[] {
  const explicit = stringArray(taskBrief.constraints);
  return [
    ...(explicit ?? []),
    `riskLevel: ${taskBrief.riskLevel}`,
  ];
}

function taskBriefSummary(taskBrief: TaskBriefWithOptionalFields): string[] {
  return [
    `Objective: ${taskBrief.objective}`,
    "",
    "Derived implementation guidance:",
    taskBrief.codexInstruction,
    "",
    "Acceptance criteria:",
    ...linesOrDash(taskBrief.acceptanceCriteria),
    "",
    "Expected files:",
    ...linesOrDash(stringArray(taskBrief.expectedFiles)),
    "",
    "Non-goals:",
    ...linesOrDash(taskBrief.nonGoals),
    "",
    "Constraints:",
    ...linesOrDash(constraintsForTaskBrief(taskBrief)),
  ];
}

export function sha256Text(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

export function buildCodexInstruction(input: { originalTask: string; taskBrief: TaskBrief }): string {
  const taskBrief = input.taskBrief as TaskBriefWithOptionalFields;
  return [
    "# Coding task",
    "",
    "## Original user task — verbatim",
    "",
    input.originalTask,
    "",
    "## Derived implementation guidance",
    "",
    taskBrief.codexInstruction,
    "",
    "## Acceptance criteria",
    "",
    ...linesOrDash(taskBrief.acceptanceCriteria),
    "",
    "## Expected files",
    "",
    ...linesOrDash(stringArray(taskBrief.expectedFiles)),
    "",
    "## Non-goals",
    "",
    ...linesOrDash(taskBrief.nonGoals),
    "",
    "## Constraints",
    "",
    ...linesOrDash(constraintsForTaskBrief(taskBrief)),
    "",
    "## Execution rules",
    "",
    "- The Original user task section is authoritative for literal requirements. Derived guidance and acceptance criteria are additive and must not replace or alter explicit content, filenames, markers, formatting requirements, or exact file contents stated in the original task.",
    "- If derived guidance conflicts with an explicit literal requirement in the Original user task section, preserve the original literal requirement and report the conflict instead of silently changing or omitting it.",
    "- Modify only files inside the provided Git worktree workspace.",
    "- Do not change files outside the worktree.",
    "- Do not create commits, push, merge, or rebase.",
    "- Do not add secrets, credentials, API keys, tokens, or private data.",
    "- You may run reasonable local commands to inspect or support your implementation, but CatOS will not treat them as a verification gate in this stage.",
  ].join("\n");
}

export function buildReworkCodexInstruction(input: { originalTask: string; taskBrief: TaskBrief; reworkPackage: ReworkPackage; previousAttemptResult?: string; reviewVerdict?: string }): string {
  const taskBrief = input.taskBrief as TaskBriefWithOptionalFields;
  return [
    "# Coding rework task",
    "",
    "## Original user task — verbatim",
    "",
    input.originalTask,
    "",
    "## Existing derived task brief",
    "",
    ...taskBriefSummary(taskBrief),
    "",
    "## Previous attempt result",
    "",
    input.previousAttemptResult ?? input.reworkPackage.previousAttemptSummary,
    "",
    "## Review verdict",
    "",
    input.reviewVerdict ?? "REWORK",
    "",
    "## Blocking findings",
    "",
    ...input.reworkPackage.blockingFindings.map((finding) => [
      `- ${finding.id}: ${finding.title}`,
      `  Evidence: ${finding.evidence}`,
      `  Required change: ${finding.requiredChange}`,
    ].join("\n")),
    "",
    "## Required changes",
    "",
    ...linesOrDash(input.reworkPackage.mustChange),
    "",
    "## Acceptance criteria",
    "",
    ...linesOrDash(input.reworkPackage.acceptanceCriteria),
    "",
    "## Constraints",
    "",
    ...linesOrDash([
      ...constraintsForTaskBrief(taskBrief),
      ...input.reworkPackage.mustNotChange,
      "Review findings are additive rework guidance and do not replace the Original user task section.",
      "If a Review instruction conflicts with an explicit literal requirement from the Original user task section, preserve the original literal requirement while resolving or reporting the conflict.",
    ]),
    "",
    "## Preserve",
    "",
    ...linesOrDash(input.reworkPackage.preserve, "- Preserve all behavior unrelated to the blocking findings."),
    "",
    "## Execution rules",
    "",
    "- Continue working in the same Git worktree workspace already provided to this thread.",
    "- Modify only files inside that workspace.",
    "- Do not change files outside the workspace.",
    "- Do not create commits, push, merge, or rebase.",
    "- Do not add secrets, credentials, API keys, tokens, or private data.",
  ].join("\n");
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

function defaultCodexRuntimeChildPath(): string {
  const current = fileURLToPath(import.meta.url);
  const extension = path.extname(current);
  return path.join(path.dirname(current), `codexRuntimeChild${extension}`);
}

async function assertCodexRuntimeChildPath(childPath: string): Promise<string> {
  const resolved = path.resolve(childPath);
  try {
    await access(resolved);
  } catch {
    throw new Error(`Codex runtime child module does not exist: ${resolved}`);
  }
  if (![".js", ".cjs", ".mjs", ".ts"].includes(path.extname(resolved))) {
    throw new Error(`Codex runtime child module must be a JavaScript/TypeScript file: ${resolved}`);
  }
  return resolved;
}

function formatChildError(error: unknown): string {
  if (error && typeof error === "object") {
    const candidate = error as { name?: unknown; message?: unknown; stack?: unknown };
    return [candidate.name, candidate.message, candidate.stack].filter((value): value is string => typeof value === "string" && value.length > 0).join("\n");
  }
  return String(error ?? "unknown error");
}


export function codexSandboxWriteFailure(input: { error: unknown; stderr?: string; sandboxModeRequested: SandboxMode; sandboxModeEffective?: SandboxMode | "unconfirmed"; workspaceWritableByCoordinator?: boolean; workspacePath?: string }): { code: "CODEX_SANDBOX_WRITE_FAILED"; message: string; details: Record<string, unknown> } | null {
  const originalMessage = formatChildError(input.error);
  const joined = `${originalMessage}\n${input.stderr ?? ""}`;
  if (!/(sandbox|permission denied|operation not permitted|read-only|EROFS|EACCES|EPERM|write)/i.test(joined)) return null;
  return {
    code: "CODEX_SANDBOX_WRITE_FAILED",
    message: "Codex could not write to the isolated workspace.",
    details: {
      originalMessage,
      stderrExcerpt: input.stderr?.slice(0, 4000),
      sandboxModeRequested: input.sandboxModeRequested,
      sandboxModeEffective: input.sandboxModeEffective ?? "unconfirmed",
      workspaceWritableByCoordinator: input.workspaceWritableByCoordinator,
      workspacePath: input.workspacePath ? "<run-workspace>" : undefined,
    },
  };
}

function resolveCodexRuntimeTimeoutMs(configured?: number): number {
  if (configured !== undefined) return configured;
  const raw = process.env.CATOS_CODEX_RUNTIME_TIMEOUT_MS;
  if (!raw) return DEFAULT_CODEX_RUNTIME_TIMEOUT_MS;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`CATOS_CODEX_RUNTIME_TIMEOUT_MS must be a positive number of milliseconds, got: ${raw}`);
  }
  return parsed;
}

function appendLimited(buffer: Buffer, chunk: Buffer, limitBytes: number): { buffer: Buffer; truncated: boolean } {
  if (buffer.byteLength >= limitBytes) return { buffer, truncated: true };
  const remaining = limitBytes - buffer.byteLength;
  if (chunk.byteLength <= remaining) return { buffer: Buffer.concat([buffer, chunk]), truncated: false };
  return { buffer: Buffer.concat([buffer, chunk.subarray(0, remaining)]), truncated: true };
}

async function writeRuntimeLogs(runtimeDir: string, stdout: Buffer, stderr: Buffer, stdoutTruncated: boolean, stderrTruncated: boolean): Promise<CodexRuntimeLogSummary> {
  const stdoutPath = path.join(runtimeDir, "codex-runtime.stdout.log");
  const stderrPath = path.join(runtimeDir, "codex-runtime.stderr.log");
  await Promise.all([
    writeFile(stdoutPath, stdout),
    writeFile(stderrPath, stderr),
  ]);
  return {
    stdoutPath,
    stderrPath,
    stdoutBytes: stdout.byteLength,
    stderrBytes: stderr.byteLength,
    stdoutTruncated,
    stderrTruncated,
  };
}

async function writeRuntimeError(runtimeDir: string, reason: string, logSummary: CodexRuntimeLogSummary, rootCause?: unknown): Promise<void> {
  await writeFile(path.join(runtimeDir, "codex-runtime-error.json"), `${JSON.stringify({
    schemaVersion: 1,
    reason,
    rootCause,
    logSummary,
    recordedAt: new Date().toISOString(),
  }, null, 2)}\n`, "utf8");
}

export function createForkedCodexRuntimeRunner(options: { childPath?: string; timeoutMs?: number; logLimitBytes?: number } = {}): CodexRuntimeRunner {
  return async (input) => {
    return await runForkedCodexRuntime({
      ...input,
      childPath: options.childPath ?? defaultCodexRuntimeChildPath(),
      timeoutMs: options.timeoutMs ?? DEFAULT_CODEX_RUNTIME_TIMEOUT_MS,
      logLimitBytes: options.logLimitBytes ?? DEFAULT_CODEX_RUNTIME_LOG_LIMIT_BYTES,
    });
  };
}

async function runForkedCodexRuntime(input: { request: CodexRuntimeRequest; env: NodeJS.ProcessEnv; cwd: string; runtimeDir: string; childPath: string; timeoutMs: number; logLimitBytes: number }): Promise<CodexRuntimeResult> {
  const childPath = await assertCodexRuntimeChildPath(input.childPath);
  const execArgv = childPath.endsWith(".ts") ? ["--import", resolveTsxImport()] : [];
  const child = fork(childPath, [], {
    cwd: input.cwd,
    env: input.env,
    execArgv,
    serialization: "json",
    silent: true,
  });
  let stdout: Buffer = Buffer.alloc(0);
  let stderr: Buffer = Buffer.alloc(0);
  let stdoutTruncated = false;
  let stderrTruncated = false;
  const onStdout = (chunk: Buffer) => {
    const next = appendLimited(stdout, chunk, input.logLimitBytes);
    stdout = next.buffer;
    stdoutTruncated = stdoutTruncated || next.truncated;
  };
  const onStderr = (chunk: Buffer) => {
    const next = appendLimited(stderr, chunk, input.logLimitBytes);
    stderr = next.buffer;
    stderrTruncated = stderrTruncated || next.truncated;
  };
  child.stdout?.on("data", onStdout);
  child.stderr?.on("data", onStderr);
  const manifestPath = path.join(input.runtimeDir, "runtime.json");
  void (async () => {
    try {
      const manifest = JSON.parse(await (await import("node:fs/promises")).readFile(manifestPath, "utf8")) as RuntimeManifest;
      manifest.childCwd = input.cwd;
      manifest.runtimeChildPid = child.pid;
      manifest.sandboxModeRequested = input.request.sandboxMode;
      manifest.sandboxModeEffective = "unconfirmed";
      manifest.approvalPolicy = "never";
      await writeRuntimeManifest(input.runtimeDir, manifest);
    } catch {}
  })();

  return await new Promise<CodexRuntimeResult>((resolve, reject) => {
    let settled = false;
    let messageReceived = false;
    let timeout: NodeJS.Timeout | undefined;

    async function finishLogs(reason?: string, rootCause?: unknown): Promise<void> {
      const logSummary = await writeRuntimeLogs(input.runtimeDir, stdout, stderr, stdoutTruncated, stderrTruncated);
      if (reason) await writeRuntimeError(input.runtimeDir, reason, logSummary, rootCause);
    }

    function cleanup(): void {
      if (timeout) clearTimeout(timeout);
      child.stdout?.off("data", onStdout);
      child.stderr?.off("data", onStderr);
      child.removeAllListeners("error");
      child.removeAllListeners("message");
      child.removeAllListeners("exit");
      if (child.connected) child.disconnect();
    }

    function terminateChild(): void {
      if (!child.killed) child.kill();
    }

    function settleWithError(error: Error, reason: string): void {
      if (settled) return;
      settled = true;
      terminateChild();
      void finishLogs(reason, (error as Error & { rootCause?: unknown }).rootCause).finally(() => {
        cleanup();
        reject(error);
      });
    }

    function settleWithSuccess(result: CodexRuntimeResult): void {
      if (settled) return;
      settled = true;
      terminateChild();
      void finishLogs().finally(() => {
        cleanup();
        resolve(result);
      });
    }

    timeout = setTimeout(() => {
      settleWithError(new Error(`Codex runtime worker timed out after ${input.timeoutMs}ms.`), "timeout");
    }, input.timeoutMs);
    timeout.unref?.();

    child.once("error", (error) => {
      settleWithError(new Error(`Codex runtime worker failed to start: ${error.message}`), "start-error");
    });

    child.on("message", (message: unknown) => {
      if (settled) return;
      messageReceived = true;
      if (!message || typeof message !== "object") {
        settleWithError(new Error("Codex runtime worker returned invalid IPC output."), "invalid-ipc");
        return;
      }
      const payload = message as { ok?: unknown; result?: unknown; error?: unknown };
      if (payload.ok === true && payload.result && typeof payload.result === "object") {
        const result = payload.result as Partial<CodexRuntimeResult>;
        if (typeof result.threadId === "string" && typeof result.finalResponse === "string") {
          settleWithSuccess({ threadId: result.threadId, finalResponse: result.finalResponse, diagnostics: result.diagnostics });
          return;
        }
      }
      if (payload.ok === false) {
        const sdkError = new Error(`Codex runtime worker SDK error:\n${formatChildError(payload.error)}${stderr.byteLength > 0 ? `\n\nstderr:\n${stderr.toString("utf8")}` : ""}`) as Error & { rootCause?: unknown };
        sdkError.rootCause = codexSandboxWriteFailure({ error: payload.error, stderr: stderr.toString("utf8"), sandboxModeRequested: input.request.sandboxMode, sandboxModeEffective: "unconfirmed", workspaceWritableByCoordinator: true, workspacePath: input.cwd });
        settleWithError(sdkError, "sdk-error");
        return;
      }
      settleWithError(new Error("Codex runtime worker returned malformed result."), "malformed-result");
    });

    child.once("exit", (code, signal) => {
      if (settled) return;
      if (signal) {
        settleWithError(new Error(`Codex runtime worker terminated by signal ${signal}.${stderr.byteLength > 0 ? `\n\nstderr:\n${stderr.toString("utf8")}` : ""}`), "signal");
        return;
      }
      if (code !== 0) {
        settleWithError(new Error(`Codex runtime worker exited with code ${code ?? "null"}.${stderr.byteLength > 0 ? `\n\nstderr:\n${stderr.toString("utf8")}` : ""}`), "exit-code");
        return;
      }
      if (!messageReceived) {
        settleWithError(new Error(`Codex runtime worker exited without IPC result.${stdout.byteLength > 0 ? `\n\nstdout:\n${stdout.toString("utf8")}` : ""}${stderr.byteLength > 0 ? `\n\nstderr:\n${stderr.toString("utf8")}` : ""}`), "missing-ipc");
      }
    });

    child.send(input.request, (error) => {
      if (error) settleWithError(new Error(`Failed to send Codex runtime request: ${error.message}`), "send-error");
    });
  });
}


async function updateRuntimeManifestFromResult(runtimeDir: string, result: CodexRuntimeResult): Promise<void> {
  try {
    const { readFile } = await import("node:fs/promises");
    const manifest = JSON.parse(await readFile(path.join(runtimeDir, "runtime.json"), "utf8")) as RuntimeManifest & { sdkOptions?: Record<string, unknown> };
    if (result.diagnostics?.childCwd) manifest.childCwd = result.diagnostics.childCwd;
    if (result.diagnostics?.sandboxModeEffective) manifest.sandboxModeEffective = result.diagnostics.sandboxModeEffective;
    if (result.diagnostics?.sdkOptions) manifest.sdkOptions = result.diagnostics.sdkOptions;
    await writeRuntimeManifest(runtimeDir, manifest);
  } catch {}
}

export class CodexSdkWorker implements CodingWorker {
  private readonly git: (args: string[], cwd?: string) => Promise<GitResult>;
  private readonly codexRuntimeRunner: CodexRuntimeRunner;
  private readonly catosRoot?: string;
  private readonly workspaceProbeOpen?: typeof open;

  constructor(options: CodexSdkWorkerOptions = {}) {
    this.git = options.git ?? defaultGit;
    this.codexRuntimeRunner = options.codexRuntimeRunner ?? createForkedCodexRuntimeRunner({ childPath: options.codexRuntimeChildPath, timeoutMs: resolveCodexRuntimeTimeoutMs(options.codexRuntimeTimeoutMs) });
    this.catosRoot = options.catosRoot;
    this.workspaceProbeOpen = options.workspaceProbeOpen;
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
      diffCheck: workspaceState.diffCheck,
    };
  }

  async executeTask(input: CodingTask): Promise<CodingResult> {
    const repositoryPath = path.resolve(input.repositoryPath);
    await this.git(["rev-parse", "--is-inside-work-tree"], repositoryPath);
    const baseCommit =
      input.baseCommit ??
      (
        await this.git(
          ["rev-parse", "--verify", `${input.baseBranch}^{commit}`],
          repositoryPath,
        )
      ).stdout.trim();
    await this.git(["cat-file", "-e", `${baseCommit}^{commit}`], repositoryPath);

    const branchName = input.runBranch ?? normalizeWorkBranchName(input.runId);
    const workspacePath = input.workspacePath ?? await buildIsolatedWorkspacePath({ workspaceRoot: input.workspaceRoot, runId: input.runId, repositoryPath, catosRoot: this.catosRoot });
    await mkdir(path.dirname(workspacePath), { recursive: true });
    await this.git(["worktree", "add", "-b", branchName, workspacePath, baseCommit], repositoryPath);

    const sandboxMode = input.sandboxMode ?? "workspace-write";
    const sandboxIsolation = sandboxMode === "danger-full-access" ? "disabled" : "enabled";
    if (sandboxMode === "danger-full-access") {
      console.warn([
        "⚠️  WARNING: Codex sandbox isolation is DISABLED.",
        "CatOS is running Codex with sandboxMode=danger-full-access because it was explicitly configured and acknowledged.",
        "Use this compatibility mode only in trusted repositories without sensitive data.",
      ].join("\n"));
    }

    const guarded = await guardCodexWorkspace({ workspacePath, workspaceRoot: input.workspaceRoot, repositoryPath, catosRoot: this.catosRoot });
    const writeProbe = await probeWorkspaceWritable({ workspacePath: guarded.workspacePath, workspaceRoot: guarded.workspaceRoot, repositoryPath, runId: input.runId, git: this.git, openFile: this.workspaceProbeOpen });
    const runtime = await prepareRuntime({ workspacePath: guarded.workspacePath, workspaceRoot: guarded.workspaceRoot, sandboxMode, sandboxIsolation, probe: writeProbe.probe });
    const model = process.env.CATOS_CODEX_MODEL;
    const renderedInstruction = buildCodexInstruction({ originalTask: input.originalTask, taskBrief: input.taskBrief });
    const runtimeResult = await this.codexRuntimeRunner({
      env: runtime.env,
      cwd: guarded.workspacePath,
      runtimeDir: runtime.runtimeDir,
      request: {
        mode: "start",
        workingDirectory: guarded.workspacePath,
        sandboxMode,
        approvalPolicy: input.approvalPolicy ?? "never",
        ...(model ? { model } : {}),
        instruction: renderedInstruction,
      },
    });

    await updateRuntimeManifestFromResult(runtime.runtimeDir, runtimeResult);
    return await this.collectResult({
      threadId: runtimeResult.threadId,
      finalResponse: runtimeResult.finalResponse,
      workspacePath: guarded.workspacePath,
      sandboxMode,
      sandboxIsolation,
    });
  }

  async continueTask(input: ReworkCodingTask): Promise<CodingResult> {
    return await this.runRenderedInstruction({
      threadId: input.threadId,
      renderedInstruction: buildReworkCodexInstruction({
        originalTask: input.originalTask,
        taskBrief: input.taskBrief,
        reworkPackage: input.reworkPackage,
        previousAttemptResult: input.previousAttemptResult,
        reviewVerdict: input.reviewVerdict,
      }),
      workspacePath: input.workspacePath,
      workspaceRoot: input.workspaceRoot,
      sandboxMode: input.sandboxMode,
    });
  }

  private async runRenderedInstruction(input: RenderedInstructionTask): Promise<CodingResult> {
    const sandboxMode = input.sandboxMode ?? "workspace-write";
    const sandboxIsolation = sandboxMode === "danger-full-access" ? "disabled" : "enabled";
    const guarded = await guardCodexWorkspace({ workspacePath: input.workspacePath, workspaceRoot: input.workspaceRoot, catosRoot: this.catosRoot });
    const writeProbe = await probeWorkspaceWritable({ workspacePath: guarded.workspacePath, workspaceRoot: guarded.workspaceRoot, runId: input.threadId ?? "continue", git: this.git, openFile: this.workspaceProbeOpen });
    const runtime = await prepareRuntime({ workspacePath: guarded.workspacePath, workspaceRoot: guarded.workspaceRoot, sandboxMode, sandboxIsolation, probe: writeProbe.probe });
    const model = process.env.CATOS_CODEX_MODEL;
    const runtimeResult = await this.codexRuntimeRunner({
      env: runtime.env,
      cwd: guarded.workspacePath,
      runtimeDir: runtime.runtimeDir,
      request: {
        ...(input.threadId ? { mode: "continue" as const, threadId: input.threadId } : { mode: "start" as const }),
        workingDirectory: guarded.workspacePath,
        sandboxMode,
        approvalPolicy: "never",
        ...(model ? { model } : {}),
        instruction: input.renderedInstruction,
      },
    });
    await updateRuntimeManifestFromResult(runtime.runtimeDir, runtimeResult);
    return await this.collectResult({
      threadId: runtimeResult.threadId,
      finalResponse: runtimeResult.finalResponse,
      workspacePath: guarded.workspacePath,
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
    diffCheck: result.diffCheck,
    instructionArtifactPath: result.instructionArtifactPath,
    originalTaskLength: result.originalTaskLength,
    originalTaskSha256: result.originalTaskSha256,
    renderedInstructionSha256: result.renderedInstructionSha256,
    attemptNumber: result.attemptNumber,
  }, null, 2)}\n`, "utf8");
  await writeFile(diffPath, result.diff, "utf8");
  await writeFile(statusPath, result.status, "utf8");
  return { codingResultPath, diffPath, statusPath, taskBriefPath };
}
