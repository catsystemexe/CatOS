import { analyzeTaskBrief, writeTaskBrief, type TaskAnalystProvider } from "../agents/taskAnalyst.js";
import { loadProjectConfig } from "../config/loadConfig.js";
import { createRun } from "../runs/createRun.js";
import { CodexSdkWorker, writeCodingArtifacts, type CodingWorker } from "../codingWorker.js";
import { ShellValidationRunner, buildValidationCommands, writeValidationReport, type ValidationRunner } from "../validationRunner.js";

type RunCliOptions = {
  cwd?: string;
  runsDir?: string;
  taskAnalystProvider?: TaskAnalystProvider;
  codingWorker?: CodingWorker;
  validationRunner?: ValidationRunner;
};

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

export async function runCommand(args: string[], options: RunCliOptions = {}): Promise<void> {
  const projectId = readOption(args, "--project");
  const goal = readOption(args, "--task");

  if (!projectId) {
    throw new Error("Chybí povinný parametr --project.");
  }

  if (!goal) {
    throw new Error("Chybí povinný parametr --task.");
  }

  const configPath = `projects/${projectId}.yaml`;
  const loaded = await loadProjectConfig(configPath, options.cwd);

  if (loaded.config.project.id !== projectId) {
    throw new Error(`ID projektu v konfiguraci (${loaded.config.project.id}) neodpovídá parametru --project (${projectId}).`);
  }

  const run = await createRun(projectId, goal, configPath, { runsDir: options.runsDir });
  const analysis = await analyzeTaskBrief(goal, projectId, { provider: options.taskAnalystProvider });
  const taskBriefPath = await writeTaskBrief(run.runDir, analysis.taskBrief);
  const codingWorker = options.codingWorker ?? new CodexSdkWorker();
  const codingResult = await codingWorker.executeTask({
    instruction: analysis.taskBrief.codexInstruction,
    repositoryPath: loaded.absoluteRepoPath,
    baseBranch: loaded.config.project.baseBranch,
    runId: run.runId,
    runDir: run.runDir,
    sandboxMode: loaded.config.codex.sandboxMode,
  });
  const codingArtifacts = await writeCodingArtifacts(run.runDir, analysis.taskBrief, codingResult);
  const validationRunner = options.validationRunner ?? new ShellValidationRunner();
  const validationReport = await validationRunner.run({
    workspacePath: codingResult.workspacePath,
    commands: buildValidationCommands(loaded.config.commands, loaded.config.validation),
  });
  const validationReportPath = await writeValidationReport(run.runDir, validationReport);

  console.log("CatOS run created");
  console.log(`Run ID: ${run.runId}`);
  console.log(`Project: ${loaded.config.project.id} (${loaded.config.project.name})`);
  console.log(`Repository: ${loaded.absoluteRepoPath}`);
  console.log(`Input: ${run.inputPath}`);
  console.log(`Task brief: ${taskBriefPath}`);
  console.log(`Workspace: ${codingResult.workspacePath}`);
  console.log(`Codex sandbox mode: ${codingResult.sandboxMode} (isolation: ${codingResult.sandboxIsolation})`);
  console.log(`Changed files: ${codingResult.changedFiles.length}`);
  if (codingResult.changedFiles.length === 0) {
    console.log("Codex Worker completed without file changes.");
  }
  console.log(`Diff: ${codingArtifacts.diffPath}`);
  console.log(`Codex thread ID: ${codingResult.threadId}`);
  console.log(`Task Analyst attempts: ${analysis.attempts}`);
  console.log(`Validation: ${validationReport.status}`);
  for (const result of validationReport.results) {
    const exit = result.exitCode === null ? "null" : String(result.exitCode);
    console.log(`- ${result.name}: ${result.status} (exit ${exit}, ${(result.durationMs / 1000).toFixed(1)}s)`);
  }
  console.log(`Report: ${validationReportPath}`);
}
