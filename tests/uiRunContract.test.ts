import { expect, test } from "vitest";
import { mkdtemp, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildUiSystemState, buildUiTimeline } from "../src/uiViewModel.js";

async function fixture(){ const root=await mkdtemp(path.join(os.tmpdir(),"catos-ui-contract-")); const runDir=path.join(root,"runs","run-1"); const ws=path.join(root,"ws"); await mkdir(path.join(ws,"docs"),{recursive:true}); await mkdir(path.join(runDir,"steps","001-step","attempts","001-attempt"),{recursive:true}); return {root,runDir,ws,attemptDir:path.join(runDir,"steps","001-step","attempts","001-attempt")}; }

async function writeBase(f:Awaited<ReturnType<typeof fixture>>, verdict="ACCEPT", validation="PASS"){
  await writeFile(path.join(f.ws,"docs","AUTOCODEX_TEST.md"),"hello\n");
  await writeFile(path.join(f.runDir,"session.json"),JSON.stringify({sessionId:"run-1",goal:"create docs/AUTOCODEX_TEST.md",status:"running",branch:"autocodex",workspacePath:f.ws,createdAt:"2026-07-14T00:00:00.000Z",updatedAt:"2026-07-14T00:00:01.000Z",activeStepId:"step"}));
  await writeFile(path.join(f.attemptDir,"attempt.json"),JSON.stringify({attemptId:"attempt",stepId:"step",order:1,status:"succeeded",prompt:"p",startedAt:"2026-07-14T00:00:00.000Z",completedAt:"2026-07-14T00:00:01.234Z",changedFiles:["docs/AUTOCODEX_TEST.md"],artifacts:{validationReportPath:path.join(f.attemptDir,"validation-report.json"),reviewReportPath:path.join(f.attemptDir,"review-report.json")}}));
  await writeFile(path.join(f.attemptDir,"validation-report.json"),JSON.stringify({status:validation,results:[]}));
  await writeFile(path.join(f.attemptDir,"review-report.json"),JSON.stringify({verdict,summary: verdict==="REWORK"?"Validation failed: docs/AUTOCODEX_TEST.md was not found.":"accepted",blockingFindings: verdict==="REWORK"?[{title:"missing",requiredChange:"create file"}]:[]}));
}

test("discovers user-created docs/AUTOCODEX_TEST.md and does not substitute internal report", async()=>{ const f=await fixture(); await writeBase(f); await writeFile(path.join(f.runDir,"final-result.json"),JSON.stringify({schemaVersion:1,runId:"run-1",status:"ACCEPTED",finalReviewVerdict:"ACCEPT",totalCodingAttempts:1,reworkAttempts:0,finalWorkspacePath:f.ws,finalChangedFiles:["docs/AUTOCODEX_TEST.md"],finalValidationStatus:"PASS",finalReviewReportPath:path.join(f.attemptDir,"review-report.json")})); const s=await buildUiSystemState(f.runDir); expect(s.changedFiles[0]).toMatchObject({path:"docs/AUTOCODEX_TEST.md",exists:true}); expect(s.outputs.map(o=>o.path)).toEqual(["docs/AUTOCODEX_TEST.md"]); expect(s.outputs.map(o=>o.path)).not.toContain("AUTOCODEX_SESSION_REPORT.md"); expect(s.terminalMessage).toBe("TASK COMPLETE"); });

test("missing optional internal report does not fail and failed validation has structured error and rework reason", async()=>{ const f=await fixture(); await writeBase(f,"REWORK","FAIL"); await writeFile(path.join(f.runDir,"final-result.json"),JSON.stringify({schemaVersion:1,runId:"run-1",status:"REWORK_LIMIT_REACHED",finalReviewVerdict:"REWORK",totalCodingAttempts:1,reworkAttempts:0,finalWorkspacePath:f.ws,finalChangedFiles:["docs/AUTOCODEX_TEST.md"],finalValidationStatus:"FAIL",finalReviewReportPath:path.join(f.attemptDir,"review-report.json")})); const s=await buildUiSystemState(f.runDir); expect(s.error).toMatchObject({code:"attempt_exhaustion"}); expect(s.error?.stepId).toContain("review"); const rows=await buildUiTimeline(f.runDir); expect(rows.map(r=>r.label)).toEqual(["Run Codex task","Run validation","Review changes"]); expect(rows.some(r=>r.label==="step")).toBe(false); expect(rows.find(r=>r.status==="rework")?.message).toContain("docs/AUTOCODEX_TEST.md"); });
