import { runCommand } from "./cli/run.js";

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2);

  if (command !== "run") {
    throw new Error("Neznámý nebo chybějící příkaz. Použití: npm run catos -- run --project demo --task \"Testovací úkol\"");
  }

  await runCommand(args);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(`Chyba: ${message}`);
  process.exitCode = 1;
});
