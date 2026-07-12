import { loadProjectConfig } from "../config/loadConfig.js";
import { createRun } from "../runs/createRun.js";

type RunCliOptions = {
  cwd?: string;
  runsDir?: string;
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

  console.log("CatOS run created");
  console.log(`Run ID: ${run.runId}`);
  console.log(`Project: ${loaded.config.project.id} (${loaded.config.project.name})`);
  console.log(`Repository: ${loaded.absoluteRepoPath}`);
  console.log(`Input: ${run.inputPath}`);
}
