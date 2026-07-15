import { CodexSdkWorker } from "../codingWorker.js";
import type { TaskBrief } from "../schemas/taskBrief.js";
import { resolveWorkspaceRoot } from "../workspaceRoot.js";

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  return args[index + 1];
}

export async function runtimeWriteSmokeCommand(args: string[]): Promise<void> {
  const repositoryPath = readOption(args, "--repo") ?? readOption(args, "--repository");
  const baseBranch = readOption(args, "--base-branch") ?? "autocodex";
  const workspaceRoot = resolveWorkspaceRoot(readOption(args, "--workspace-root"));
  if (!repositoryPath) throw new Error("Missing --repo for runtime write smoke test.");
  const runId = `runtime-write-smoke-${new Date().toISOString().replace(/[^A-Za-z0-9._-]+/g, "-")}`;
  const worker = new CodexSdkWorker();
  const originalTask = [
    "Create file: AUTOCODEX_RUNTIME_WRITE_TEST.txt",
    "Exact content: runtime write succeeded",
    "No other changes.",
  ].join("\n");
  const taskBrief: TaskBrief = {
    objective: "Runtime write smoke test",
    acceptanceCriteria: ["AUTOCODEX_RUNTIME_WRITE_TEST.txt exists with exact content."],
    nonGoals: ["No other changes."],
    codexInstruction: originalTask,
    riskLevel: "trivial",
  };
  const result = await worker.executeTask({
    originalTask,
    taskBrief,
    repositoryPath,
    baseBranch,
    runId,
    workspaceRoot,
    sandboxMode: "danger-full-access",
  });
  const ok = result.changedFiles.length === 1 && result.changedFiles[0] === "AUTOCODEX_RUNTIME_WRITE_TEST.txt";
  console.log(JSON.stringify({ ok, runId, workspacePath: result.workspacePath, changedFiles: result.changedFiles, sandboxMode: result.sandboxMode }, null, 2));
  if (!ok) throw new Error("Runtime write smoke test did not create exactly AUTOCODEX_RUNTIME_WRITE_TEST.txt.");
}
