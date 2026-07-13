import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { artifactRefs, completeAttempt, createSession, loadStep, recordDecision, startAttempt } from "../src/runs/sessionModel.js";

describe("AutoCodex session model", () => {
  it("creates a session, first step, first and second attempts with append-only timeline and artifact refs", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "catos-session-"));
    const { session, step } = await createSession({ runDir, runId: "run-1", goal: "Goal", branch: "catos/run-1", workspacePath: "/tmp/ws" });
    expect(session.sessionId).toBe("run-1");
    expect(session.steps).toEqual([step.stepId]);
    expect(step.order).toBe(1);

    const first = await startAttempt({ runDir, step, prompt: "Prompt 1", runtimeMode: "workspace-write" });
    await completeAttempt({ runDir, step, attempt: first, status: "failed", codexThreadId: "thread-1", resultStatus: "runtime-error", changedFiles: ["a.ts"], validationSummary: "FAIL", errorSummary: "boom", artifacts: artifactRefs(runDir, { validationReportPath: path.join(runDir, "validation-report.json"), runtimeManifestPath: "/tmp/ws/../runtime/runtime.json" }) });
    const reloaded = await loadStep(runDir, step.stepId);
    const second = await startAttempt({ runDir, step: reloaded, prompt: "Prompt 2", runtimeMode: "workspace-write" });
    await completeAttempt({ runDir, step: reloaded, attempt: second, status: "succeeded", codexThreadId: "thread-1", resultStatus: "completed", changedFiles: ["a.ts"], validationSummary: "PASS" });

    expect(first.attemptId).not.toBe(second.attemptId);
    expect(first.attemptId).toBe(first.attemptId);
    const dirs = await readdir(path.join(runDir, "steps"));
    const attemptDirs = await readdir(path.join(runDir, "steps", dirs[0]!, "attempts"));
    expect(attemptDirs).toHaveLength(2);
    const failedAttempt = JSON.parse(await readFile(path.join(runDir, "steps", dirs[0]!, "attempts", attemptDirs[0]!, "attempt.json"), "utf8"));
    expect(failedAttempt.status).toBe("failed");
    expect(failedAttempt.artifacts.validationReportPath).toBe("validation-report.json");
    const timeline = (await readFile(path.join(runDir, "timeline.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(timeline.map((event) => event.event)).toEqual(["session.created", "step.created", "attempt.started", "attempt.failed", "attempt.started", "attempt.completed"]);
  });

  it("records append-only accept and retry decisions without deleting previous history", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "catos-decision-"));
    const { step } = await createSession({ runDir, runId: "run-2", goal: "Goal", branch: "catos/run-2" });
    const retry = await recordDecision({ runDir, step, type: "retry", reason: "Try again" });
    const reloaded = await loadStep(runDir, step.stepId);
    const accept = await recordDecision({ runDir, step: reloaded, type: "accept", reason: "Approved" });
    expect(retry.decisionId).not.toBe(accept.decisionId);
    const dirs = await readdir(path.join(runDir, "steps"));
    const decisionDirs = await readdir(path.join(runDir, "steps", dirs[0]!, "decisions"));
    expect(decisionDirs).toHaveLength(2);
    const stepJson = JSON.parse(await readFile(path.join(runDir, "steps", dirs[0]!, "step.json"), "utf8"));
    expect(stepJson.decisionIds).toEqual([retry.decisionId, accept.decisionId]);
    expect(stepJson.status).toBe("accepted");
    await expect(readFile(path.join(runDir, "steps", dirs[0]!, "summary.md"), "utf8")).resolves.toContain("accept by human: Approved");
  });
});
