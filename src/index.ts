import { runCommand } from "./cli/run.js";
import { decideCommand } from "./cli/decide.js";
import { commitCommand } from "./cli/commit.js";
import { stepCommand } from "./cli/step.js";
import { reviewCommand } from "./cli/review.js";
import { continuePackageCommand } from "./cli/continuePackage.js";
import { runStepCommand } from "./cli/runStep.js";
import { uiCommand } from "./uiServer.js";
import { runtimeWriteSmokeCommand } from "./cli/runtimeWriteSmoke.js";
import { pathToFileURL } from "node:url";

/** Retained only for legacy artifact workflows; never reachable from v2 `run`. */
export const legacyCommands = Object.freeze(["decide", "commit", "run-step", "continue-package", "review", "step"]);

export async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === "run") {
    await runCommand(args);
    return;
  }

  // Legacy commands remain available only for existing audit artifacts; they
  // are not invoked by the v2 production run path.
  if (command === "decide") {
    await decideCommand(args);
    return;
  }

  if (command === "commit") {
    await commitCommand(args);
    return;
  }

  if (command === "step") {
    await stepCommand(args);
    return;
  }

  if (command === "review") {
    await reviewCommand(args);
    return;
  }

  if (command === "continue-package" || command === "continue") {
    await continuePackageCommand(args);
    return;
  }

  if (command === "run-step") {
    await runStepCommand(args);
    return;
  }

  if (command === "runtime-write-smoke") {
    await runtimeWriteSmokeCommand(args);
    return;
  }

  if (command === "ui") {
    await uiCommand(args);
    return;
  }

  throw new Error("Neznámý nebo chybějící příkaz. V2: npm run catos -- run --project demo --task-package <directory>. Legacy: decide, commit, run-step, continue-package a review; příkaz step je také legacy. UI nepouští v2 run.");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(`Chyba: ${message}`);
    process.exitCode = 1;
  });
}
