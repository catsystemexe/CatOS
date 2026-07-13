import path from "node:path";
import { writeContinuePackage } from "../continuePackage.js";

function readOption(args: string[], name: string): string | undefined { const i=args.indexOf(name); return i === -1 ? undefined : args[i+1]; }
export async function continuePackageCommand(args:string[], options:{runsDir?:string; cwd?:string}={}): Promise<void> {
  const runId=readOption(args,"--run"); if(!runId) throw new Error("Chybí povinný parametr --run.");
  const runsDir=options.runsDir ?? "runs"; const runDir=path.resolve(options.cwd ?? process.cwd(), runsDir, runId);
  const result=await writeContinuePackage(runDir, new Date(), { cwd: options.cwd });
  console.log("Continue package created");
  console.log(`Session: ${result.package.session.sessionId}`);
  console.log(`Step: ${result.package.activeStep.order} ${result.package.activeStep.stepId}`);
  console.log(`Previous attempts: ${result.package.previousAttempts.length}`);
  console.log(`Reason: ${result.package.execution.reason}`);
  console.log(`JSON: ${result.jsonPath}`);
  console.log(`Markdown: ${result.markdownPath}`);
  console.log(`Codex prompt: ${result.codexPromptPath}`);
  console.log(`Next step: npm run catos -- run-step --run ${runId} --prompt-file ${result.codexPromptPath}`);
}
