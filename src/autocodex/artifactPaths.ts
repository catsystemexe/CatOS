import path from "node:path";
import { assertPackageRelativePath, packagePath } from "./taskPackagePaths.js";

export const TASK_FILE = "task.json";
export const EVENTS_FILE = "events.jsonl";
export const STATE_FILE = "state.json";
export const LOCK_FILE = ".task.lock";

/**
 * The v2 Run layout.  These are relative POSIX paths deliberately kept in one
 * place; producers must not invent a second location for an audit artifact.
 */
export const RUN_ARTIFACT_PATHS = Object.freeze({
  run: "run.json", runtime: "runtime.json", events: "events.jsonl", worktree: "worktree.json",
  inputManifest: "input/task-package-manifest.json", inputSha256: "input/task-package.sha256",
  baselineTests: "baseline/test-results.json", baselineLogs: "baseline/logs",
  steps: "steps", final: "final",
  runSummary: "final/run-summary.md", reviewPacket: "final/final-review-packet.md",
  finalDiff: "final/final-diff.patch", testSummary: "final/test-summary.json",
  openIssues: "final/open-issues.md", artifactManifest: "final/artifact-manifest.json",
} as const);

export function stepArtifactPaths(stepId: string, attemptId: string) {
  const root = `${RUN_ARTIFACT_PATHS.steps}/${assertPackageRelativePath(stepId)}/attempts/${assertPackageRelativePath(attemptId)}`;
  return Object.freeze({ root, attempt: `${root}/attempt.json`, codingPrompt: `${root}/coding-prompt.md`, codingEvents: `${root}/coding-events.jsonl`, codingResult: `${root}/coding-result.json`, codingHandoff: `${root}/coding-handoff.md`, changedFiles: `${root}/changed-files.json`, changeValidation: `${root}/change-validation.json`, commit: `${root}/commit.json`, tests: `${root}/tests/test-results.json`, testLogs: `${root}/tests/logs`, reviewPrompt: `${root}/review-prompt.md`, reviewEvents: `${root}/review-events.jsonl`, reviewResult: `${root}/review-result.json`, review: `${root}/review.md` } as const);
}

/** Resolves one fixed Run artifact path and rejects arbitrary package paths. */
export function runArtifactPath(runDir: string, artifact: keyof typeof RUN_ARTIFACT_PATHS): string { return packagePath(runDir, RUN_ARTIFACT_PATHS[artifact]); }
export function runStepArtifactPath(runDir: string, stepId: string, attemptId: string, artifact: keyof ReturnType<typeof stepArtifactPaths>): string { return packagePath(runDir, stepArtifactPaths(stepId, attemptId)[artifact]); }

export function taskPackagePaths(packageDir: string) {
  return { task: path.join(packageDir, TASK_FILE), state: path.join(packageDir, STATE_FILE), events: path.join(packageDir, EVENTS_FILE), lock: path.join(packageDir, LOCK_FILE), artifacts: path.join(packageDir, "artifacts") };
}
export function artifactPath(packageDir: string, relativeArtifactPath: string): string { const relative = assertPackageRelativePath(relativeArtifactPath); return packagePath(path.join(packageDir, "artifacts"), relative); }
