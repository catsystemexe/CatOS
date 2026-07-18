import { expect, test } from "vitest";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { buildUiSystemState, buildUiTimeline } from "../src/uiViewModel.js";
import { writeSessionReport } from "../src/finalExport.js";
import { writeFinalResult } from "../src/reworkLoop.js";
import { readRunOutput } from "../src/uiApi.js";

async function fixture() {
  const root = await mkdtemp(path.join(os.tmpdir(), "catos-ui-contract-"));
  const runDir = path.join(root, "runs", "run-1");
  const ws = path.join(root, "ws");
  const attemptDir = path.join(
    runDir,
    "steps",
    "001-step",
    "attempts",
    "001-attempt",
  );
  await mkdir(path.join(ws, "docs"), { recursive: true });
  await mkdir(attemptDir, { recursive: true });
  return { root, runDir, ws, attemptDir };
}
async function writeBase(
  f: Awaited<ReturnType<typeof fixture>>,
  verdict: "ACCEPT" | "REWORK" | "HUMAN_REQUIRED" = "ACCEPT",
  validation: "PASS" | "FAIL" | "BLOCKED" = "PASS",
  attemptStatus = "succeeded",
) {
  await writeFile(
    path.join(f.ws, "docs", "AUTOCODEX_E2E_TEST.md"),
    "# AutoCodex E2E Test\n\nStatus: passed\nPurpose: verify isolated workspace writing\nExpected changed files: 1\n",
  );
  await writeFile(
    path.join(f.runDir, "input.json"),
    JSON.stringify({
      runId: "run-1",
      repositoryPath: f.ws,
      baseBranch: "autocodex",
      goal: "create docs/AUTOCODEX_E2E_TEST.md",
    }),
  );
  await writeFile(
    path.join(f.runDir, "session.json"),
    JSON.stringify({
      schemaVersion: 1,
      runId: "run-1",
      sessionId: "run-1",
      goal: "create docs/AUTOCODEX_E2E_TEST.md",
      status: "active",
      branch: "autocodex",
      workspacePath: f.ws,
      createdAt: "2026-07-14T00:00:00.000Z",
      updatedAt: "2026-07-14T00:00:01.000Z",
      steps: ["step"],
      activeStepId: "step",
    }),
  );
  await writeFile(
    path.join(f.attemptDir, "attempt.json"),
    JSON.stringify({
      schemaVersion: 1,
      attemptId: "attempt",
      stepId: "step",
      order: 1,
      status: attemptStatus,
      prompt: "p",
      startedAt: "2026-07-14T00:00:00.000Z",
      completedAt: "2026-07-14T00:00:01.234Z",
      changedFiles: ["docs/AUTOCODEX_E2E_TEST.md"],
      artifacts: {
        codingResultPath: path.join(f.attemptDir, "coding-result.json"),
        validationReportPath: path.join(f.attemptDir, "validation-report.json"),
        reviewReportPath: path.join(f.attemptDir, "review-report.json"),
      },
    }),
  );
  await writeFile(
    path.join(f.attemptDir, "coding-result.json"),
    JSON.stringify({
      schemaVersion: 1,
      threadId: "thread",
      workspacePath: f.ws,
      changedFiles: ["docs/AUTOCODEX_E2E_TEST.md"],
      finalResponse: "created and verified the requested file",
      sandboxMode: "workspace-write",
      sandboxIsolation: "enabled",
    }),
  );
  await writeFile(
    path.join(f.attemptDir, "workspace.diff"),
    "diff --git a/docs/AUTOCODEX_E2E_TEST.md b/docs/AUTOCODEX_E2E_TEST.md\n",
  );
  await writeFile(
    path.join(f.attemptDir, "workspace-status.txt"),
    "?? docs/AUTOCODEX_E2E_TEST.md\n",
  );
  await writeFile(
    path.join(f.attemptDir, "validation-report.json"),
    JSON.stringify({
      schemaVersion: 1,
      status: validation,
      workspacePath: f.ws,
      startedAt: "2026-07-14T00:00:01.000Z",
      finishedAt: "2026-07-14T00:00:02.000Z",
      results: [
        {
          name: "typecheck",
          command: "npm run typecheck",
          required: true,
          status: validation === "PASS" ? "PASS" : "FAIL",
          exitCode: validation === "PASS" ? 0 : 1,
          signal: null,
          stdout: "ok",
          stderr: "",
          durationMs: 10,
          timedOut: false,
        },
        {
          name: "diff-check",
          command: "git diff --check",
          required: true,
          status: validation === "BLOCKED" ? "BLOCKED" : "PASS",
          exitCode: validation === "BLOCKED" ? null : 0,
          signal: null,
          stdout: "",
          stderr: "",
          durationMs: 5,
          timedOut: false,
        },
      ],
    }),
  );
  await writeFile(
    path.join(f.attemptDir, "review-report.json"),
    JSON.stringify({
      schemaVersion: 1,
      verdict,
      summary:
        verdict === "REWORK"
          ? "Expected file content did not match."
          : "accepted",
      reviewedAcceptanceCriteria: [
        {
          criterion: "docs/AUTOCODEX_E2E_TEST.md exists",
          status: verdict === "ACCEPT" ? "SATISFIED" : "NOT_SATISFIED",
          evidence: "workspace diff and validation report",
        },
      ],
      blockingFindings:
        verdict === "REWORK"
          ? [
              {
                id: "missing-content",
                title: "content mismatch",
                evidence: "validation output",
                requiredChange: "Write the exact requested file content.",
              },
            ]
          : [],
      warnings: [],
    }),
  );
}

test("RUN exposes exactly CODEX, VALIDATION, REVIEW, FINAL with report contract", async () => {
  const f = await fixture();
  await writeBase(f, "ACCEPT", "PASS");
  await writeSessionReport(f.runDir);
  const rows = await buildUiTimeline(f.runDir);
  expect(rows.map((r) => r.name)).toEqual([
    "CODEX",
    "VALIDATION",
    "REVIEW",
    "FINAL",
  ]);
  expect(rows.map((r) => ({ sequence: r.sequence, phase: r.phase, actor: r.actor, attempt: r.attempt }))).toEqual([
    { sequence: 1, phase: "coding", actor: "codex", attempt: 1 },
    { sequence: 2, phase: "validation", actor: "script", attempt: 1 },
    { sequence: 3, phase: "review", actor: "gpt", attempt: 1 },
    { sequence: 4, phase: "final", actor: "script", attempt: 1 },
  ]);
  expect(rows.map((r) => r.report?.label)).toEqual([
    "coding-report.md",
    "validation-report.md",
    "review-report.md",
    "FINAL_REPORT.md",
  ]);
  expect(
    rows.every(
      (r) =>
        r.report?.path &&
        !path.isAbsolute(r.report.path) &&
        !r.report.path.includes(".."),
    ),
  ).toBe(true);
});


test("RUN timeline exposes chronological concrete attempt events", async () => {
  const f = await fixture();
  await writeBase(f, "REWORK", "FAIL");
  const secondAttemptDir = path.join(
    f.runDir,
    "steps",
    "001-step",
    "attempts",
    "002-attempt-2",
  );
  await mkdir(secondAttemptDir, { recursive: true });
  await writeFile(
    path.join(secondAttemptDir, "attempt.json"),
    JSON.stringify({
      schemaVersion: 1,
      attemptId: "attempt-2",
      stepId: "step",
      order: 2,
      status: "succeeded",
      prompt: "p2",
      startedAt: "2026-07-14T00:01:00.000Z",
      completedAt: "2026-07-14T00:01:01.000Z",
      changedFiles: ["docs/AUTOCODEX_E2E_TEST.md"],
      artifacts: {
        codingResultPath: path.join(secondAttemptDir, "coding-result.json"),
        validationReportPath: path.join(secondAttemptDir, "validation-report.json"),
        reviewReportPath: path.join(secondAttemptDir, "review-report.json"),
      },
    }),
  );
  await writeFile(path.join(secondAttemptDir, "coding-result.json"), JSON.stringify({ schemaVersion: 1, workspacePath: f.ws, changedFiles: ["docs/AUTOCODEX_E2E_TEST.md"], finalResponse: "fixed" }));
  await writeFile(path.join(secondAttemptDir, "validation-report.json"), JSON.stringify({ schemaVersion: 1, status: "PASS", workspacePath: f.ws, results: [] }));
  await writeFile(path.join(secondAttemptDir, "review-report.json"), JSON.stringify({ schemaVersion: 1, verdict: "ACCEPT", summary: "accepted", reviewedAcceptanceCriteria: [], blockingFindings: [], warnings: [] }));

  await writeSessionReport(f.runDir);
  const rows = await buildUiTimeline(f.runDir, { includeFinal: false });

  expect(rows.map((r) => [r.sequence, r.label, r.phase, r.actor, r.attempt, r.status])).toEqual([
    [1, "Coding", "coding", "codex", 1, "completed"],
    [2, "Validation", "validation", "script", 1, "failed"],
    [3, "Review", "review", "gpt", 1, "rework"],
    [4, "Coding 2", "coding", "codex", 2, "completed"],
    [5, "Validation 2", "validation", "script", 2, "passed"],
    [6, "Review 2", "review", "gpt", 2, "accepted"],
  ]);
  expect(rows.map((r) => r.report?.label)).toEqual([
    "coding-report.md",
    "validation-report.md",
    "review-report.md",
    "coding-report.md",
    "validation-report.md",
    "review-report.md",
  ]);
});
test("CODEX report exists for completed and failed CODEX and includes final response/workspace result", async () => {
  for (const status of ["succeeded", "failed"]) {
    const f = await fixture();
    await writeBase(f, "REWORK", "FAIL", status);
    await writeSessionReport(f.runDir);
    const md = await readFile(
      path.join(f.runDir, "01_CODEX_REPORT.md"),
      "utf8",
    );
    expect(md).toContain("# CODEX Report");
    expect(md).toContain("created and verified the requested file");
    expect(md).toContain("changed file count: 1");
    expect(md).toContain("docs/AUTOCODEX_E2E_TEST.md");
  }
});

test("VALIDATION report lists configured checks and does not overclaim task acceptance", async () => {
  const f = await fixture();
  await writeBase(f, "REWORK", "FAIL");
  await writeFile(
    path.join(f.attemptDir, "validation-report.json"),
    JSON.stringify({
      schemaVersion: 1,
      status: "FAIL",
      workspacePath: f.ws,
      startedAt: "2026-07-14T00:00:01.000Z",
      finishedAt: "2026-07-14T00:00:02.000Z",
      results: [
        {
          name: "typecheck",
          command: "npm run typecheck",
          required: true,
          status: "FAIL",
          exitCode: 1,
          signal: null,
          stdout: "",
          stderr: "typecheck failed",
          durationMs: 10,
          timedOut: false,
        },
        {
          name: "diff-check",
          command: "git diff --check",
          required: true,
          status: "BLOCKED",
          exitCode: null,
          signal: null,
          stdout: "",
          stderr: "git unavailable",
          durationMs: 5,
          timedOut: false,
        },
      ],
    }),
  );
  await writeSessionReport(f.runDir);
  const md = await readFile(
    path.join(f.runDir, "02_VALIDATION_REPORT.md"),
    "utf8",
  );
  expect(md).toContain("### typecheck");
  expect(md).toContain("### diff-check");
  expect(md).toContain("- state: FAIL");
  expect(md).toContain("- state: BLOCKED");
  expect(md).toContain("## Task-output checks");
  expect(md).toContain("- git diff --check passes: no");
  expect(md).not.toContain("task acceptance was verified");
  expect(md).toContain("## Result\nValidation outcome: FAIL.");
});

test("REVIEW report contains criteria, evidence, findings, decision, reason, and rework instructions", async () => {
  const f = await fixture();
  await writeBase(f, "REWORK", "FAIL");
  await writeSessionReport(f.runDir);
  const md = await readFile(path.join(f.runDir, "03_REVIEW_REPORT.md"), "utf8");
  for (const text of [
    "## Acceptance criteria",
    "## Evidence inspected",
    "content mismatch",
    "## Decision\nREWORK",
    "Expected file content did not match.",
    "Write the exact requested file content.",
  ])
    expect(md).toContain(text);
});

for (const [status, verdict] of [
  ["ACCEPTED", "ACCEPT"],
  ["HUMAN_REQUIRED", "HUMAN_REQUIRED"],
  ["REWORK_LIMIT_REACHED", "REWORK"],
  ["completed", "ACCEPT"],
  ["failed", "REWORK"],
  ["stopped", "HUMAN_REQUIRED"],
] as const) {
  test(`FINAL_REPORT.md exists for terminal state ${status}`, async () => {
    const f = await fixture();
    await writeBase(f, verdict, verdict === "ACCEPT" ? "PASS" : "FAIL");
    await writeFinalResult(f.runDir, {
      schemaVersion: 1,
      runId: "run-1",
      status,
      terminalMessage:
        status === "ACCEPTED" || status === "completed"
          ? "TASK COMPLETE"
          : "TASK FAILED",
      error:
        verdict === "ACCEPT"
          ? null
          : { code: "terminal", message: "terminal root cause" },
      finalReviewVerdict: verdict,
      totalCodingAttempts: 1,
      reworkAttempts: 0,
      finalWorkspacePath: f.ws,
      finalChangedFiles: ["docs/AUTOCODEX_E2E_TEST.md"],
      finalValidationStatus: verdict === "ACCEPT" ? "PASS" : "FAIL",
      finalReviewReportPath: path.join(f.attemptDir, "review-report.json"),
      outputs: [],
    });
    const md = await readFile(path.join(f.runDir, "FINAL_REPORT.md"), "utf8");
    expect(md).toContain("# AutoCodex Final Report");
    expect(md).toContain("report: steps/001-step/attempts/001-attempt/coding-report.md");
    expect(md).toContain("report: steps/001-step/attempts/001-attempt/validation-report.md");
    expect(md).toContain("report: steps/001-step/attempts/001-attempt/review-report.md");
  });
}

test("safe report output access rejects traversal and reads selected report", async () => {
  const f = await fixture();
  await writeBase(f);
  await writeFinalResult(f.runDir, {
    schemaVersion: 1,
    runId: "run-1",
    status: "ACCEPTED",
    terminalMessage: "TASK COMPLETE",
    error: null,
    finalReviewVerdict: "ACCEPT",
    totalCodingAttempts: 1,
    reworkAttempts: 0,
    finalWorkspacePath: f.ws,
    finalChangedFiles: [],
    finalValidationStatus: "PASS",
    finalReviewReportPath: path.join(f.attemptDir, "review-report.json"),
    outputs: [],
  });
  await expect(
    readRunOutput("run-1", "../secret", {
      cwd: f.root,
      runsDir: path.join(f.root, "runs"),
    }),
  ).rejects.toThrow("Path traversal rejected");
  await expect(
    readRunOutput("run-1", "01_CODEX_REPORT.md", {
      cwd: f.root,
      runsDir: path.join(f.root, "runs"),
    }),
  ).resolves.toMatchObject({ path: "01_CODEX_REPORT.md" });
});

test("terminal result availability is checked from files", async () => {
  const f = await fixture();
  await writeBase(f);
  await writeSessionReport(f.runDir);
  await rm(path.join(f.runDir, "02_VALIDATION_REPORT.md"));
  const s = await buildUiSystemState(f.runDir);
  expect(s.steps.map((r) => r.report?.label)).toEqual([
    "coding-report.md",
    "validation-report.md",
    "review-report.md",
    "FINAL_REPORT.md",
  ]);
  expect(s.steps.every((r) => r.report?.exists && r.report.readable)).toBe(true);
});

test("UI start API is disabled for v2 CLI-only runs", async () => {
  const api = await readFile(
    new URL("../src/uiApi.ts", import.meta.url),
    "utf8",
  );
  expect(api).toContain("UI start is disabled for AutoCodex v2");
  expect(api).toContain("npm run catos -- run --project <id> --task-package <directory>");
  expect(api).not.toContain('"--sandbox-mode","danger-full-access"');
  expect(api).not.toContain('"--task",input.task');
});

test("all-skipped validation renders skipped in timeline, VALIDATION report, and FINAL report", async () => {
  const f = await fixture();
  await writeBase(f, "ACCEPT", "PASS");
  await writeFile(
    path.join(f.attemptDir, "validation-report.json"),
    JSON.stringify({
      schemaVersion: 1,
      status: "SKIPPED",
      workspacePath: f.ws,
      startedAt: "2026-07-14T00:00:01.000Z",
      finishedAt: "2026-07-14T00:00:02.000Z",
      results: ["typecheck", "test", "build"].map((name) => ({
        name,
        command: `catos:skip:no npm script named ${name}`,
        required: true,
        status: "SKIPPED",
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "Validation check skipped: command is not configured.",
        durationMs: 0,
        timedOut: false,
      })),
    }),
  );
  await writeFinalResult(f.runDir, {
    schemaVersion: 1,
    runId: "run-1",
    status: "ACCEPTED",
    terminalMessage: "TASK COMPLETE",
    error: null,
    finalReviewVerdict: "ACCEPT",
    totalCodingAttempts: 1,
    reworkAttempts: 0,
    finalWorkspacePath: f.ws,
    finalChangedFiles: ["docs/AUTOCODEX_E2E_TEST.md"],
    finalValidationStatus: "SKIPPED",
    finalReviewReportPath: path.join(f.attemptDir, "review-report.json"),
    outputs: [],
    finalResponse:
      "Created [docs/AUTOCODEX_E2E_TEST.md](/tmp/catos-workspaces/run-1/workspace/docs/AUTOCODEX_E2E_TEST.md)",
  });
  const rows = await buildUiTimeline(f.runDir);
  expect(rows.find((r) => r.name === "VALIDATION")?.status).toBe("skipped");
  const validationMd = await readFile(
    path.join(f.runDir, "02_VALIDATION_REPORT.md"),
    "utf8",
  );
  expect(validationMd).toContain("- status: skipped");
  expect(validationMd).toContain("validation result is SKIPPED, not failed");
  const finalMd = await readFile(
    path.join(f.runDir, "FINAL_REPORT.md"),
    "utf8",
  );
  expect(finalMd).toContain("### VALIDATION\n- status: skipped");
  expect(finalMd).toContain(
    "[docs/AUTOCODEX_E2E_TEST.md](docs/AUTOCODEX_E2E_TEST.md)",
  );
  expect(finalMd).not.toContain("/tmp/catos-workspaces");
});

test("task expected-file extraction supports explicit paths and rejects unsafe/generic slash prose", async () => {
  const f = await fixture();
  await writeBase(f, "ACCEPT", "PASS");
  await writeFile(
    path.join(f.runDir, "input.json"),
    JSON.stringify({
      runId: "run-1",
      repositoryPath: f.ws,
      baseBranch: "autocodex",
      goal: "Create exactly one new file: docs/AUTOCODEX_E2E_TEST.md\nfile: ../escape\nModify /tmp/example\nKeep workspace diff/status and input/output text.",
    }),
  );
  await writeSessionReport(f.runDir);
  const md = await readFile(path.join(f.runDir, "03_REVIEW_REPORT.md"), "utf8");
  expect(md).toContain("## Expected files\n- docs/AUTOCODEX_E2E_TEST.md");
  expect(md).not.toContain("/tmp/example");
  expect(md).not.toContain("../escape");
  expect(md).not.toContain("workspace diff/status\n");
});

test("CODEX report renders structured diff-check result", async () => {
  const f = await fixture();
  await writeBase(f, "ACCEPT", "PASS");
  const coding = JSON.parse(
    await readFile(path.join(f.attemptDir, "coding-result.json"), "utf8"),
  );
  coding.diffCheck = {
    command: "git diff --check",
    exitCode: 0,
    stdout: "",
    stderr: "",
    durationMs: 12,
    status: "PASS",
  };
  await writeFile(
    path.join(f.attemptDir, "coding-result.json"),
    JSON.stringify(coding),
  );
  await writeSessionReport(f.runDir);
  const md = await readFile(path.join(f.runDir, "01_CODEX_REPORT.md"), "utf8");
  expect(md).toContain("- diff-check result: PASS");
});


test("Review JSON, Markdown, and FINAL report agree after diff-check reconciliation", async () => {
  const f = await fixture();
  await writeBase(f, "ACCEPT", "BLOCKED");
  const coding = JSON.parse(await readFile(path.join(f.attemptDir, "coding-result.json"), "utf8"));
  coding.diffCheck = {
    command: "git diff --check",
    exitCode: 0,
    stdout: "",
    stderr: "",
    durationMs: 12,
    status: "PASS",
    limitation: "git diff --check does not inspect untracked file content.",
  };
  await writeFile(path.join(f.attemptDir, "coding-result.json"), JSON.stringify(coding));
  await writeFile(path.join(f.attemptDir, "review-report.json"), JSON.stringify({
    schemaVersion: 1,
    verdict: "ACCEPT",
    summary: "Structured coordinator diff-check evidence accepted.",
    reviewedAcceptanceCriteria: [{ criterion: "git diff --check passes", status: "SATISFIED", evidence: "Coordinator diffCheck status PASS, command git diff --check, exit code 0." }],
    blockingFindings: [],
    warnings: [],
  }));
  await writeSessionReport(f.runDir);
  const reviewJson = await readFile(path.join(f.attemptDir, "review-report.json"), "utf8");
  const reviewMd = await readFile(path.join(f.attemptDir, "review-report.md"), "utf8");
  const finalMd = await readFile(path.join(f.runDir, "FINAL_REPORT.md"), "utf8");
  expect(reviewJson).toContain('"status":"SATISFIED"');
  expect(reviewMd).toContain("SATISFIED: git diff --check passes");
  expect(reviewJson).not.toContain("UNCERTAIN");
  expect(reviewMd).not.toContain("UNCERTAIN: git diff --check passes");
  expect(finalMd).not.toContain("UNCERTAIN: git diff --check passes");
});

test("validation status consistency preserves FAIL, SKIPPED, and FINAL timeline inheritance", async () => {
  const failBlocked = await fixture();
  await writeBase(failBlocked, "REWORK", "FAIL");
  await writeFile(
    path.join(failBlocked.attemptDir, "validation-report.json"),
    JSON.stringify({
      schemaVersion: 1,
      status: "FAIL",
      workspacePath: failBlocked.ws,
      startedAt: "2026-07-14T00:00:01.000Z",
      finishedAt: "2026-07-14T00:00:02.000Z",
      results: [
        {
          name: "failing",
          command: "npm test",
          required: true,
          status: "FAIL",
          exitCode: 1,
          signal: null,
          stdout: "",
          stderr: "failed",
          durationMs: 10,
          timedOut: false,
        },
        {
          name: "missing",
          command: "missing",
          required: true,
          status: "BLOCKED",
          exitCode: null,
          signal: null,
          stdout: "",
          stderr: "blocked",
          durationMs: 5,
          timedOut: false,
        },
      ],
    }),
  );
  await writeFinalResult(failBlocked.runDir, {
    schemaVersion: 1,
    runId: "run-1",
    status: "REWORK_LIMIT_REACHED",
    terminalMessage: "TASK FAILED",
    error: { code: "validation", message: "failed" },
    finalReviewVerdict: "REWORK",
    totalCodingAttempts: 1,
    reworkAttempts: 0,
    finalWorkspacePath: failBlocked.ws,
    finalChangedFiles: ["docs/AUTOCODEX_E2E_TEST.md"],
    finalValidationStatus: "FAIL",
    finalReviewReportPath: path.join(
      failBlocked.attemptDir,
      "review-report.json",
    ),
    outputs: [],
  });
  const failRows = await buildUiTimeline(failBlocked.runDir);
  expect(failRows.find((r) => r.name === "VALIDATION")?.status).toBe("failed");
  expect(failRows.find((r) => r.name === "FINAL")?.status).toBe("rework_limit_reached");
  const failFinal = await readFile(
    path.join(failBlocked.runDir, "FINAL_REPORT.md"),
    "utf8",
  );
  expect(failFinal).toContain("### VALIDATION\n- status: failed");

  const skipped = await fixture();
  await writeBase(skipped, "ACCEPT", "PASS");
  await writeFile(
    path.join(skipped.attemptDir, "validation-report.json"),
    JSON.stringify({
      schemaVersion: 1,
      status: "SKIPPED",
      workspacePath: skipped.ws,
      startedAt: "2026-07-14T00:00:01.000Z",
      finishedAt: "2026-07-14T00:00:02.000Z",
      results: ["typecheck", "test"].map((name) => ({
        name,
        command: `catos:skip:no npm script named ${name}`,
        required: true,
        status: "SKIPPED",
        exitCode: null,
        signal: null,
        stdout: "",
        stderr: "skipped",
        durationMs: 0,
        timedOut: false,
      })),
    }),
  );
  await writeFinalResult(skipped.runDir, {
    schemaVersion: 1,
    runId: "run-1",
    status: "ACCEPTED",
    terminalMessage: "TASK COMPLETE",
    error: null,
    finalReviewVerdict: "ACCEPT",
    totalCodingAttempts: 1,
    reworkAttempts: 0,
    finalWorkspacePath: skipped.ws,
    finalChangedFiles: ["docs/AUTOCODEX_E2E_TEST.md"],
    finalValidationStatus: "SKIPPED",
    finalReviewReportPath: path.join(skipped.attemptDir, "review-report.json"),
    outputs: [],
  });
  const skippedRows = await buildUiTimeline(skipped.runDir);
  expect(skippedRows.find((r) => r.name === "VALIDATION")?.status).toBe(
    "skipped",
  );
  const skippedFinal = await readFile(
    path.join(skipped.runDir, "FINAL_REPORT.md"),
    "utf8",
  );
  expect(skippedFinal).toContain("### VALIDATION\n- status: skipped");
});
