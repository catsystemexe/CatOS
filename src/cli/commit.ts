import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { loadProjectConfig } from "../config/loadConfig.js";
import { GitCommitWorker } from "../commitWorker.js";
import { formatZodError, loadFinalResult } from "../humanGate.js";
import { humanDecisionSchema } from "../schemas/humanDecision.js";
import { taskBriefSchema } from "../schemas/taskBrief.js";
import { taskInputSchema } from "../schemas/taskInput.js";
import { recordCommitEvent, recordDecision } from "../runs/sessionModel.js";
import { writePrHandoff } from "../gitSession.js";

type CommitCliOptions = { cwd?: string; runsDir?: string };
function collectOption(args: string[], name: string): string[] { const out:string[]=[]; for(let i=0;i<args.length;i++){ if(args[i]===name){ const v=args[i+1]; if(!v) throw new Error(`Chybí hodnota pro ${name}.`); out.push(v); i++; }} return out; }
function readOption(args: string[], name: string): string | undefined { return collectOption(args, name)[0]; }
async function readJson(filePath: string): Promise<unknown> { return JSON.parse(await readFile(filePath, "utf8")) as unknown; }
async function ensureRunDir(runDir: string): Promise<void> { const s = await stat(runDir).catch(() => undefined); if (!s?.isDirectory()) throw new Error(`Run not found: ${runDir}`); }

export async function commitCommand(args: string[], options: CommitCliOptions = {}): Promise<void> {
  const runId = readOption(args, "--run");
  if (!runId) throw new Error("Chybí povinný parametr --run.");
  const runsDir = options.runsDir ?? path.join(options.cwd ?? process.cwd(), "runs");
  const runDir = path.join(runsDir, runId);
  await ensureRunDir(runDir);
  try {
    const input = taskInputSchema.parse(await readJson(path.join(runDir, "input.json")));
    const taskBrief = taskBriefSchema.parse(await readJson(path.join(runDir, "task-brief.json")));
    const finalResult = await loadFinalResult(runDir);
    const humanDecision = humanDecisionSchema.parse(await readJson(path.join(runDir, "human-decision.json")));
    const loaded = await loadProjectConfig(input.configPath, options.cwd ?? process.cwd());
    const before = await readFile(path.join(runDir, "commit-result.json"), "utf8").then(() => true, () => false);
    const result = await new GitCommitWorker().commit({ runId, runDir, finalResult, humanDecision, taskBrief, config: loaded.config, message: readOption(args, "--message") });
    const handoff = await writePrHandoff(runDir);
    if (!before) {
      await recordDecision({ runDir, type: "commit", reason: `Commit ${result.commitSha} created`, actor: "system" }).catch(() => undefined);
      await recordCommitEvent(runDir, { commitSha: result.commitSha, branch: result.branch, message: result.commitMessage, changedFiles: result.changedFiles });
    }
    if (before) {
      console.log("Run already committed");
      console.log(`Commit: ${result.commitSha}`);
      console.log("No new commit was created");
      console.log(`PR handoff: ${handoff.markdownPath}`);
    } else {
      console.log("Commit created");
      console.log(`Run: ${runId}`);
      console.log(`Run branch: ${result.branch}`);
      console.log(`Commit: ${result.commitSha}`);
      console.log(`PR target: ${handoff.handoff.prTargetBranch}`);
      console.log(`Push status: ${handoff.handoff.pushStatus}`);
      console.log(`PR handoff: ${handoff.markdownPath}`);
      console.log(`Message: ${result.commitMessage}`);
      console.log(`Changed files: ${result.changedFiles.length}`);
      console.log(`Result: ${path.join(runDir, "commit-result.json")}`);
      console.log(`Next manual step: ${handoff.handoff.manualSteps[0] ?? "review handoff"}`);
    }
  } catch (error) {
    throw new Error(formatZodError(error));
  }
}
