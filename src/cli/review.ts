import { stat } from "node:fs/promises";
import path from "node:path";
import { writeReviewPackage } from "../reviewPackage.js";
function readOption(args: string[], name: string): string | undefined { const i = args.indexOf(name); if (i === -1) return undefined; const v = args[i + 1]; if (!v) throw new Error(`Chybí hodnota pro ${name}.`); return v; }
async function ensureRunDir(runDir: string): Promise<void> { const s = await stat(runDir).catch(() => undefined); if (!s?.isDirectory()) throw new Error(`Run not found: ${runDir}`); }
export async function reviewCommand(args: string[], options: { cwd?: string; runsDir?: string; now?: Date } = {}): Promise<void> {
  const runId = readOption(args, "--run"); if (!runId) throw new Error("Chybí povinný parametr --run.");
  const runsDir = options.runsDir ?? path.join(options.cwd ?? process.cwd(), "runs"); const runDir = path.join(runsDir, runId); await ensureRunDir(runDir);
  const result = await writeReviewPackage(runDir, options.now);
  const pkg = result.package;
  console.log("Review package created");
  console.log(`Session: ${pkg.session.sessionId}`);
  console.log(`Status: ${pkg.session.status}`);
  console.log(`Steps: ${pkg.summary.totalSteps}`);
  console.log(`Attempts: ${pkg.summary.totalAttempts}`);
  console.log(`Current step: ${pkg.session.activeStepId ?? "none"}`);
  console.log(`Recommended next action: ${pkg.recommendedNextAction}`);
  console.log(`Markdown: ${result.markdownPath}`);
  console.log(`JSON: ${result.jsonPath}`);
}
