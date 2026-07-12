import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { decideCommand } from "../src/cli/decide.js";
import { FileHumanGate } from "../src/humanGate.js";
import type { FinalResult } from "../src/schemas/finalResult.js";

const evidence = { taskBrief: true, finalDiff: true, validationReport: true, reviewReport: true };

async function fixture(status: FinalResult["status"] = "ACCEPTED") {
  const root = await mkdtemp(path.join(os.tmpdir(), "catos-human-gate-"));
  const runsDir = path.join(root, "runs");
  const runId = "run-1";
  const runDir = path.join(runsDir, runId);
  await mkdir(runDir, { recursive: true });
  await writeFile(path.join(runDir, "task-brief.json"), JSON.stringify({ objective: "Ship Human Gate.", acceptanceCriteria: ["Gate records decisions."], nonGoals: [], codexInstruction: "Implement gate.", riskLevel: "standard" }), "utf8");
  await writeFile(path.join(runDir, "workspace.diff"), "diff --git a/file b/file\n", "utf8");
  await writeFile(path.join(runDir, "validation-report.json"), JSON.stringify({ schemaVersion: 1, status: "PASS", workspacePath: "/tmp/workspace", startedAt: new Date(0).toISOString(), finishedAt: new Date(1).toISOString(), results: [] }), "utf8");
  await writeFile(path.join(runDir, "review-report.json"), JSON.stringify({ schemaVersion: 1, verdict: status === "ACCEPTED" ? "ACCEPT" : status === "HUMAN_REQUIRED" ? "HUMAN_REQUIRED" : "REWORK", summary: "summary", reviewedAcceptanceCriteria: [], blockingFindings: [], warnings: [] }), "utf8");
  const finalResult: FinalResult = { schemaVersion: 1, runId, status, finalReviewVerdict: status === "ACCEPTED" ? "ACCEPT" : status === "HUMAN_REQUIRED" ? "HUMAN_REQUIRED" : "REWORK", totalCodingAttempts: 1, reworkAttempts: 0, finalWorkspacePath: "/tmp/workspace", finalChangedFiles: ["file"], finalValidationStatus: "PASS", finalReviewReportPath: path.join(runDir, "review-report.json"), finalDiffPath: path.join(runDir, "workspace.diff"), finalValidationReportPath: path.join(runDir, "validation-report.json") };
  await writeFile(path.join(runDir, "final-result.json"), JSON.stringify(finalResult), "utf8");
  return { root, runsDir, runId, runDir, finalResult };
}

describe("Human Gate", () => {
  it("allows APPROVE for ACCEPTED with complete evidence", async () => {
    const f = await fixture("ACCEPTED");
    const decision = await new FileHumanGate().recordDecision({ runId: f.runId, runDir: f.runDir, finalResult: f.finalResult }, { decision: "APPROVE", evidenceReviewed: evidence });
    expect(decision.decision).toBe("APPROVE");
  });

  it("rejects APPROVE when evidence confirmation is incomplete", async () => {
    const f = await fixture("ACCEPTED");
    await expect(new FileHumanGate().recordDecision({ runId: f.runId, runDir: f.runDir, finalResult: f.finalResult }, { decision: "APPROVE", evidenceReviewed: { ...evidence, finalDiff: false } })).rejects.toThrow(/evidence/);
  });

  it("rejects APPROVE for HUMAN_REQUIRED", async () => {
    const f = await fixture("HUMAN_REQUIRED");
    await expect(new FileHumanGate().recordDecision({ runId: f.runId, runDir: f.runDir, finalResult: f.finalResult }, { decision: "APPROVE", evidenceReviewed: evidence })).rejects.toThrow(/ACCEPTED/);
  });

  it("rejects APPROVE for REWORK_LIMIT_REACHED", async () => {
    const f = await fixture("REWORK_LIMIT_REACHED");
    await expect(new FileHumanGate().recordDecision({ runId: f.runId, runDir: f.runDir, finalResult: f.finalResult }, { decision: "APPROVE", evidenceReviewed: evidence })).rejects.toThrow(/ACCEPTED/);
  });

  it("allows REJECT", async () => {
    const f = await fixture("HUMAN_REQUIRED");
    const decision = await new FileHumanGate().recordDecision({ runId: f.runId, runDir: f.runDir, finalResult: f.finalResult }, { decision: "REJECT", comment: "No", evidenceReviewed: { ...evidence, finalDiff: false } });
    expect(decision.decision).toBe("REJECT");
  });

  it("allows REQUEST_CHANGES with requested changes", async () => {
    const f = await fixture("HUMAN_REQUIRED");
    const decision = await new FileHumanGate().recordDecision({ runId: f.runId, runDir: f.runDir, finalResult: f.finalResult }, { decision: "REQUEST_CHANGES", requestedChanges: ["Keep API."], evidenceReviewed: { ...evidence, validationReport: false } });
    expect(decision.requestedChanges).toEqual(["Keep API."]);
  });

  it("rejects REQUEST_CHANGES without requested changes", async () => {
    const f = await fixture("ACCEPTED");
    await expect(new FileHumanGate().recordDecision({ runId: f.runId, runDir: f.runDir, finalResult: f.finalResult }, { decision: "REQUEST_CHANGES", evidenceReviewed: evidence })).rejects.toThrow(/REQUEST_CHANGES/);
  });

  it("writes human-decision.json and rejects a second decision", async () => {
    const f = await fixture("ACCEPTED");
    const gate = new FileHumanGate();
    await gate.recordDecision({ runId: f.runId, runDir: f.runDir, finalResult: f.finalResult }, { decision: "APPROVE", evidenceReviewed: evidence });
    await expect(readFile(path.join(f.runDir, "human-decision.json"), "utf8")).resolves.toContain("APPROVE");
    await expect(gate.recordDecision({ runId: f.runId, runDir: f.runDir, finalResult: f.finalResult }, { decision: "REJECT", evidenceReviewed: evidence })).rejects.toThrow(/already exists/);
  });

  it("rejects a missing run", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "catos-human-missing-"));
    await expect(decideCommand(["--run", "missing", "--decision", "reject"], { runsDir: path.join(root, "runs") })).rejects.toThrow(/Run not found/);
  });

  it("rejects a run without final-result.json", async () => {
    const root = await mkdtemp(path.join(os.tmpdir(), "catos-human-no-final-"));
    await mkdir(path.join(root, "runs", "run-1"), { recursive: true });
    await expect(decideCommand(["--run", "run-1", "--decision", "reject"], { runsDir: path.join(root, "runs") })).rejects.toThrow(/final-result/);
  });

  it("rejects an invalid final-result.json", async () => {
    const f = await fixture("ACCEPTED");
    await writeFile(path.join(f.runDir, "final-result.json"), JSON.stringify({ schemaVersion: 1 }), "utf8");
    await expect(decideCommand(["--run", f.runId, "--decision", "reject"], { runsDir: f.runsDir })).rejects.toThrow(/Invalid/);
  });

  it("parses repeated --change", async () => {
    const f = await fixture("ACCEPTED");
    await decideCommand(["--run", f.runId, "--decision", "request-changes", "--change", "One", "--change", "Two"], { runsDir: f.runsDir });
    const decision = JSON.parse(await readFile(path.join(f.runDir, "human-decision.json"), "utf8"));
    expect(decision.requestedChanges).toEqual(["One", "Two"]);
  });

  it("parses repeated --reviewed", async () => {
    const f = await fixture("ACCEPTED");
    await decideCommand(["--run", f.runId, "--decision", "approve", "--reviewed", "task-brief", "--reviewed", "diff", "--reviewed", "validation", "--reviewed", "review"], { runsDir: f.runsDir });
    const decision = JSON.parse(await readFile(path.join(f.runDir, "human-decision.json"), "utf8"));
    expect(decision.evidenceReviewed).toEqual(evidence);
  });

  it("does not change worktree contents", async () => {
    const f = await fixture("ACCEPTED");
    const workspace = path.join(f.root, "workspace");
    await mkdir(workspace);
    const file = path.join(workspace, "file.txt");
    await writeFile(file, "before", "utf8");
    f.finalResult.finalWorkspacePath = workspace;
    await writeFile(path.join(f.runDir, "final-result.json"), JSON.stringify(f.finalResult), "utf8");
    await decideCommand(["--run", f.runId, "--decision", "reject"], { runsDir: f.runsDir });
    await expect(readFile(file, "utf8")).resolves.toBe("before");
  });
});
