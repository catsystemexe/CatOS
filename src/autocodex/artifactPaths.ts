import path from "node:path";
import { assertPackageRelativePath, packagePath } from "./taskPackagePaths.js";

export const TASK_FILE = "task.json";
export const EVENTS_FILE = "events.jsonl";
export const STATE_FILE = "state.json";
export const LOCK_FILE = ".task.lock";

export function taskPackagePaths(packageDir: string) {
  return {
    task: path.join(packageDir, TASK_FILE),
    state: path.join(packageDir, STATE_FILE),
    events: path.join(packageDir, EVENTS_FILE),
    lock: path.join(packageDir, LOCK_FILE),
    artifacts: path.join(packageDir, "artifacts"),
  };
}

export function artifactPath(packageDir: string, relativeArtifactPath: string): string {
  const relative = assertPackageRelativePath(relativeArtifactPath);
  return packagePath(path.join(packageDir, "artifacts"), relative);
}
