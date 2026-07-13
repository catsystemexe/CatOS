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

type CommitCliOptions = {
  cwd?: string;
  runsDir?: string;
};

function collectOption(args: string[], name: string): string[] {
  const out: string[] = [];

  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === name) {
      const value = args[i + 1];

      if (!value) {
        throw new Error(`Chybí hodnota pro ${name}.`);
      }

      out.push(value);
      i += 1;
    }
  }

  return out;
}

function readOption(args: string[], name: string): string | undefined {
  return collectOption(args, name)[0];
}

async function readJson(filePath: string): Promise<unknown> {
  return JSON.parse(await readFile(filePath, "utf8")) as unknown;
}

async function ensureRunDir(runDir: string): Promise<void> {
  const runStat = await stat(runDir).catch(() => undefined);

  if (!runStat?.isDirectory()) {
    throw new Error(`Run not found: ${runDir}`);
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  const fileStat = await stat(filePath).catch(() => undefined);
  return Boolean(fileStat?.isFile());
}

export async function commitCommand(
  args: string[],
  options: CommitCliOptions = {},
): Promise<void> {
  const runId = readOption(args, "--run");

  if (!runId) {
    throw new Error("Chybí povinný parametr --run.");
  }

  const runsDir =
    options.runsDir ?? path.join(options.cwd ?? process.cwd(), "runs");
  const runDir = path.join(runsDir, runId);

  await ensureRunDir(runDir);

  try {
    const input = taskInputSchema.parse(
      await readJson(path.join(runDir, "input.json")),
    );
    const taskBrief = taskBriefSchema.parse(
      await readJson(path.join(runDir, "task-brief.json")),
    );
    const finalResult = await loadFinalResult(runDir);
    const humanDecision = humanDecisionSchema.parse(
      await readJson(path.join(runDir, "human-decision.json")),
    );
    const loaded = await loadProjectConfig(
      input.configPath,
      options.cwd ?? process.cwd(),
    );

    const before = await fileExists(path.join(runDir, "commit-result.json"));

    const result = await new GitCommitWorker().commit({
      runId,
      runDir,
      finalResult,
      humanDecision,
      taskBrief,
      config: loaded.config,
      message: readOption(args, "--message"),
    });

    const hasSession = await fileExists(path.join(runDir, "session.json"));

    let handoff:
      | Awaited<ReturnType<typeof writePrHandoff>>
      | undefined;

    if (hasSession) {
      handoff = await writePrHandoff(runDir);
    }

    if (!before && hasSession) {
      await recordDecision({
        runDir,
        type: "commit",
        reason: `Commit ${result.commitSha} created`,
        actor: "system",
      }).catch(() => undefined);

      await recordCommitEvent(runDir, {
        commitSha: result.commitSha,
        branch: result.branch,
        message: result.commitMessage,
        changedFiles: result.changedFiles,
      });
    }

    if (before) {
      console.log("Run already committed");
      console.log(`Commit: ${result.commitSha}`);
      console.log("No new commit was created");

      if (handoff) {
        console.log(`PR handoff: ${handoff.markdownPath}`);
      } else {
        console.log(
          "PR handoff: unavailable for legacy run without session.json",
        );
      }

      return;
    }

    console.log("Commit created");
    console.log(`Run: ${runId}`);
    console.log(`Run branch: ${result.branch}`);
    console.log(`Commit: ${result.commitSha}`);

    if (handoff) {
      console.log(`PR target: ${handoff.handoff.prTargetBranch}`);
      console.log(`Push status: ${handoff.handoff.pushStatus}`);
      console.log(`PR handoff: ${handoff.markdownPath}`);
    } else {
      console.log(
        "PR handoff: unavailable for legacy run without session.json",
      );
    }

    console.log(`Message: ${result.commitMessage}`);
    console.log(`Changed files: ${result.changedFiles.length}`);
    console.log(`Result: ${path.join(runDir, "commit-result.json")}`);

    if (handoff) {
      console.log(
        `Next manual step: ${
          handoff.handoff.manualSteps[0] ?? "review handoff"
        }`,
      );
    }
  } catch (error) {
    throw new Error(formatZodError(error));
  }
}
