import { stat } from "node:fs/promises";
import path from "node:path";
import { createStep } from "../runs/sessionModel.js";

type StepCliOptions = { cwd?: string; runsDir?: string };

function readOption(args: string[], name: string): string | undefined {
  const index = args.indexOf(name);
  if (index === -1) return undefined;
  const value = args[index + 1];
  if (!value) throw new Error(`Chybí hodnota pro ${name}.`);
  return value;
}

async function ensureRunDir(runDir: string): Promise<void> {
  try {
    const dir = await stat(runDir);
    if (!dir.isDirectory()) throw new Error(`Run path is not a directory: ${runDir}`);
  } catch {
    throw new Error(`Run not found: ${runDir}`);
  }
}

export async function stepCommand(args: string[], options: StepCliOptions = {}): Promise<void> {
  const runId = readOption(args, "--run");
  if (!runId) throw new Error("Chybí povinný parametr --run.");
  const title = readOption(args, "--title");
  if (!title) throw new Error("Chybí povinný parametr --title.");
  const request = readOption(args, "--request");
  if (!request) throw new Error("Chybí povinný parametr --request.");
  const runsDir = options.runsDir ?? path.join(options.cwd ?? process.cwd(), "runs");
  const runDir = path.join(runsDir, runId);
  await ensureRunDir(runDir);

  const { session, step } = await createStep({ runDir, title, request, supersedeCurrent: args.includes("--supersede-current") });

  console.log("Step created");
  console.log(`Session: ${session.sessionId}`);
  console.log(`Step: ${step.stepId}`);
  console.log(`Order: ${step.order}`);
  console.log(`Status: ${step.status}`);
  console.log(`Request: ${step.request}`);
  console.log("Next step: run/continue Codex for this step");
}
