import { runCommand } from "./cli/run.js";
import { decideCommand } from "./cli/decide.js";
import { commitCommand } from "./cli/commit.js";

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

  throw new Error("Neznámý nebo chybějící příkaz. Použití: npm run catos -- run --project demo --task \"Testovací úkol\" nebo npm run catos -- decide --run <runId> --decision approve nebo npm run catos -- commit --run <runId>");
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Chyba: ${message}`);
  process.exitCode = 1;
});
