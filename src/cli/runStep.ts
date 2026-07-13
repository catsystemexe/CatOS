import { readFile } from "node:fs/promises";
import path from "node:path";
import { writeContinuePackage } from "../continuePackage.js";
import { completeAttempt, loadStep, startAttempt } from "../runs/sessionModel.js";
function readOption(args: string[], name: string): string | undefined { const i=args.indexOf(name); return i === -1 ? undefined : args[i+1]; }
export async function runStepCommand(args:string[], options:{runsDir?:string; cwd?:string}={}): Promise<void> {
  const runId=readOption(args,"--run"); if(!runId) throw new Error("Chybí povinný parametr --run.");
  const runDir=path.resolve(options.cwd ?? process.cwd(), options.runsDir ?? "runs", runId);
  const generated=await writeContinuePackage(runDir, new Date(), { cwd: options.cwd });
  const promptPath=readOption(args,"--prompt-file") ?? generated.codexPromptPath;
  const prompt=await readFile(promptPath,"utf8");
  const step=await loadStep(runDir);
  const attempt=await startAttempt({ runDir, step, prompt: prompt.trimEnd(), runtimeMode: generated.package.execution.runtimeMode });
  if(args.includes("--fake-child")) {
    await completeAttempt({ runDir, step, attempt, status:"succeeded", resultStatus:"fake-child", changedFiles:[], validationSummary:"PASS", workspacePath: generated.package.session.workspacePath });
    console.log("Run step fake child completed");
    console.log(`Attempt: ${attempt.attemptId}`);
    console.log(`Prompt copy: ${path.join(runDir,"steps",`${String(step.order).padStart(3,"0")}-${step.stepId}`,"attempts",`${String(attempt.order).padStart(3,"0")}-${attempt.attemptId}`,"prompt.md")}`);
    return;
  }
  await completeAttempt({ runDir, step, attempt, status:"failed", resultStatus:"runtime-not-integrated", errorSummary:"Hardened Codex runtime integration for run-step is not configured in this CLI path yet.", changedFiles:[] });
  throw new Error("run-step created prompt-backed attempt, but direct Codex runtime execution is not configured; use --fake-child for smoke tests.");
}
