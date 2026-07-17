import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { RUN_ARTIFACT_PATHS, runArtifactPath, stepArtifactPaths } from "../src/autocodex/artifactPaths.js";
import { createArtifactManifest } from "../src/autocodex/artifactManifest.js";
import { finalizeRun } from "../src/autocodex/finalize.js";

const sha = (letter: string) => letter.repeat(40);
const terminal = async (status: "COMPLETED" | "BLOCKED" | "FAILED" | "CANCELLED") => {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "catos-finalize-"));
  return { runDir, result: await finalizeRun({ runDir, runId: "run-1", status, codingResults: [{ status: "COMPLETED", summary: "done", changes: [], checksRunByAgent: [], remainingConcerns: ["follow up"] }], reviewResults: [{ decision: "APPROVE", summary: "approved", requiredChanges: [], nonBlockingNotes: [] }], finalDiff: { baseCommit: sha("a"), headCommit: sha("b"), patch: "diff --git a/a b/a\n" } }) };
};
describe("AutoCodex finalization", () => {
  it.each(["COMPLETED", "BLOCKED", "FAILED", "CANCELLED"] as const)("finalizes %s without dropping audit artifacts", async (status) => { const { runDir, result } = await terminal(status); expect(result.status).toBe(status); for (const artifact of ["runtime", "runSummary", "reviewPacket", "finalDiff", "testSummary", "openIssues", "artifactManifest"] as const) await expect(readFile(runArtifactPath(runDir, artifact), "utf8")).resolves.toBeTruthy(); });
  it("creates a stable sorted manifest and excludes its own entry", async () => { const { runDir } = await terminal("COMPLETED"); const one = await createArtifactManifest(runDir); await writeFile(path.join(runDir, "z.txt"), "z"); await writeFile(path.join(runDir, "a.txt"), "a"); const two = await createArtifactManifest(runDir); expect(two.files.map((file) => file.path)).toEqual([...two.files.map((file) => file.path)].sort()); expect(two.files.some((file) => file.path === RUN_ARTIFACT_PATHS.artifactManifest)).toBe(false); await writeFile(path.join(runDir, "z.txt"), "z"); expect(await createArtifactManifest(runDir)).toEqual(two); expect(one.files).not.toEqual(two.files); });
  it("never serializes credential values in runtime.json", async () => { const runDir = await mkdtemp(path.join(os.tmpdir(), "catos-finalize-")); await finalizeRun({ runDir, runId: "run-2", status: "FAILED", runtime: { authenticationType: "api-key", environment: { allowedNames: ["PATH", "OPENAI_API_KEY"], deniedNames: ["OPENAI_API_KEY"] }, ...( { OPENAI_API_KEY: "credential-value-must-not-appear" } as object) } }); const runtime = await readFile(runArtifactPath(runDir, "runtime"), "utf8"); expect(runtime).not.toContain("credential-value-must-not-appear"); expect(runtime).not.toContain('"OPENAI_API_KEY":"'); expect(runtime).toContain("OPENAI_API_KEY"); });
  it("requires immutable final diff boundaries", async () => { const runDir = await mkdtemp(path.join(os.tmpdir(), "catos-finalize-")); await expect(finalizeRun({ runDir, runId: "run-3", status: "COMPLETED", finalDiff: { baseCommit: "not-a-sha", headCommit: sha("b"), patch: "" } })).rejects.toThrow(/boundaries/); });
  it("exposes only fixed run and attempt artifact locations", () => { expect(runArtifactPath("/tmp/run", "finalDiff")).toBe(path.join("/tmp/run", "final", "final-diff.patch")); const attempt = stepArtifactPaths("STEP_001", "ATTEMPT_001"); expect(attempt.codingPrompt).toBe("steps/STEP_001/attempts/ATTEMPT_001/coding-prompt.md"); expect(attempt.reviewEvents).toBe("steps/STEP_001/attempts/ATTEMPT_001/review-events.jsonl"); expect(attempt.tests).toBe("steps/STEP_001/attempts/ATTEMPT_001/tests/test-results.json"); });
});
