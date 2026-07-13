import { runCommand } from "./cli/run.js";
import { decideCommand } from "./cli/decide.js";
import { commitCommand } from "./cli/commit.js";
import { stepCommand } from "./cli/step.js";
import { reviewCommand } from "./cli/review.js";
import { continuePackageCommand } from "./cli/continuePackage.js";
import { runStepCommand } from "./cli/runStep.js";
import { uiCommand } from "./uiServer.js";

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command === "run") {
    await runCommand(args);
    return;
  }

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

  if (command === "ui") {
    await uiCommand(args);
    return;
  }

  throw new Error("Neznámý nebo chybějící příkaz. Použití: npm run catos -- run --project demo --task \"Testovací úkol\" nebo npm run catos -- decide --run <runId> --decision approve nebo npm run catos -- step --run <runId> --title \"Další krok\" --request \"Zadání\" nebo npm run catos -- commit --run <runId> nebo npm run catos -- review --run <runId> nebo npm run catos -- continue-package --run <runId> nebo npm run catos -- run-step --run <runId> nebo npm run ui");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Chyba: ${message}`);
  process.exitCode = 1;
});
