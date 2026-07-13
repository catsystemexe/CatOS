import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { reviewCommand } from "../src/cli/review.js";
import { buildReviewPackage, renderReviewPackageMarkdown, writeReviewPackage } from "../src/reviewPackage.js";
import { completeAttempt, createSession, createStep, loadStep, recordCommitEvent, recordDecision, startAttempt } from "../src/runs/sessionModel.js";

async function oneAttemptRun() {
  const runDir = await mkdtemp(path.join(os.tmpdir(), "catos-review-"));
  const { step } = await createSession({ runDir, runId: "run-review", goal: "Goal with normal key token secret words", branch: "catos/run-review", now: new Date("2026-01-01T00:00:00.000Z") });
  await writeFile(path.join(runDir, "validation-report.json"), JSON.stringify({ schemaVersion: 1, status: "PASS" }), "utf8");
  await writeFile(path.join(runDir, "review-report.json"), JSON.stringify({ schemaVersion: 1, verdict: "ACCEPT" }), "utf8");
  await mkdir(path.join(runDir, "runtime"));
  await writeFile(path.join(runDir, "runtime", "runtime.json"), JSON.stringify({ sandboxMode: "workspace-write", allowedEnvNames: ["PATH"], SECRET_TOKEN: "known-test-secret-value-123" }), "utf8");
  const attempt = await startAttempt({ runDir, step, prompt: "Prompt with normal key token secret words and known-test-secret-value-123 and sk-proj-abcdefghijklmnopqrstuvwxyz123456", runtimeMode: "workspace-write", now: new Date("2026-01-01T00:01:00.000Z") });
  await completeAttempt({ runDir, step, attempt, status: "succeeded", codexThreadId: "thread-1", changedFiles: ["b.ts", "a.ts", "a.ts"], validationSummary: "PASS", artifacts: { validationReportPath: "validation-report.json", reviewReportPath: "review-report.json", runtimeManifestPath: "runtime/runtime.json", diffPath: "workspace.diff" }, now: new Date("2026-01-01T00:02:00.000Z") });
  return { runDir, step };
}

describe("Review Package", () => {
  it("creates a deterministic package for one step and one attempt without leaking secrets", async () => {
    const { runDir } = await oneAttemptRun();
    const result = await writeReviewPackage(runDir, new Date("2026-01-02T00:00:00.000Z"));
    const json = await readFile(result.jsonPath, "utf8");
    const md = await readFile(result.markdownPath, "utf8");
    expect(json).toContain('"recommendedNextAction": "decide"');
    expect(json).toContain("Goal with normal key token secret words");
    expect(json).toContain("normal key token secret words");
    expect(json).not.toContain("known-test-secret-value-123");
    expect(json).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz123456");
    expect(md).toContain("Goal with normal key token secret words");
    expect(md).not.toContain("known-test-secret-value-123");
    expect(md).not.toContain("sk-proj-abcdefghijklmnopqrstuvwxyz123456");
    expect(result.package.steps[0]!.attempts[0]!.changedFiles).toEqual(["a.ts", "b.ts"]);
    expect(result.package.changedFiles).toEqual(["a.ts", "b.ts"]);
    expect(result.package.missingArtifacts).toContain("workspace.diff");
  });

  it("preserves step and attempt order, failed retry, and decision history", async () => {
    const { runDir, step } = await oneAttemptRun();
    await recordDecision({ runDir, step: await loadStep(runDir, step.stepId), type: "retry", reason: "again", now: new Date("2026-01-01T00:03:00.000Z") });
    const s1 = await loadStep(runDir, step.stepId);
    const second = await startAttempt({ runDir, step: s1, prompt: "Retry", now: new Date("2026-01-01T00:04:00.000Z") });
    await completeAttempt({ runDir, step: s1, attempt: second, status: "failed", errorSummary: "boom", changedFiles: ["c.ts", "b.ts", "c.ts"], now: new Date("2026-01-01T00:05:00.000Z") });
    await recordDecision({ runDir, step: await loadStep(runDir, step.stepId), type: "accept", now: new Date("2026-01-01T00:06:00.000Z") });
    const { step: step2 } = await createStep({ runDir, title: "Second", request: "Second request", now: new Date("2026-01-01T00:07:00.000Z") });
    const pkg = await buildReviewPackage(runDir, new Date("2026-01-02T00:00:00.000Z"));
    expect(pkg.steps.map((s) => s.stepId)).toEqual([step.stepId, step2.stepId]);
    expect(pkg.steps[0]!.attempts.map((a) => a.order)).toEqual([1, 2]);
    expect(pkg.steps[0]!.attempts[1]!.changedFiles).toEqual(["b.ts", "c.ts"]);
    expect(pkg.changedFiles).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(pkg.decisions.map((d) => d.type)).toEqual(["retry", "accept"]);
    expect(pkg.recommendedNextAction).toBe("run-step");
  });

  it("computes recommended next actions for key states", async () => {
    const runDir = await mkdtemp(path.join(os.tmpdir(), "catos-review-actions-"));
    const { step } = await createSession({ runDir, runId: "actions", goal: "Goal", branch: "catos/actions" });
    expect((await buildReviewPackage(runDir)).recommendedNextAction).toBe("run-step");
    const a = await startAttempt({ runDir, step, prompt: "Prompt" });
    await completeAttempt({ runDir, step, attempt: a, status: "succeeded" });
    expect((await buildReviewPackage(runDir)).recommendedNextAction).toBe("decide");
    await recordDecision({ runDir, step: await loadStep(runDir, step.stepId), type: "accept" });
    expect((await buildReviewPackage(runDir)).recommendedNextAction).toBe("commit-or-revise");
    await recordCommitEvent(runDir, { commitSha: "abc" });
    expect((await buildReviewPackage(runDir)).recommendedNextAction).toBe("manual-pr");
  });

  it("marks invalid JSON and renders stable markdown", async () => {
    const { runDir } = await oneAttemptRun();
    await writeFile(path.join(runDir, "validation-report.json"), "{bad", "utf8");
    const pkg = await buildReviewPackage(runDir, new Date("2026-01-02T00:00:00.000Z"));
    expect(pkg.missingArtifacts).toContain("invalid-json:validation-report.json");
    expect(renderReviewPackageMarkdown(pkg)).toBe(renderReviewPackageMarkdown(pkg));
  });

  it("CLI review --run writes paths and status", async () => {
    const cwd = await mkdtemp(path.join(os.tmpdir(), "catos-review-cli-"));
    const runsDir = path.join(cwd, "runs");
    await mkdir(runsDir);
    const { runDir } = await oneAttemptRun();
    await import("node:fs/promises").then((fs) => fs.cp(runDir, path.join(runsDir, "cli-run"), { recursive: true }));
    const logs: string[] = [];
    const old = console.log;
    console.log = (m?: unknown) => { logs.push(String(m)); };
    try { await reviewCommand(["--run", "cli-run"], { cwd, runsDir, now: new Date("2026-01-02T00:00:00.000Z") }); } finally { console.log = old; }
    expect(logs.join("\n")).toContain("Review package created");
    await expect(readFile(path.join(runsDir, "cli-run", "review", "review-package.md"), "utf8")).resolves.toContain("# AutoCodex Review Package");
  });
});
