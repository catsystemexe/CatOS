import { mkdir } from "node:fs/promises";
import { runArtifactPath } from "./artifactPaths.js";
import { writeArtifactManifest, type ArtifactManifest } from "./artifactManifest.js";
import { atomicWriteJson, atomicWriteText } from "./persistence.js";
import { createRuntimeManifest, type RuntimeManifest, type RuntimeManifestInput } from "./runtimeManifest.js";
import { collectOpenIssues, renderOpenIssues, renderReviewPacket, renderRunSummary, type FinalArtifactData, type FinalRunStatus } from "./renderArtifacts.js";

export type FinalizeRunInput = FinalArtifactData & Readonly<{ runDir: string; runtime?: RuntimeManifestInput }>;
export type FinalizeRunResult = Readonly<{ status: FinalRunStatus; runtime: RuntimeManifest; manifest: ArtifactManifest; openIssueCount: number }>;
const SHA = /^[a-f0-9]{40}$/i;
function assertFinalDiffBoundary(diff: FinalArtifactData["finalDiff"]): void { if (!diff) return; if (!SHA.test(diff.baseCommit) || !SHA.test(diff.headCommit) || diff.baseCommit === diff.headCommit) throw new Error("Final diff requires distinct immutable base and head commit boundaries."); }
/**
 * Terminal-only writer. It is intentionally valid for every terminal outcome:
 * failures and cancellations retain all structured evidence gathered so far.
 */
export async function finalizeRun(input: FinalizeRunInput): Promise<FinalizeRunResult> {
  assertFinalDiffBoundary(input.finalDiff); await Promise.all([mkdir(input.runDir, { recursive: true }), mkdir(runArtifactPath(input.runDir, "final"), { recursive: true })]);
  const runtime = createRuntimeManifest(input.runtime ?? {});
  await atomicWriteJson(runArtifactPath(input.runDir, "runtime"), runtime);
  await Promise.all([atomicWriteText(runArtifactPath(input.runDir, "runSummary"), renderRunSummary(input)), atomicWriteText(runArtifactPath(input.runDir, "reviewPacket"), renderReviewPacket(input)), atomicWriteText(runArtifactPath(input.runDir, "openIssues"), renderOpenIssues(input)), atomicWriteJson(runArtifactPath(input.runDir, "testSummary"), { schemaVersion: 1, reports: input.testReports ?? [] })]);
  if (input.finalDiff) await atomicWriteText(runArtifactPath(input.runDir, "finalDiff"), input.finalDiff.patch);
  const manifest = await writeArtifactManifest(input.runDir);
  return Object.freeze({ status: input.status, runtime, manifest, openIssueCount: collectOpenIssues(input).length });
}
export const finalizeTerminalRun = finalizeRun;
