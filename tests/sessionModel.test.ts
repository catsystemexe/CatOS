import { mkdtemp, readFile, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { artifactRefs, completeAttempt, createSession, createStep, loadSession, loadStep, recordDecision, startAttempt } from "../src/runs/sessionModel.js";

describe("AutoCodex session model", () => {
  it("creates a session, first step, first and second attempts with append-only timeline and artifact refs", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "catos-session-"));
    const { session, step } = await createSession({ runDir, runId: "run-1", goal: "Goal", branch: "catos/run-1", workspacePath: "/tmp/ws" });
    expect(session.sessionId).toBe("run-1");
    expect(session.steps).toEqual([step.stepId]);
    expect(session.activeStepId).toBe(step.stepId);
    expect(step.order).toBe(1);

    const first = await startAttempt({ runDir, step, prompt: "Prompt 1", runtimeMode: "workspace-write" });
    await completeAttempt({ runDir, step, attempt: first, status: "failed", codexThreadId: "thread-1", resultStatus: "runtime-error", changedFiles: ["a.ts"], validationSummary: "FAIL", errorSummary: "boom", artifacts: artifactRefs(runDir, { validationReportPath: path.join(runDir, "validation-report.json"), runtimeManifestPath: "/tmp/ws/../runtime/runtime.json" }) });
    const reloaded = await loadStep(runDir, step.stepId);
    const second = await startAttempt({ runDir, step: reloaded, prompt: "Prompt 2", runtimeMode: "workspace-write" });
    await completeAttempt({ runDir, step: reloaded, attempt: second, status: "succeeded", codexThreadId: "thread-1", resultStatus: "completed", changedFiles: ["a.ts"], validationSummary: "PASS" });

    expect(first.attemptId).not.toBe(second.attemptId);
    const dirs = await readdir(path.join(runDir, "steps"));
    const attemptDirs = await readdir(path.join(runDir, "steps", dirs[0]!, "attempts"));
    expect(attemptDirs).toHaveLength(2);
    const failedAttempt = JSON.parse(await readFile(path.join(runDir, "steps", dirs[0]!, "attempts", attemptDirs[0]!, "attempt.json"), "utf8"));
    expect(failedAttempt.status).toBe("failed");
    expect(failedAttempt.artifacts.validationReportPath).toBe("validation-report.json");
    const timeline = (await readFile(path.join(runDir, "timeline.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(timeline.map((event) => event.event)).toContain("attempt.started");
    expect(timeline.map((event) => event.event)).toContain("attempt.completed");
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

  it("creates a second step after closing the first and updates ordering and activeStepId", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "catos-step-"));
    const { step: firstStep } = await createSession({ runDir, runId: "run-3", goal: "Goal", branch: "catos/run-3" });
    await recordDecision({ runDir, step: firstStep, type: "accept", reason: "done" });

    const { session, step: secondStep } = await createStep({ runDir, title: "Implement review package", request: "Create the review package generator" });

    expect(session.steps).toEqual([firstStep.stepId, secondStep.stepId]);
    expect(session.activeStepId).toBe(secondStep.stepId);
    expect(secondStep.order).toBe(2);
    expect(secondStep.status).toBe("open");
    await expect(readFile(path.join(runDir, "steps", `002-${secondStep.stepId}`, "request.md"), "utf8")).resolves.toBe("Create the review package generator\n");
  });

  it("rejects a new step while the current step is not closed unless superseded", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "catos-open-step-"));
    const { step } = await createSession({ runDir, runId: "run-4", goal: "Goal", branch: "catos/run-4" });
    const attempt = await startAttempt({ runDir, step, prompt: "Prompt" });
    await completeAttempt({ runDir, step, attempt, status: "succeeded" });

    await expect(createStep({ runDir, title: "Next", request: "Next request" })).rejects.toThrow(/Cannot create a new step/);
    const { step: secondStep } = await createStep({ runDir, title: "Next", request: "Next request", supersedeCurrent: true });
    const closedFirst = await loadStep(runDir, step.stepId);
    expect(closedFirst.status).toBe("superseded");
    expect((await loadSession(runDir)).activeStepId).toBe(secondStep.stepId);
  });

  it("routes rework attempts to active step, forbids accepted steps, and keeps attempt order per step", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "catos-route-"));
    const { step: firstStep } = await createSession({ runDir, runId: "run-5", goal: "Goal", branch: "catos/run-5" });
    const firstAttempt = await startAttempt({ runDir, step: firstStep, prompt: "Initial" });
    await completeAttempt({ runDir, step: firstStep, attempt: firstAttempt, status: "succeeded" });
    await recordDecision({ runDir, step: firstStep, type: "accept" });
    await expect(startAttempt({ runDir, step: { ...firstStep, status: "accepted" }, prompt: "Forbidden" })).rejects.toThrow(/accepted step/);

    const { step: secondStep } = await createStep({ runDir, title: "Second", request: "Second request" });
    const secondAttempt = await startAttempt({ runDir, step: secondStep, prompt: "Second initial" });
    await completeAttempt({ runDir, step: secondStep, attempt: secondAttempt, status: "failed" });
    const active = await loadStep(runDir);
    const reworkAttempt = await startAttempt({ runDir, step: active, prompt: "Rework active" });

    expect(secondAttempt.order).toBe(1);
    expect(reworkAttempt.order).toBe(2);
    expect(reworkAttempt.stepId).toBe(secondStep.stepId);
    const timeline = (await readFile(path.join(runDir, "timeline.jsonl"), "utf8")).trim().split("\n").map((line) => JSON.parse(line));
    expect(timeline.filter((event) => event.event === "step.created").map((event) => event.stepId)).toEqual([firstStep.stepId, secondStep.stepId]);
    expect(timeline.every((event) => event.event.startsWith("session.") || event.stepId)).toBe(true);
  });

  it("keeps summaries scoped to each step", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "catos-summary-"));
    const { step: firstStep } = await createSession({ runDir, runId: "run-6", goal: "Goal", branch: "catos/run-6" });
    const firstAttempt = await startAttempt({ runDir, step: firstStep, prompt: "Initial" });
    await completeAttempt({ runDir, step: firstStep, attempt: firstAttempt, status: "succeeded", changedFiles: ["first.ts"] });
    await recordDecision({ runDir, step: firstStep, type: "accept", reason: "first done" });
    const { step: secondStep } = await createStep({ runDir, title: "Second", request: "Second request" });
    const secondAttempt = await startAttempt({ runDir, step: secondStep, prompt: "Second" });
    await completeAttempt({ runDir, step: secondStep, attempt: secondAttempt, status: "succeeded", changedFiles: ["second.ts"] });
    await recordDecision({ runDir, step: await loadStep(runDir, secondStep.stepId), type: "accept", reason: "second done" });

    const firstSummary = await readFile(path.join(runDir, "steps", `001-${firstStep.stepId}`, "summary.md"), "utf8");
    const secondSummary = await readFile(path.join(runDir, "steps", `002-${secondStep.stepId}`, "summary.md"), "utf8");
    expect(firstSummary).toContain("first.ts");
    expect(firstSummary).not.toContain("second.ts");
    expect(secondSummary).toContain("second.ts");
    expect(secondSummary).not.toContain("first.ts");
  });
});
