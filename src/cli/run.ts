import { randomUUID } from "node:crypto";
import path from "node:path";
import { loadProjectConfig } from "../config/loadConfig.js";
import { resolveWorkspaceRoot } from "../workspaceRoot.js";
import { runPreflight, type PreflightResult } from "../autocodex/preflight.js";
import { orchestrate, type OrchestratorResult } from "../autocodex/orchestrator.js";
import { createCodexCli } from "../autocodex/codexCliAdapter.js";
import { git } from "../autocodex/git.js";

/** v2 `run` is deliberately only an argument/configuration adapter. */
export type RunCliOptions = {
  cwd?: string;
  runId?: string;
  preflight?: typeof runPreflight;
  orchestrator?: typeof orchestrate;
  log?: (message: string) => void;
};

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name);
  return index === -1 ? undefined : args[index + 1];
}

function requireOption(args: readonly string[], name: string, label: string): string {
  const value = option(args, name);
  if (!value || value.startsWith("--")) throw new Error(`Chybí povinný parametr ${name} (${label}).`);
  return value;
}

function rejectLegacyArguments(args: readonly string[]): void {
  for (const name of ["--task", "--execution-plan"]) {
    if (args.includes(name)) throw new Error(`${name} je legacy vstup a v2 run jej odmítá. Použijte schválený --task-package; Analyst fallback neexistuje.`);
  }
}

/**
 * Starts the v2 core from an immutable Task Package.  This module must not
 * import Analyst, Reviewer, SDK worker, or any legacy execution-plan module.
 */
export async function runCommand(args: string[], options: RunCliOptions = {}): Promise<OrchestratorResult> {
  rejectLegacyArguments(args);
  const projectId = requireOption(args, "--project", "ID projektu");
  const taskPackageArg = requireOption(args, "--task-package", "adresář Task Package");
  const cwd = options.cwd ?? process.cwd();
  const loaded = await loadProjectConfig(`projects/${projectId}.yaml`, cwd);
  if (loaded.config.project.id !== projectId) throw new Error(`ID projektu v konfiguraci (${loaded.config.project.id}) neodpovídá parametru --project (${projectId}).`);

  const packageDir = path.resolve(cwd, taskPackageArg);
  const runId = options.runId ?? randomUUID();
  const preflight = options.preflight ?? runPreflight;
  const prepared: PreflightResult = await preflight({
    packageDir,
    repositoryPath: loaded.absoluteRepoPath,
    workspaceRoot: resolveWorkspaceRoot(loaded.config.execution.workspaceRoot),
    runId,
    git: async (gitArgs, gitCwd) => ({ stdout: await git(gitCwd, gitArgs), stderr: "" }),
    cli: createCodexCli(),
    catosRoot: cwd,
  });
  try {
    const result = await (options.orchestrator ?? orchestrate)({
      task: prepared.task,
      workspacePath: prepared.workspacePath,
      artifactDir: path.join(packageDir, "artifacts"),
      runId,
      executable: process.env.CATOS_CODEX_EXECUTABLE ?? "codex",
      maxReworks: loaded.config.workflow.maxReworkAttempts,
      taskPackageDir: packageDir,
      taskPackagePath: path.join(packageDir, "task.json"),
    });
    (options.log ?? console.log)(`v2 run ${runId}: ${result.status}`);
    return result;
  } finally {
    await prepared.release();
  }
}
