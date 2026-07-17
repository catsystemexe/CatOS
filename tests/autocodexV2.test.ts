import { mkdir, mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { parseTaskPackage, readTaskPackage } from "../src/autocodex/taskPackage.js";
import { assertTransition, requiresExplicitResume } from "../src/autocodex/state.js";
import { appendEvent, atomicWriteJson, readCompleteJson, resumeRunState, writeRunState } from "../src/autocodex/persistence.js";
import { acquireRepositoryLock, acquireTaskLock, LockError } from "../src/autocodex/lock.js";
import { realpathWithinPackage } from "../src/autocodex/taskPackagePaths.js";

const valid = { schemaVersion: 2 as const, taskId: "task-1", task: "Do it", baseCommitSha: "a".repeat(40), checks: [{ id: "test", argv: ["npm", "test"] }], steps: [{ id: "one", title: "One", checks: ["test"] }] };
describe("AutoCodex v2 task package", () => {
  it("validates immutable SHA, check registry, and argv", () => { expect(parseTaskPackage(valid).taskId).toBe("task-1"); expect(() => parseTaskPackage({ ...valid, baseCommitSha: "bad" })).toThrow(); expect(() => parseTaskPackage({ ...valid, steps: [{ id: "one", title: "One", checks: ["missing"] }] })).toThrow(); expect(() => parseTaskPackage({ ...valid, checks: [{ id: "test", argv: ["--"] }] })).toThrow(); });
  it("guards state transitions and does not automatically resume interrupted runs", async () => { expect(() => assertTransition("SUCCEEDED", "RUNNING")).toThrow(); expect(requiresExplicitResume({ status: "RUNNING" })).toBe(true); const dir = await mkdtemp(path.join(os.tmpdir(), "catos-v2-")); await writeRunState(dir, { schemaVersion: 2, taskId: "task-1", status: "RUNNING", reasonCode: "STARTED", steps: [], attempts: [], createdAt: "2026-01-01T00:00:00.000Z", updatedAt: "2026-01-01T00:00:00.000Z" }); await expect(resumeRunState(dir)).rejects.toThrow(/Automatic resume/); });
  it("writes JSON atomically and rejects incomplete JSON", async () => { const dir = await mkdtemp(path.join(os.tmpdir(), "catos-v2-")); const file = path.join(dir, "state.json"); await atomicWriteJson(file, { ok: true }); expect(await readCompleteJson<{ ok: boolean }>(file)).toEqual({ ok: true }); await writeFile(file, "{"); await expect(readCompleteJson(file)).rejects.toThrow(/Incomplete/); });
  it("appends monotonically sequenced events", async () => { const dir = await mkdtemp(path.join(os.tmpdir(), "catos-v2-")); expect((await appendEvent(dir, { type: "created" })).sequence).toBe(1); expect((await appendEvent(dir, { type: "started" })).sequence).toBe(2); expect((await readFile(path.join(dir, "events.jsonl"), "utf8")).trim().split("\n")).toHaveLength(2); });
  it("locks repository and package exclusively", async () => { const dir = await mkdtemp(path.join(os.tmpdir(), "catos-v2-")); const task = await acquireTaskLock(dir); await expect(acquireTaskLock(dir)).rejects.toBeInstanceOf(LockError); await task.release(); const repo = await acquireRepositoryLock(dir); await repo.release(); });
  it("rejects traversal and symlink escapes from package files", async () => { const dir = await mkdtemp(path.join(os.tmpdir(), "catos-v2-")); await mkdir(path.join(dir, "inside")); await writeFile(path.join(dir, "inside", "ok"), "ok"); await expect(realpathWithinPackage(dir, "../outside")).rejects.toThrow(); expect(await realpathWithinPackage(dir, "inside/ok")).toContain("ok"); const outside = path.join(os.tmpdir(), `catos-outside-${Date.now()}`); await writeFile(outside, "no"); await symlink(outside, path.join(dir, "escape")); await expect(realpathWithinPackage(dir, "escape")).rejects.toThrow(/outside/); await writeFile(path.join(dir, "task.json"), JSON.stringify(valid)); await expect(readTaskPackage(dir)).resolves.toMatchObject({ taskId: "task-1" }); });
});
